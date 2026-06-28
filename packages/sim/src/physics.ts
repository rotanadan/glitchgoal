/**
 * Deterministic collision primitives, all in fixed-point.
 *
 * Two contact types: circle-vs-circle (skater/skater, skater/puck) resolved with
 * an impulse + positional correction, and circle-vs-board (axis-aligned walls)
 * resolved by clamping position and reflecting velocity. The end boards have a
 * goal mouth gap that the puck (but not skaters) can pass through.
 */

import {
  add,
  sub,
  mul,
  div,
  neg,
  sqrt,
  type Fixed,
  ZERO,
  ONE,
} from './fixed.js';
import type { Body } from './state.js';
import {
  RINK_W,
  RINK_H,
  RINK_CY,
  GOAL_HALF_H,
  WALL_RESTITUTION,
} from './geometry.js';

/**
 * Resolve a circle-vs-circle collision between two bodies using inverse masses.
 * Returns true if they were overlapping (and were separated). A larger inverse
 * mass means the body is pushed more — the puck (high invMass) flies off skaters
 * (low invMass) while the skaters barely budge.
 */
export function resolveCircleCircle(
  a: Body,
  b: Body,
  ra: Fixed,
  rb: Fixed,
  invMassA: Fixed,
  invMassB: Fixed,
  restitution: Fixed,
): boolean {
  const dx = sub(b.x, a.x);
  const dy = sub(b.y, a.y);
  const distSq = add(mul(dx, dx), mul(dy, dy));
  const minDist = add(ra, rb);
  if (distSq >= mul(minDist, minDist)) return false;

  let dist = sqrt(distSq);
  let nx: Fixed;
  let ny: Fixed;
  if (dist === ZERO) {
    // Perfectly overlapping: pick a deterministic arbitrary normal.
    nx = ONE;
    ny = ZERO;
    dist = ONE;
  } else {
    nx = div(dx, dist);
    ny = div(dy, dist);
  }

  const totalInv = add(invMassA, invMassB);
  const penetration = sub(minDist, dist);

  // Positional correction, split by inverse mass.
  const corrA = mul(penetration, div(invMassA, totalInv));
  const corrB = mul(penetration, div(invMassB, totalInv));
  a.x = sub(a.x, mul(nx, corrA));
  a.y = sub(a.y, mul(ny, corrA));
  b.x = add(b.x, mul(nx, corrB));
  b.y = add(b.y, mul(ny, corrB));

  // Relative velocity along the normal.
  const rvx = sub(b.vx, a.vx);
  const rvy = sub(b.vy, a.vy);
  const velAlongNormal = add(mul(rvx, nx), mul(rvy, ny));
  if (velAlongNormal > ZERO) return true; // already separating

  const j = div(neg(mul(add(ONE, restitution), velAlongNormal)), totalInv);
  const ix = mul(j, nx);
  const iy = mul(j, ny);
  a.vx = sub(a.vx, mul(ix, invMassA));
  a.vy = sub(a.vy, mul(iy, invMassA));
  b.vx = add(b.vx, mul(ix, invMassB));
  b.vy = add(b.vy, mul(iy, invMassB));
  return true;
}

/** Reflect a skater off all four boards (skaters can never leave the rink). */
export function clampSkaterToRink(b: Body, radius: Fixed): void {
  const minX = radius;
  const maxX = sub(RINK_W, radius);
  const minY = radius;
  const maxY = sub(RINK_H, radius);

  if (b.x < minX) {
    b.x = minX;
    if (b.vx < ZERO) b.vx = mul(neg(b.vx), WALL_RESTITUTION);
  } else if (b.x > maxX) {
    b.x = maxX;
    if (b.vx > ZERO) b.vx = neg(mul(b.vx, WALL_RESTITUTION));
  }
  if (b.y < minY) {
    b.y = minY;
    if (b.vy < ZERO) b.vy = mul(neg(b.vy), WALL_RESTITUTION);
  } else if (b.y > maxY) {
    b.y = maxY;
    if (b.vy > ZERO) b.vy = neg(mul(b.vy, WALL_RESTITUTION));
  }
}

/** True if a y-coordinate falls within the goal-mouth opening. */
function inGoalMouth(y: Fixed): boolean {
  return y > sub(RINK_CY, GOAL_HALF_H) && y < add(RINK_CY, GOAL_HALF_H);
}

/**
 * Bounce the puck off boards. Top/bottom always bounce; left/right bounce
 * EXCEPT within the goal mouth, where the puck is allowed to pass through so
 * goal detection can fire.
 */
export function bouncePuckOffBoards(b: Body, radius: Fixed): void {
  const minY = radius;
  const maxY = sub(RINK_H, radius);
  if (b.y < minY) {
    b.y = minY;
    if (b.vy < ZERO) b.vy = mul(neg(b.vy), WALL_RESTITUTION);
  } else if (b.y > maxY) {
    b.y = maxY;
    if (b.vy > ZERO) b.vy = neg(mul(b.vy, WALL_RESTITUTION));
  }

  const minX = radius;
  const maxX = sub(RINK_W, radius);
  if (b.x < minX && !inGoalMouth(b.y)) {
    b.x = minX;
    if (b.vx < ZERO) b.vx = mul(neg(b.vx), WALL_RESTITUTION);
  } else if (b.x > maxX && !inGoalMouth(b.y)) {
    b.x = maxX;
    if (b.vx > ZERO) b.vx = neg(mul(b.vx, WALL_RESTITUTION));
  }
}

/**
 * Clamp a body's speed to `max` (fixed-point). Bounds the energy that the
 * collision resolver can inject when bodies are squeezed together, preventing
 * the simulation from blowing up.
 */
export function clampSpeed(b: Body, max: Fixed): void {
  const speedSq = add(mul(b.vx, b.vx), mul(b.vy, b.vy));
  if (speedSq <= mul(max, max)) return;
  const speed = sqrt(speedSq);
  const scale = div(max, speed);
  b.vx = mul(b.vx, scale);
  b.vy = mul(b.vy, scale);
}

/**
 * Returns the index of the player who scored, or -1. The puck fully crossing
 * the LEFT goal line is a goal for player 1; crossing the RIGHT line is a goal
 * for player 0.
 */
export function detectGoal(puck: Body): number {
  if (!inGoalMouth(puck.y)) return -1;
  if (puck.x < ZERO) return 1;
  if (puck.x > RINK_W) return 0;
  return -1;
}
