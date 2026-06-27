/**
 * 1v1 signaling server with MMR matchmaking + reconnection.
 *
 * Responsibilities:
 *   - Queue players and pair them by rating (Matchmaker), assigning roles
 *     (player 0 = initiator) and a SHARED seed for identical deterministic sims.
 *   - Relay opaque WebRTC signaling payloads (SDP / ICE) within a match.
 *   - Collect each peer's reported final score and, once both agree, record the
 *     match + update MMR authoritatively (via the injected DbPort).
 *   - Hold a match open briefly when an IDENTIFIED player drops, letting them
 *     rejoin and resync (anonymous drops end the match immediately).
 *
 * After the DataChannel opens, gameplay is pure peer-to-peer.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from './protocol.js';
import { recordMatch, type DbPort } from './matchRecorder.js';
import { Matchmaker, type MatchmakerOptions } from './matchmaker.js';

interface ConnState {
  id: string;
  matchId?: string;
  role?: 0 | 1;
  userId?: string;
  username?: string;
}

interface Side {
  ws: WebSocket | null;
  userId?: string | undefined;
  username?: string | undefined;
  score?: [number, number] | undefined;
  grace?: ReturnType<typeof setTimeout> | undefined;
}

interface Match {
  id: string;
  seed: number;
  sides: [Side, Side];
  recorded: boolean;
}

export interface SignalingServer {
  port: number;
  wss: WebSocketServer;
  close(): Promise<void>;
}

export interface SignalingOptions {
  matchmaker?: MatchmakerOptions;
  /** How long (ms) to hold a match for an identified player to rejoin. */
  graceMs?: number;
  /** How often (ms) to re-attempt matchmaking as tolerances widen. */
  matchIntervalMs?: number;
}

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function createSignalingServer(
  port = 0,
  db: DbPort | null = null,
  opts: SignalingOptions = {},
): Promise<SignalingServer> {
  const wss = new WebSocketServer({ port });
  const state = new WeakMap<WebSocket, ConnState>();
  const matches = new Map<string, Match>();
  const mm = new Matchmaker<WebSocket>(opts.matchmaker);
  const graceMs = opts.graceMs ?? 15000;
  let nextId = 1;

  const stOf = (ws: WebSocket): ConnState => state.get(ws)!;
  const otherSide = (m: Match, role: 0 | 1): Side => m.sides[role === 0 ? 1 : 0];

  const createMatch = (a: WebSocket, b: WebSocket): void => {
    const sa = stOf(a);
    const sb = stOf(b);
    const id = rid();
    const seed = (Math.random() * 0xffff) | 0;
    sa.matchId = id;
    sa.role = 0;
    sb.matchId = id;
    sb.role = 1;
    const side0: Side = { ws: a, userId: sa.userId, username: sa.username };
    const side1: Side = { ws: b, userId: sb.userId, username: sb.username };
    matches.set(id, { id, seed, sides: [side0, side1], recorded: false });
    send(a, { type: 'matched', matchId: id, player: 0, seed, initiator: true, opponent: { userId: sb.userId, username: sb.username } });
    send(b, { type: 'matched', matchId: id, player: 1, seed, initiator: false, opponent: { userId: sa.userId, username: sa.username } });
  };

  const runMatchmaking = (): void => {
    const now = Date.now();
    for (let pair = mm.tryMatch(now); pair; pair = mm.tryMatch(now)) {
      createMatch(pair[0].ref, pair[1].ref);
    }
  };

  const tryRecord = async (m: Match): Promise<void> => {
    const [s0, s1] = m.sides;
    if (m.recorded || !s0.score || !s1.score) return;
    if (s0.score[0] !== s1.score[0] || s0.score[1] !== s1.score[1]) {
      send(s0.ws, { type: 'record-error', message: 'score mismatch' });
      send(s1.ws, { type: 'record-error', message: 'score mismatch' });
      return;
    }
    if (!db || !s0.userId || !s1.userId) return; // anonymous: nothing to record
    m.recorded = true;
    try {
      const outcome = await recordMatch(db, {
        player0: s0.userId,
        player1: s1.userId,
        score0: s0.score[0],
        score1: s0.score[1],
        seed: m.seed,
      });
      send(s0.ws, { type: 'recorded', won: outcome.winnerId === s0.userId, mmr: outcome.newMmr[s0.userId]! });
      send(s1.ws, { type: 'recorded', won: outcome.winnerId === s1.userId, mmr: outcome.newMmr[s1.userId]! });
    } catch (err) {
      send(s0.ws, { type: 'record-error', message: String(err) });
      send(s1.ws, { type: 'record-error', message: String(err) });
    }
  };

  const interval = setInterval(runMatchmaking, opts.matchIntervalMs ?? 1000);
  if (typeof interval.unref === 'function') interval.unref();

  wss.on('connection', (ws) => {
    state.set(ws, { id: String(nextId++) });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      const self = stOf(ws);

      if (msg.type === 'join') {
        if (msg.userId) self.userId = msg.userId;
        if (msg.username) self.username = msg.username;
        mm.add({ id: self.id, mmr: msg.mmr ?? 1000, joinedAt: Date.now(), ref: ws });
        runMatchmaking();
      } else if (msg.type === 'signal') {
        const m = self.matchId ? matches.get(self.matchId) : undefined;
        if (m && self.role !== undefined) send(otherSide(m, self.role).ws, { type: 'signal', data: msg.data });
      } else if (msg.type === 'result') {
        const m = self.matchId ? matches.get(self.matchId) : undefined;
        if (m && self.role !== undefined) {
          m.sides[self.role].score = msg.score;
          void tryRecord(m);
        }
      } else if (msg.type === 'rejoin') {
        const m = matches.get(msg.matchId);
        if (!m) {
          send(ws, { type: 'peer-left' });
          return;
        }
        const idx = m.sides.findIndex((s) => s.userId === msg.userId && s.ws === null);
        if (idx < 0) return;
        const role = idx as 0 | 1;
        const side = m.sides[role];
        if (side.grace) clearTimeout(side.grace);
        side.grace = undefined;
        side.ws = ws;
        self.matchId = m.id;
        self.role = role;
        self.userId = msg.userId;
        // Rejoiner re-establishes WebRTC (as non-initiator); survivor offers + ships state.
        send(ws, { type: 'matched', matchId: m.id, player: role, seed: m.seed, initiator: false, opponent: { userId: otherSide(m, role).userId, username: otherSide(m, role).username } });
        send(otherSide(m, role).ws, { type: 'peer-reconnected' });
      }
    });

    ws.on('close', () => {
      const self = stOf(ws);
      mm.remove(self.id);
      const m = self.matchId ? matches.get(self.matchId) : undefined;
      if (!m || self.role === undefined) return;
      const side = m.sides[self.role];
      side.ws = null;
      const other = otherSide(m, self.role);

      if (self.userId) {
        // Identified: hold the match open for a possible rejoin.
        send(other.ws, { type: 'peer-disconnected' });
        side.grace = setTimeout(() => {
          send(other.ws, { type: 'peer-left' });
          matches.delete(m.id);
        }, graceMs);
        if (typeof side.grace.unref === 'function') side.grace.unref();
      } else {
        // Anonymous: cannot rejoin, end immediately.
        send(other.ws, { type: 'peer-left' });
        matches.delete(m.id);
      }
    });
  });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: resolvedPort,
        wss,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(interval);
            for (const client of wss.clients) client.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}
