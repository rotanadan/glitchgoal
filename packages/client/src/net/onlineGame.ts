/**
 * Online 1v1 game driver.
 *
 * Brings together every netcode feature: the keyboard feeds the rollback
 * session; local inputs ship over WebRTC; remote inputs come back in. On top of
 * that:
 *   - Frame-advantage time sync (shouldStall) bounds rollback depth on lag.
 *   - Periodic checksum exchange detects desync.
 *   - Reconnection: on a peer drop we pause; on reconnect the surviving peer
 *     ships its state and the rejoiner resyncs.
 */

import { initialState, serialize, deserialize, step, WIN_GOALS, type GameState } from '@glitchgoal/sim';
import { RollbackSession } from '@glitchgoal/netcode';
import { Keyboard } from '../input.js';
import { Renderer } from '../renderer.js';
import { view } from '../view.js';
import { SignalingClient } from './signaling.js';
import { WebRtcTransport } from './transport.js';
import { INPUT_REDUNDANCY, checksumSnapshot, type Identity, type InputEntry } from './protocol.js';

const FIXED_DT = 1000 / 60;
const MAX_FRAME = 250;
const MAX_FRAMES_AHEAD = 8; // time-sync cap; keeps rollback depth bounded
const CHECKSUM_EVERY = 30; // frames between desync checksum exchanges

export interface OnlineGameOptions {
  identity?: Identity | undefined;
  onStatus?: ((text: string) => void) | undefined;
  onEnd?: (() => void) | undefined;
}

export async function startOnlineGame(
  serverUrl: string,
  renderer: Renderer,
  options: OnlineGameOptions = {},
): Promise<void> {
  const { identity, onStatus, onEnd } = options;
  const signaling = new SignalingClient();
  signaling.onRecorded = (r) => onStatus?.(`${r.won ? 'Victory!' : 'Defeat.'} New rating: ${r.mmr}`);
  signaling.onRecordError = (m) => onStatus?.(`result not recorded: ${m}`);

  const match = await signaling.connect(serverUrl, identity);
  onStatus?.(match.opponent?.username ? `Opponent: ${match.opponent.username}` : 'Match found');

  const transport = new WebRtcTransport(signaling, match.initiator);
  let sim: GameState = initialState(match.seed);
  const localHistory: InputEntry[] = [];
  let paused = false;
  let gameOver = false;

  const session = new RollbackSession<Int32Array>({
    localPlayer: match.player,
    inputDelay: 2,
    maxRollbackFrames: 12,
    saveState: () => serialize(sim),
    loadState: (snap) => {
      sim = deserialize(snap);
    },
    advanceFrame: (inputs) => {
      sim = step(sim, inputs);
    },
    onLocalInput: (frame, input) => {
      localHistory.push({ frame, input });
      if (localHistory.length > INPUT_REDUNDANCY) localHistory.shift();
    },
    checksumSnapshot: (snap) => checksumSnapshot(snap),
    onDesync: (frame) => onStatus?.(`desync detected @${frame}`),
  });

  transport.onInput = (frame, input) => session.onRemoteInput(frame, input);
  transport.onChecksum = (frame, checksum) => session.onRemoteChecksum(frame, checksum);
  transport.onState = (frame, snapshot) => {
    session.resyncTo(frame, snapshot);
    paused = false;
    onStatus?.('resynced with opponent');
  };

  // Reconnection flow.
  signaling.onPeerDisconnected = () => {
    paused = true;
    onStatus?.('opponent disconnected — waiting to reconnect…');
  };
  signaling.onPeerReconnected = () => {
    // We are the surviving peer: ship our authoritative state to the rejoiner.
    transport.sendState(session.currentFrame, serialize(sim));
    paused = false;
    onStatus?.('opponent reconnected');
  };
  signaling.onPeerLeft = () => {
    if (gameOver) return;
    gameOver = true;
    onStatus?.('opponent left — match ended');
    transport.close();
    onEnd?.();
  };

  await transport.connect();

  const keyboard = new Keyboard();
  let prev = view(sim);
  let curr = prev;
  let last = performance.now();
  let accumulator = 0;

  const tick = () => {
    const now = performance.now();
    accumulator += Math.min(now - last, MAX_FRAME);
    last = now;

    if (paused) {
      accumulator = 0; // don't pile up frames while waiting for reconnect
    }

    while (!paused && !gameOver && accumulator >= FIXED_DT) {
      if (session.shouldStall(MAX_FRAMES_AHEAD)) {
        accumulator = Math.min(accumulator, FIXED_DT); // retry soon, don't spiral
        break;
      }
      prev = curr;
      session.addLocalInput(keyboard.player1());
      transport.sendInputs(localHistory);
      session.advanceFrame();
      curr = view(sim);
      accumulator -= FIXED_DT;

      if (session.currentFrame % CHECKSUM_EVERY === 0) {
        const c = session.confirmedChecksum();
        if (c) transport.sendChecksum(c.frame, c.checksum);
      }

      if (sim.score[0] >= WIN_GOALS || sim.score[1] >= WIN_GOALS) {
        gameOver = true;
        const score: [number, number] = [sim.score[0], sim.score[1]];
        onStatus?.(`Game over — ${score[0]} : ${score[1]}`);
        signaling.sendResult(score);
        renderer.app.ticker.remove(tick);
        transport.close();
      }
    }

    renderer.render(prev, curr, accumulator / FIXED_DT);
  };

  renderer.app.ticker.add(tick);
}
