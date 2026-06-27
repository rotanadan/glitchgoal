import { describe, it, expect } from 'vitest';
import {
  initialState,
  step,
  serialize,
  deserialize,
  hashState,
  type PlayerInput,
} from '@glitchgoal/sim';
import { RollbackSession } from '../src/index.js';

function csum(buf: Int32Array): number {
  let h = 0x811c9dc5;
  for (const w of buf) {
    h ^= w;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function streams(seed: number) {
  const p0 = (f: number): PlayerInput => (Math.imul(f + 1, 2654435761) ^ seed) & 0x3f;
  const p1 = (f: number): PlayerInput => (Math.imul(f + 13, 40503) ^ (seed * 7)) & 0x3f;
  return { p0, p1 };
}

function makeSession(player: 0 | 1, seed: number, opts: Partial<Parameters<typeof RollbackSession>[0]> = {}) {
  let sim = initialState(seed);
  let desync: number | null = null;
  const session = new RollbackSession<Int32Array>({
    localPlayer: player,
    maxRollbackFrames: 32,
    saveState: () => serialize(sim),
    loadState: (s) => {
      sim = deserialize(s);
    },
    advanceFrame: (inputs) => {
      sim = step(sim, inputs);
    },
    checksumSnapshot: (s) => csum(s),
    onDesync: (f) => {
      desync = f;
    },
    ...opts,
  });
  return { session, getSim: () => sim, getDesync: () => desync };
}

describe('frame-advantage time sync', () => {
  it('bounds how far ahead the session runs when remote inputs never arrive', () => {
    const { session } = makeSession(0, 1);
    const { p0 } = streams(1);
    const MAX = 5;
    for (let f = 0; f < 100; f++) {
      if (session.shouldStall(MAX)) continue; // stall instead of advancing
      session.addLocalInput(p0(session.currentFrame));
      session.advanceFrame();
    }
    expect(session.framesAhead).toBeLessThanOrEqual(MAX + 1);
    expect(session.currentFrame).toBeLessThanOrEqual(MAX + 1);
  });
});

describe('desync detection', () => {
  it('two cross-driven peers agree: matching checksums, no desync', () => {
    const seed = 555;
    const { p0, p1 } = streams(seed);
    const A = makeSession(0, seed);
    const B = makeSession(1, seed);

    for (let f = 0; f < 200; f++) {
      A.session.addLocalInput(p0(f));
      B.session.addLocalInput(p1(f));
      // Exchange inputs (instant delivery).
      A.session.onRemoteInput(f, p1(f));
      B.session.onRemoteInput(f, p0(f));
      A.session.advanceFrame();
      B.session.advanceFrame();

      // Periodically exchange confirmed checksums.
      if (f % 20 === 0) {
        const ca = A.session.confirmedChecksum();
        const cb = B.session.confirmedChecksum();
        if (ca) B.session.onRemoteChecksum(ca.frame, ca.checksum);
        if (cb) A.session.onRemoteChecksum(cb.frame, cb.checksum);
      }
    }

    expect(A.getDesync()).toBeNull();
    expect(B.getDesync()).toBeNull();
    expect(hashState(A.getSim())).toBe(hashState(B.getSim()));
  });

  it('raises onDesync when peers have diverged (different seeds)', () => {
    const { p0, p1 } = streams(1);
    const A = makeSession(0, 1);
    const B = makeSession(1, 2); // different seed -> different state

    for (let f = 0; f < 10; f++) {
      A.session.addLocalInput(p0(f));
      B.session.addLocalInput(p1(f));
      A.session.onRemoteInput(f, p1(f));
      B.session.onRemoteInput(f, p0(f));
      A.session.advanceFrame();
      B.session.advanceFrame();
    }
    const ca = A.session.confirmedChecksum();
    expect(ca).not.toBeNull();
    B.session.onRemoteChecksum(ca!.frame, ca!.checksum);
    expect(B.getDesync()).toBe(ca!.frame);
  });
});

describe('resyncTo (reconnection)', () => {
  it('resumes deterministically from an agreed mid-game snapshot', () => {
    const seed = 909;
    const { p0, p1 } = streams(seed);

    // Ground truth: a plain sim played straight through.
    let truth = initialState(seed);
    for (let f = 0; f < 50; f++) truth = step(truth, [p0(f), p1(f)]);
    const snapshotAt50 = serialize(truth);
    for (let f = 50; f < 120; f++) truth = step(truth, [p0(f), p1(f)]);

    // A fresh session resynced to frame 50, then driven 50..120.
    const A = makeSession(0, 999); // wrong seed on purpose; resync overrides it
    A.session.resyncTo(50, snapshotAt50);
    for (let f = 50; f < 120; f++) {
      A.session.addLocalInput(p0(f));
      A.session.onRemoteInput(f, p1(f));
      A.session.advanceFrame();
    }

    expect(A.session.currentFrame).toBe(120);
    expect(hashState(A.getSim())).toBe(hashState(truth));
  });
});
