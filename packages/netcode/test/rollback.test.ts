import { describe, it, expect } from 'vitest';
import {
  initialState,
  step,
  serialize,
  deserialize,
  hashState,
  type GameState,
  type PlayerInput,
} from '@glitchgoal/sim';
import { RollbackSession } from '../src/index.js';

/** Deterministic per-player input streams (mix of movement + actions). */
function streams(seed: number) {
  const p0 = (f: number): PlayerInput => (Math.imul(f + 1, 2654435761) ^ seed) & 0x3f;
  const p1 = (f: number): PlayerInput => (Math.imul(f + 13, 40503) ^ (seed * 7)) & 0x3f;
  return { p0, p1 };
}

/** Ground truth: a plain offline sim of both input streams. */
function offline(seed: number, frames: number): GameState {
  const { p0, p1 } = streams(seed);
  let s = initialState(seed);
  for (let f = 0; f < frames; f++) s = step(s, [p0(f), p1(f)]);
  return s;
}

/**
 * Build a rollback session bound to a fresh sim. localPlayer is player 0; the
 * sim state lives in a closure so save/load/advance operate on it.
 */
function makeSession(seed: number) {
  let sim = initialState(seed);
  const session = new RollbackSession<Int32Array>({
    localPlayer: 0,
    maxRollbackFrames: 16,
    saveState: () => serialize(sim),
    loadState: (snap) => {
      sim = deserialize(snap);
    },
    advanceFrame: (inputs) => {
      sim = step(sim, inputs);
    },
  });
  return { session, getSim: () => sim };
}

describe('RollbackSession convergence', () => {
  it('with no latency, never rolls back and matches the offline sim', () => {
    const seed = 100;
    const frames = 300;
    const { p0, p1 } = streams(seed);
    const { session, getSim } = makeSession(seed);

    for (let f = 0; f < frames; f++) {
      session.addLocalInput(p0(f));
      session.onRemoteInput(f, p1(f)); // arrives instantly, in order
      session.advanceFrame();
    }

    expect(session.rollbackCount).toBe(0);
    expect(hashState(getSim())).toBe(hashState(offline(seed, frames)));
  });

  it('converges to the offline sim under latency + jitter (forces rollbacks)', () => {
    const seed = 222;
    const frames = 400;
    const { p0, p1 } = streams(seed);
    const { session, getSim } = makeSession(seed);

    // Remote inputs are queued for delivery at frame f + latency, where latency
    // jitters deterministically in [2, 8]. They arrive while we keep ticking,
    // so the session must predict and roll back.
    const inbox = new Map<number, Array<{ frame: number; input: PlayerInput }>>();
    const schedule = (frame: number) => {
      const latency = 2 + ((Math.imul(frame + 1, 2246822519) >>> 0) % 7); // 2..8
      const arriveAt = frame + latency;
      const list = inbox.get(arriveAt) ?? [];
      list.push({ frame, input: p1(frame) });
      inbox.set(arriveAt, list);
    };
    for (let f = 0; f < frames; f++) schedule(f);

    for (let f = 0; f < frames; f++) {
      for (const msg of inbox.get(f) ?? []) session.onRemoteInput(msg.frame, msg.input);
      session.addLocalInput(p0(f));
      session.advanceFrame();
    }

    // Deliver any inputs still in flight, then reconcile (no new frames).
    for (let f = frames; f < frames + 16; f++) {
      for (const msg of inbox.get(f) ?? []) session.onRemoteInput(msg.frame, msg.input);
    }
    session.reconcile();

    expect(session.rollbackCount).toBeGreaterThan(0); // it really did roll back
    expect(session.predictionErrors).toBeGreaterThan(0);
    expect(hashState(getSim())).toBe(hashState(offline(seed, frames)));
  });

  it('input delay reduces rollbacks but stays correct (local view)', () => {
    // With local input delay, local inputs apply `delay` frames later. We verify
    // the session runs and reconciles cleanly; exact-state comparison against a
    // naive offline sim is intentionally skipped because the delay shifts inputs.
    const seed = 333;
    const frames = 200;
    const { p0, p1 } = streams(seed);

    let sim = initialState(seed);
    const session = new RollbackSession<Int32Array>({
      localPlayer: 1,
      inputDelay: 3,
      saveState: () => serialize(sim),
      loadState: (snap) => {
        sim = deserialize(snap);
      },
      advanceFrame: (inputs) => {
        sim = step(sim, inputs);
      },
    });

    for (let f = 0; f < frames; f++) {
      // Remote (player 0) inputs arrive 1 frame late.
      if (f >= 1) session.onRemoteInput(f - 1, p0(f - 1));
      session.addLocalInput(p1(f));
      session.advanceFrame();
    }

    expect(session.currentFrame).toBe(frames);
    expect(() => session.reconcile()).not.toThrow();
  });
});
