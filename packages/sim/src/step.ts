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

import { add, sub, neg, mul, div, sqrt, clamp, fromInt, type Fixed, ZERO, ONE } from './fixed.js';
import { hasButton, Button, type PlayerInput } from './input.js';
import { nextU32 } from './rng.js';
import { resetPositions, type Body, type Skater, type GameState } from './state.js';
import {
  resolveCircleCircle,
  clampSkaterToRink,
  bouncePuckOffBoards,
  resolvePosts,
  resolveNetWalls,
  resolveCircleStatic,
  clampSpeed,
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
  SHOT_SPREAD,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  POSSESSION_OFFSET,
  PICKUP_RADIUS,
  STEAL_RADIUS,
  PICKUP_DELAY,
  KNOCK_DELAY,
  FACEOFF_TICKS,
  MAX_SKATER_SPEED,
  MAX_PUCK_SPEED,
  RINK_CY,
  GOAL_HALF_H,
  GOALIE_R,
  GOALIE_LEFT_X,
  GOALIE_RIGHT_X,
  GOALIE_SPEED,
  GOALIE_RESTITUTION,
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

/** Glue the carried puck to the front of its carrier (on the stick). */
function carryPuck(carrier: Skater, puck: Body): void {
  puck.x = add(carrier.x, mul(carrier.fx, POSSESSION_OFFSET));
  puck.y = add(carrier.y, mul(carrier.fy, POSSESSION_OFFSET));
  puck.vx = carrier.vx;
  puck.vy = carrier.vy;
}

function integrate(b: Body, damping: Fixed): void {
  b.vx = mul(b.vx, damping);
  b.vy = mul(b.vy, damping);
  b.x = add(b.x, b.vx);
  b.y = add(b.y, b.vy);
}

/**
 * Direction of a shot at the opponent's net (player 0 -> right, player 1 -> left)
 * with accuracy-based random spread. The spread is deterministic (sim RNG), so
 * both peers compute the identical shot.
 */
function shotDirection(state: GameState, carrier: Skater, possessor: 0 | 1): { nx: Fixed; ny: Fixed } {
  const targetX = possessor === 0 ? GOAL_LINE_RIGHT : GOAL_LINE_LEFT;
  const aim = normalize(sub(targetX, carrier.x), sub(RINK_CY, carrier.y));
  const maxErr = mul(SHOT_SPREAD, sub(ONE, carrier.accuracy));
  const r = (nextU32(state.rng) % 2001) - 1000; // -1000..1000
  const err = mul(div(fromInt(r), fromInt(1000)), maxErr); // [-maxErr, maxErr]
  // Deflect along the perpendicular (-ny, nx) and renormalize.
  return normalize(add(aim.nx, mul(neg(aim.ny), err)), add(aim.ny, mul(aim.nx, err)));
}

/** Move `a` toward `b` by at most `maxStep`. */
function stepToward(a: Fixed, b: Fixed, maxStep: Fixed): Fixed {
  const d = sub(b, a);
  if (d > maxStep) return add(a, maxStep);
  if (d < neg(maxStep)) return sub(a, maxStep);
  return b;
}

/**
 * Update one goalie: deterministically track the puck's y within the mouth, then
 * block the puck (if loose) and both skaters as an immovable collider.
 */
function updateGoalie(state: GameState, idx: 0 | 1, gx: Fixed): void {
  const lo = sub(RINK_CY, GOAL_HALF_H);
  const hi = add(RINK_CY, GOAL_HALF_H);
  const target = clamp(state.puck.y, lo, hi);
  const gy = stepToward(state.goalies[idx], target, GOALIE_SPEED);
  state.goalies[idx] = gy;

  resolveCircleStatic(state.skaters[0], SKATER_R, gx, gy, GOALIE_R, GOALIE_RESTITUTION);
  resolveCircleStatic(state.skaters[1], SKATER_R, gx, gy, GOALIE_R, GOALIE_RESTITUTION);
  if (state.possessor < 0) {
    resolveCircleStatic(state.puck, PUCK_R, gx, gy, GOALIE_R, GOALIE_RESTITUTION);
  }
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

  // Inputs: steering (facing).
  applyInput(sk0, inputs[0]);
  applyInput(sk1, inputs[1]);

  // Integrate skaters.
  integrate(sk0, SKATER_DAMPING);
  integrate(sk1, SKATER_DAMPING);

  // Puck possession.
  if (state.possessor === 0 || state.possessor === 1) {
    const carrier = state.skaters[state.possessor];
    const oppIdx = state.possessor === 0 ? 1 : 0;
    const opponent = state.skaters[oppIdx];
    const stealR = STEAL_RADIUS;

    if (distSq(carrier, opponent) <= mul(stealR, stealR)) {
      // Checked: the puck is knocked loose, keeping the carrier's momentum.
      puck.x = carrier.x;
      puck.y = carrier.y;
      puck.vx = carrier.vx;
      puck.vy = carrier.vy;
      state.possessor = -1;
      state.puckFree = KNOCK_DELAY;
    } else if (hasButton(inputs[state.possessor], Button.Action)) {
      // Shoot at the opponent's net, with accuracy-based spread.
      const dir = shotDirection(state, carrier, state.possessor);
      puck.x = add(carrier.x, mul(dir.nx, POSSESSION_OFFSET));
      puck.y = add(carrier.y, mul(dir.ny, POSSESSION_OFFSET));
      puck.vx = mul(dir.nx, SHOT_SPEED);
      puck.vy = mul(dir.ny, SHOT_SPEED);
      state.possessor = -1;
      state.puckFree = PICKUP_DELAY;
    } else {
      // Keep carrying.
      carryPuck(carrier, puck);
    }
  } else {
    // Loose puck: free physics, then maybe picked up.
    integrate(puck, PUCK_DAMPING);
    if (state.puckFree > 0) state.puckFree--;
    resolveCircleCircle(sk0, puck, SKATER_R, PUCK_R, SKATER_INV_MASS, PUCK_INV_MASS, PUCK_SKATER_RESTITUTION);
    resolveCircleCircle(sk1, puck, SKATER_R, PUCK_R, SKATER_INV_MASS, PUCK_INV_MASS, PUCK_SKATER_RESTITUTION);

    if (state.puckFree === 0) {
      const r2 = mul(PICKUP_RADIUS, PICKUP_RADIUS);
      const d0 = distSq(sk0, puck);
      const d1 = distSq(sk1, puck);
      const in0 = d0 <= r2;
      const in1 = d1 <= r2;
      if (in0 && in1) state.possessor = d0 <= d1 ? 0 : 1; // closer wins, tie -> p0
      else if (in0) state.possessor = 0;
      else if (in1) state.possessor = 1;
    }
  }

  // Skater-skater collision (always).
  resolveCircleCircle(sk0, sk1, SKATER_R, SKATER_R, SKATER_INV_MASS, SKATER_INV_MASS, SKATER_SKATER_RESTITUTION);

  // Boards + goal posts (skaters always; the puck only when loose — carried it
  // tracks the skater).
  clampSkaterToRink(sk0, SKATER_R);
  clampSkaterToRink(sk1, SKATER_R);
  resolveNetWalls(sk0, SKATER_R);
  resolveNetWalls(sk1, SKATER_R);
  resolvePosts(sk0, SKATER_R);
  resolvePosts(sk1, SKATER_R);
  if (state.possessor < 0) {
    bouncePuckOffBoards(puck, PUCK_R);
    resolveNetWalls(puck, PUCK_R);
    resolvePosts(puck, PUCK_R);
  }

  // Goalies track the puck and block shots / carriers.
  updateGoalie(state, 0, GOALIE_LEFT_X);
  updateGoalie(state, 1, GOALIE_RIGHT_X);

  // Cap speeds so collision resolution can't inject runaway energy.
  clampSpeed(sk0, MAX_SKATER_SPEED);
  clampSpeed(sk1, MAX_SKATER_SPEED);
  if (state.possessor < 0) clampSpeed(puck, MAX_PUCK_SPEED);

  // Goal? Only a LOOSE puck can score — you must shoot it in (past the goalie),
  // not carry/walk it through the mouth or side.
  const scorer = state.possessor < 0 ? detectGoal(puck) : -1;
  if (scorer === 0 || scorer === 1) {
    state.score[scorer]++;
    resetPositions(state);
    state.faceoff = FACEOFF_TICKS;
  }

  return state;
}
