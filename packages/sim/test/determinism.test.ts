import { describe, it, expect } from 'vitest';
import {
  initialState,
  step,
  serialize,
  deserialize,
  hashState,
  type PlayerInput,
} from '../src/index.js';

/**
 * Deterministic pseudo-random input stream for a given seed. Two callers with
 * the same seed produce the exact same sequence — so "run the sim twice" is a
 * meaningful test, not just two empty-input runs.
 */
function inputStream(seed: number): (frame: number) => [PlayerInput, PlayerInput] {
  return (frame) => {
    const a = (Math.imul(frame + 1, 2654435761) ^ seed) & 0x3f;
    const b = (Math.imul(frame + 7, 40503) ^ (seed * 3)) & 0x3f;
    return [a, b];
  };
}

function runFor(seed: number, frames: number) {
  const inputs = inputStream(seed);
  let s = initialState(seed);
  for (let f = 0; f < frames; f++) {
    s = step(s, inputs(f));
  }
  return s;
}

describe('simulation determinism', () => {
  it('produces identical state hashes for identical (seed, inputs)', () => {
    const a = runFor(1234, 600);
    const b = runFor(1234, 600);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('diverges for different seeds (sanity: the test can fail)', () => {
    const a = runFor(1234, 600);
    const b = runFor(9999, 600);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('round-trips through serialize/deserialize without changing state', () => {
    const s = runFor(42, 123);
    const restored = deserialize(serialize(s));
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('rollback re-simulation reaches the same state as continuous play', () => {
    const seed = 777;
    const inputs = inputStream(seed);

    // Continuous: play 200 frames straight.
    const continuous = runFor(seed, 200);

    // Rollback-style: play 150 frames, snapshot, replay the last 50 from the
    // snapshot (as a rollback would when a late remote input arrives).
    let s = initialState(seed);
    for (let f = 0; f < 150; f++) s = step(s, inputs(f));
    const snapshot = serialize(s);

    let replay = deserialize(snapshot);
    for (let f = 150; f < 200; f++) replay = step(replay, inputs(f));

    expect(hashState(replay)).toBe(hashState(continuous));
  });
});
