/**
 * step() — the heart of the deterministic simulation.
 *
 * Contract: transition (state, inputs) -> next state. It may mutate the passed
 * in state for performance (the rollback layer hands it a freshly restored
 * snapshot), but given identical (state, inputs) it MUST always produce
 * identical output on every machine. No floats, no Math.random, no Date.now, no
 * iteration over unordered collections.
 *
 * Frame order: input (facing/accel/shoot) -> integrate -> resolve collisions
 * -> board bounces -> goal check -> faceoff bookkeeping.
 */

import { add, mul, div, sqrt, type Fixed, ZERO, ONE } from './fixed.js';
import { hasButton, Button, type PlayerInput } from './input.js';
import { nextU32 } from './rng.js';
import { resetPositions, type Body, type Skater, type GameState } from './state.js';
import {
  resolveCircleCircle,
  clampSkaterToRink,
  bouncePuckOffBoards,
  detectGoal,
} from './physics.js';
import {
  PUCK_R,
  SKATER_R,
  PUCK_INV_MASS,
  SKATER_INV_MASS,
  PUCK_SKATER_RESTITUTION,
  SKATER_SKATER_RESTITUTION,
  SKATER_ACCEL,
  SKATER_DAMPING,
  PUCK_DAMPING,
  SHOT_SPEED,
  SHOT_REACH,
  SHOT_COOLDOWN,
  FACEOFF_TICKS,
} from './geometry.js';

/** Read the 8-direction d-pad into a raw direction vector (components -1/0/1). */
function inputDir(input: PlayerInput): { dx: Fixed; dy: Fixed } {
  let dx = ZERO;
  let dy = ZERO;
  if (hasButton(input, Button.Left)) dx = -ONE as Fixed;
  if (hasButton(input, Button.Right)) dx = ONE;
  if (hasButton(input, Button.Up)) dy = -ONE as Fixed;
  if (hasButton(input, Button.Down)) dy = ONE;
  return { dx, dy };
}

/** Normalize a non-zero (dx,dy) to a fixed-point unit vector. */
function normalize(dx: Fixed, dy: Fixed): { nx: Fixed; ny: Fixed } {
  const lenSq = add(mul(dx, dx), mul(dy, dy));
  if (lenSq === ZERO) return { nx: ZERO, ny: ZERO };
  const len = sqrt(lenSq);
  return { nx: div(dx, len), ny: div(dy, len) };
}

function applyInput(sk: Skater, input: PlayerInput): void {
  const { dx, dy } = inputDir(input);
  if (dx !== ZERO || dy !== ZERO) {
    const { nx, ny } = normalize(dx, dy);
    sk.vx = add(sk.vx, mul(nx, SKATER_ACCEL));
    sk.vy = add(sk.vy, mul(ny, SKATER_ACCEL));
    // Facing only updates while actively steering, so shots keep last heading.
    sk.fx = nx;
    sk.fy = ny;
  }
}

/** Distance-squared between two bodies. */
function distSq(a: Body, b: Body): Fixed {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return add(mul(dx as Fixed, dx as Fixed), mul(dy as Fixed, dy as Fixed));
}

function tryShoot(sk: Skater, puck: Body): void {
  if (sk.cooldown > 0) {
    sk.cooldown--;
    return;
  }
  const reach = add(add(SKATER_R, PUCK_R), SHOT_REACH);
  if (distSq(sk, puck) <= mul(reach, reach)) {
    puck.vx = mul(sk.fx, SHOT_SPEED);
    puck.vy = mul(sk.fy, SHOT_SPEED);
    sk.cooldown = SHOT_COOLDOWN;
  }
}

function integrate(b: Body, damping: Fixed): void {
  b.vx = mul(b.vx, damping);
  b.vy = mul(b.vy, damping);
  b.x = add(b.x, b.vx);
  b.y = add(b.y, b.vy);
}

/** Advance one fixed timestep. */
export function step(state: GameState, inputs: [PlayerInput, PlayerInput]): GameState {
  const [sk0, sk1] = state.skaters;
  const puck = state.puck;

  // Always advance the RNG once per tick so its stream stays frame-aligned,
  // even during a faceoff freeze.
  nextU32(state.rng);
  state.tick++;

  if (state.faceoff > 0) {
    state.faceoff--;
    return state;
  }

  // Inputs: steering + shooting.
  applyInput(sk0, inputs[0]);
  applyInput(sk1, inputs[1]);
  if (hasButton(inputs[0], Button.Action)) tryShoot(sk0, puck);
  else if (sk0.cooldown > 0) sk0.cooldown--;
  if (hasButton(inputs[1], Button.Action)) tryShoot(sk1, puck);
  else if (sk1.cooldown > 0) sk1.cooldown--;

  // Integrate.
  integrate(sk0, SKATER_DAMPING);
  integrate(sk1, SKATER_DAMPING);
  integrate(puck, PUCK_DAMPING);

  // Collisions (fixed, deterministic order).
  resolveCircleCircle(sk0, sk1, SKATER_R, SKATER_R, SKATER_INV_MASS, SKATER_INV_MASS, SKATER_SKATER_RESTITUTION);
  resolveCircleCircle(sk0, puck, SKATER_R, PUCK_R, SKATER_INV_MASS, PUCK_INV_MASS, PUCK_SKATER_RESTITUTION);
  resolveCircleCircle(sk1, puck, SKATER_R, PUCK_R, SKATER_INV_MASS, PUCK_INV_MASS, PUCK_SKATER_RESTITUTION);

  // Boards.
  clampSkaterToRink(sk0, SKATER_R);
  clampSkaterToRink(sk1, SKATER_R);
  bouncePuckOffBoards(puck, PUCK_R);

  // Goal?
  const scorer = detectGoal(puck);
  if (scorer === 0 || scorer === 1) {
    state.score[scorer]++;
    resetPositions(state);
    state.faceoff = FACEOFF_TICKS;
  }

  return state;
}
