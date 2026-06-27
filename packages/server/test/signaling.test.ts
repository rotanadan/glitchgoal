import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createSignalingServer, type SignalingServer } from '../src/signaling.js';
import type { ServerMessage } from '../src/protocol.js';

let server: SignalingServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as ServerMessage));
  });
}

/** Resolves to the message, or 'timeout' if none arrives in `ms`. */
function messageOrTimeout(ws: WebSocket, ms: number): Promise<ServerMessage | 'timeout'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    ws.once('message', (raw) => {
      clearTimeout(t);
      resolve(JSON.parse(raw.toString()) as ServerMessage);
    });
  });
}

describe('signaling server', () => {
  it('pairs two clients with complementary roles and a shared seed', async () => {
    server = await createSignalingServer(0);
    const a = await connect(server.port);
    const b = await connect(server.port);

    const aMatched = nextMessage(a);
    const bMatched = nextMessage(b);
    a.send(JSON.stringify({ type: 'join' }));
    b.send(JSON.stringify({ type: 'join' }));

    const [ma, mb] = await Promise.all([aMatched, bMatched]);
    expect(ma.type).toBe('matched');
    expect(mb.type).toBe('matched');
    if (ma.type !== 'matched' || mb.type !== 'matched') throw new Error('unreachable');

    // Complementary players, exactly one initiator, identical seed.
    expect([ma.player, mb.player].sort()).toEqual([0, 1]);
    expect(ma.initiator).not.toBe(mb.initiator);
    expect(ma.seed).toBe(mb.seed);
    expect(ma.player === 0 ? ma.initiator : mb.initiator).toBe(true);

    a.close();
    b.close();
  });

  it('relays signaling payloads to the matched peer only', async () => {
    server = await createSignalingServer(0);
    const a = await connect(server.port);
    const b = await connect(server.port);

    const aMatched = nextMessage(a);
    const bMatched = nextMessage(b);
    a.send(JSON.stringify({ type: 'join' }));
    b.send(JSON.stringify({ type: 'join' }));
    await Promise.all([aMatched, bMatched]);

    const relayed = nextMessage(b);
    a.send(JSON.stringify({ type: 'signal', data: { sdp: 'offer-blob' } }));

    const msg = await relayed;
    expect(msg.type).toBe('signal');
    if (msg.type === 'signal') expect(msg.data).toEqual({ sdp: 'offer-blob' });

    a.close();
    b.close();
  });

  it('notifies the remaining peer when the other disconnects', async () => {
    server = await createSignalingServer(0);
    const a = await connect(server.port);
    const b = await connect(server.port);

    const aMatched = nextMessage(a);
    const bMatched = nextMessage(b);
    a.send(JSON.stringify({ type: 'join' }));
    b.send(JSON.stringify({ type: 'join' }));
    await Promise.all([aMatched, bMatched]);

    const left = nextMessage(b);
    a.close();
    const msg = await left;
    expect(msg.type).toBe('peer-left');

    b.close();
  });
});

describe('MMR matchmaking', () => {
  it('does not pair players whose rating gap exceeds tolerance', async () => {
    // No widening: a 500-point gap can never be matched.
    server = await createSignalingServer(0, null, { matchmaker: { baseTolerance: 50, tolerancePerSecond: 0 } });
    const a = await connect(server.port);
    const b = await connect(server.port);
    const aMsg = messageOrTimeout(a, 600);
    const bMsg = messageOrTimeout(b, 600);
    a.send(JSON.stringify({ type: 'join', mmr: 1000 }));
    b.send(JSON.stringify({ type: 'join', mmr: 1500 }));
    expect(await aMsg).toBe('timeout');
    expect(await bMsg).toBe('timeout');
    a.close();
    b.close();
  });

  it('pairs the closest-rated players', async () => {
    server = await createSignalingServer(0, null, { matchmaker: { baseTolerance: 1000, tolerancePerSecond: 0 } });
    const close1 = await connect(server.port);
    const close2 = await connect(server.port);
    const m1 = nextMessage(close1);
    const m2 = nextMessage(close2);
    close1.send(JSON.stringify({ type: 'join', mmr: 1480 }));
    close2.send(JSON.stringify({ type: 'join', mmr: 1500 }));
    expect((await m1).type).toBe('matched');
    expect((await m2).type).toBe('matched');
    close1.close();
    close2.close();
  });
});

describe('reconnection', () => {
  it('holds the match for an identified player to rejoin', async () => {
    server = await createSignalingServer(0, null, { graceMs: 5000 });
    const a = await connect(server.port);
    const b = await connect(server.port);
    const aM = nextMessage(a);
    const bM = nextMessage(b);
    a.send(JSON.stringify({ type: 'join', userId: 'ua' }));
    b.send(JSON.stringify({ type: 'join', userId: 'ub' }));
    const [ma] = await Promise.all([aM, bM]);
    if (ma.type !== 'matched') throw new Error('unreachable');
    const matchId = ma.matchId;

    // a drops -> b is told it's temporary, not permanent.
    const bDisc = nextMessage(b);
    a.close();
    expect((await bDisc).type).toBe('peer-disconnected');

    // a reconnects and rejoins by matchId + userId.
    const a2 = await connect(server.port);
    const a2Matched = nextMessage(a2);
    const bReconn = nextMessage(b);
    a2.send(JSON.stringify({ type: 'rejoin', matchId, userId: 'ua' }));
    const rm = await a2Matched;
    expect(rm.type).toBe('matched');
    if (rm.type === 'matched') expect(rm.player).toBe(0);
    expect((await bReconn).type).toBe('peer-reconnected');

    a2.close();
    b.close();
  });
});
