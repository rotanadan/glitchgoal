/**
 * GameState — the complete, serializable simulation state.
 *
 * Everything the sim needs to advance one frame lives here and nothing else
 * does. That invariant is what makes rollback possible: snapshot = serialize(),
 * restore = deserialize(), and re-running step() over the same inputs from a
 * snapshot reproduces the exact same future.
 *
 * All spatial quantities are Fixed (Q16.16).
 */

import { type Fixed, ZERO, ONE } from './fixed.js';
import { createRng, type RngState } from './rng.js';
import {
  RINK_CY,
  SKATER0_SPAWN_X,
  SKATER1_SPAWN_X,
  PUCK_SPAWN_X,
} from './geometry.js';

export interface Body {
  x: Fixed;
  y: Fixed;
  vx: Fixed;
  vy: Fixed;
}

export interface Skater extends Body {
  /** Facing unit vector (Q16.16), used to aim shots and carry the puck. */
  fx: Fixed;
  fy: Fixed;
}

export interface GameState {
  tick: number;
  rng: RngState;
  skaters: [Skater, Skater];
  puck: Body;
  score: [number, number];
  /** >0 while the rink is frozen for a faceoff after a goal. */
  faceoff: number;
  /** Which skater currently carries the puck: -1 (loose), 0, or 1. */
  possessor: number;
  /** Frames a loose puck stays un-pickup-able (after a shot or a check). */
  puckFree: number;
  /** Goalie y positions: [0] = left net (player 0's), [1] = right net. */
  goalies: [Fixed, Fixed];
}

/** Reset positions/velocities to the faceoff arrangement. Mutates in place. */
export function resetPositions(s: GameState): void {
  const sk0 = s.skaters[0];
  sk0.x = SKATER0_SPAWN_X;
  sk0.y = RINK_CY;
  sk0.vx = ZERO;
  sk0.vy = ZERO;
  sk0.fx = ONE; // faces right
  sk0.fy = ZERO;

  const sk1 = s.skaters[1];
  sk1.x = SKATER1_SPAWN_X;
  sk1.y = RINK_CY;
  sk1.vx = ZERO;
  sk1.vy = ZERO;
  sk1.fx = -ONE as Fixed; // faces left
  sk1.fy = ZERO;

  s.puck.x = PUCK_SPAWN_X;
  s.puck.y = RINK_CY;
  s.puck.vx = ZERO;
  s.puck.vy = ZERO;

  s.possessor = -1;
  s.puckFree = 0;
  s.goalies = [RINK_CY, RINK_CY];
}

/** Deterministic initial state for a given seed. */
export function initialState(seed: number): GameState {
  const s: GameState = {
    tick: 0,
    rng: createRng(seed),
    skaters: [
      { x: ZERO, y: ZERO, vx: ZERO, vy: ZERO, fx: ONE, fy: ZERO },
      { x: ZERO, y: ZERO, vx: ZERO, vy: ZERO, fx: -ONE as Fixed, fy: ZERO },
    ],
    puck: { x: ZERO, y: ZERO, vx: ZERO, vy: ZERO },
    score: [0, 0],
    faceoff: 0,
    possessor: -1,
    puckFree: 0,
    goalies: [RINK_CY, RINK_CY],
  };
  resetPositions(s);
  return s;
}

/** Serialized layout sizes (in int32 words). */
const SKATER_WORDS = 6; // x,y,vx,vy,fx,fy
const BODY_WORDS = 4; // x,y,vx,vy
const HEADER_WORDS = 9; // tick, rng.s, score0/1, faceoff, possessor, puckFree, goalie0/1
const TOTAL_WORDS = HEADER_WORDS + 2 * SKATER_WORDS + BODY_WORDS;

/** Serialize to a compact Int32Array snapshot (for rollback save/restore). */
export function serialize(s: GameState): Int32Array {
  const out = new Int32Array(TOTAL_WORDS);
  let i = 0;
  out[i++] = s.tick;
  out[i++] = s.rng.s | 0;
  out[i++] = s.score[0];
  out[i++] = s.score[1];
  out[i++] = s.faceoff;
  out[i++] = s.possessor;
  out[i++] = s.puckFree;
  out[i++] = s.goalies[0];
  out[i++] = s.goalies[1];
  for (const sk of s.skaters) {
    out[i++] = sk.x;
    out[i++] = sk.y;
    out[i++] = sk.vx;
    out[i++] = sk.vy;
    out[i++] = sk.fx;
    out[i++] = sk.fy;
  }
  out[i++] = s.puck.x;
  out[i++] = s.puck.y;
  out[i++] = s.puck.vx;
  out[i++] = s.puck.vy;
  return out;
}

/** Restore a GameState from a snapshot produced by serialize(). */
export function deserialize(buf: Int32Array): GameState {
  let i = 0;
  const tick = buf[i++]!;
  const rngS = buf[i++]! >>> 0;
  const score: [number, number] = [buf[i++]!, buf[i++]!];
  const faceoff = buf[i++]!;
  const possessor = buf[i++]!;
  const puckFree = buf[i++]!;
  const goalies: [Fixed, Fixed] = [buf[i++]! as Fixed, buf[i++]! as Fixed];
  const readSkater = (): Skater => ({
    x: buf[i++]! as Fixed,
    y: buf[i++]! as Fixed,
    vx: buf[i++]! as Fixed,
    vy: buf[i++]! as Fixed,
    fx: buf[i++]! as Fixed,
    fy: buf[i++]! as Fixed,
  });
  const skaters: [Skater, Skater] = [readSkater(), readSkater()];
  const puck: Body = {
    x: buf[i++]! as Fixed,
    y: buf[i++]! as Fixed,
    vx: buf[i++]! as Fixed,
    vy: buf[i++]! as Fixed,
  };
  return { tick, rng: { s: rngS }, skaters, puck, score, faceoff, possessor, puckFree, goalies };
}

/**
 * FNV-1a hash over the serialized snapshot. Used to assert that two
 * simulations (or a sim and its rollback re-run) reached identical state.
 */
export function hashState(s: GameState): number {
  const buf = serialize(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    const word = buf[i]!;
    for (let b = 0; b < 4; b++) {
      h ^= (word >>> (b * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}
