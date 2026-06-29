/**
 * GameState — the complete, serializable simulation state.
 *
 * Everything the sim needs to advance one frame lives here and nothing else
 * does. That invariant is what makes rollback possible: snapshot = serialize(),
 * restore = deserialize(), and re-running step() over the same inputs from a
 * snapshot reproduces the exact same future.
 *
 * All spatial quantities are Fixed (Q16.16). There are 8 skaters: indices 0-3
 * are team 0, 4-7 are team 1.
 */

import { type Fixed, ZERO, ONE } from './fixed.js';
import { createRng, type RngState } from './rng.js';
import {
  SKATERS_PER_TEAM,
  SPAWN_X,
  SPAWN_Y,
  RINK_CY,
  PUCK_SPAWN_X,
  DEFAULT_ACCURACY,
} from './geometry.js';

const SKATER_COUNT = SKATERS_PER_TEAM * 2;

export interface Body {
  x: Fixed;
  y: Fixed;
  vx: Fixed;
  vy: Fixed;
}

export interface Skater extends Body {
  /** Facing unit vector (Q16.16), used to carry the puck and aim the stick. */
  fx: Fixed;
  fy: Fixed;
  /** Shooting accuracy stat (0..1). Higher = less spread. */
  accuracy: Fixed;
  /** Frames this skater can't pick up the puck (after being checked off it). */
  pickupCooldown: number;
}

export interface GameState {
  tick: number;
  rng: RngState;
  /** 8 skaters: 0-3 = team 0, 4-7 = team 1. */
  skaters: Skater[];
  puck: Body;
  score: [number, number];
  /** >0 while the rink is frozen for a faceoff after a goal. */
  faceoff: number;
  /** Which skater carries the puck: -1 (loose), or a global index 0-7. */
  possessor: number;
  /** Frames a loose puck stays un-pickup-able (after a shot or a check). */
  puckFree: number;
  /** Goalie y positions: [0] = left net (team 0's), [1] = right net. */
  goalies: [Fixed, Fixed];
  /** Which team-slot (0-3) each team's human currently controls. */
  controlled: [number, number];
  /** Edge-detect latch for the Switch button, per team (0/1). */
  switchLatch: [number, number];
  /** Frames the shoot button has been held (charge), per team. */
  shotCharge: [number, number];
}

/** A skater's team (0 or 1) from its global index. */
export function teamOf(index: number): 0 | 1 {
  return index < SKATERS_PER_TEAM ? 0 : 1;
}

/** Reset skater/puck/goalie positions to the faceoff arrangement. */
export function resetPositions(s: GameState): void {
  for (let i = 0; i < SKATER_COUNT; i++) {
    const sk = s.skaters[i]!;
    sk.x = SPAWN_X[i]!;
    sk.y = SPAWN_Y[i]!;
    sk.vx = ZERO;
    sk.vy = ZERO;
    sk.fx = teamOf(i) === 0 ? ONE : (-ONE as Fixed); // face the attacking direction
    sk.fy = ZERO;
    sk.pickupCooldown = 0;
  }
  s.puck.x = PUCK_SPAWN_X;
  s.puck.y = RINK_CY;
  s.puck.vx = ZERO;
  s.puck.vy = ZERO;

  s.possessor = -1;
  s.puckFree = 0;
  s.goalies = [RINK_CY, RINK_CY];
  s.shotCharge = [0, 0];
}

function newSkater(): Skater {
  return { x: ZERO, y: ZERO, vx: ZERO, vy: ZERO, fx: ONE, fy: ZERO, accuracy: DEFAULT_ACCURACY, pickupCooldown: 0 };
}

/** Deterministic initial state for a given seed. */
export function initialState(seed: number): GameState {
  const skaters: Skater[] = [];
  for (let i = 0; i < SKATER_COUNT; i++) skaters.push(newSkater());
  const s: GameState = {
    tick: 0,
    rng: createRng(seed),
    skaters,
    puck: { x: ZERO, y: ZERO, vx: ZERO, vy: ZERO },
    score: [0, 0],
    faceoff: 0,
    possessor: -1,
    puckFree: 0,
    goalies: [RINK_CY, RINK_CY],
    controlled: [0, 0],
    switchLatch: [0, 0],
    shotCharge: [0, 0],
  };
  resetPositions(s);
  return s;
}

/** Serialized layout sizes (in int32 words). */
const SKATER_WORDS = 8; // x,y,vx,vy,fx,fy,accuracy,pickupCooldown
const BODY_WORDS = 4; // x,y,vx,vy
// tick, rng.s, score0/1, faceoff, possessor, puckFree, goalie0/1, ctrl0/1,
// latch0/1, charge0/1
const HEADER_WORDS = 15;
const TOTAL_WORDS = HEADER_WORDS + SKATER_COUNT * SKATER_WORDS + BODY_WORDS;

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
  out[i++] = s.controlled[0];
  out[i++] = s.controlled[1];
  out[i++] = s.switchLatch[0];
  out[i++] = s.switchLatch[1];
  out[i++] = s.shotCharge[0];
  out[i++] = s.shotCharge[1];
  for (const sk of s.skaters) {
    out[i++] = sk.x;
    out[i++] = sk.y;
    out[i++] = sk.vx;
    out[i++] = sk.vy;
    out[i++] = sk.fx;
    out[i++] = sk.fy;
    out[i++] = sk.accuracy;
    out[i++] = sk.pickupCooldown;
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
  const controlled: [number, number] = [buf[i++]!, buf[i++]!];
  const switchLatch: [number, number] = [buf[i++]!, buf[i++]!];
  const shotCharge: [number, number] = [buf[i++]!, buf[i++]!];
  const readSkater = (): Skater => ({
    x: buf[i++]! as Fixed,
    y: buf[i++]! as Fixed,
    vx: buf[i++]! as Fixed,
    vy: buf[i++]! as Fixed,
    fx: buf[i++]! as Fixed,
    fy: buf[i++]! as Fixed,
    accuracy: buf[i++]! as Fixed,
    pickupCooldown: buf[i++]!,
  });
  const skaters: Skater[] = [];
  for (let n = 0; n < SKATER_COUNT; n++) skaters.push(readSkater());
  const puck: Body = {
    x: buf[i++]! as Fixed,
    y: buf[i++]! as Fixed,
    vx: buf[i++]! as Fixed,
    vy: buf[i++]! as Fixed,
  };
  return { tick, rng: { s: rngS }, skaters, puck, score, faceoff, possessor, puckFree, goalies, controlled, switchLatch, shotCharge };
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
