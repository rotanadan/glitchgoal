/**
 * Deterministic collision primitives, all in fixed-point.
 *
 * Contact types: circle-vs-circle (skater/skater, skater/puck) with impulse +
 * positional correction, circle-vs-board (axis-aligned walls), and circle-vs
 * static-post (the goal pipes). The rink is fully enclosed now; a goal is the
 * puck crossing an interior goal line between the posts.
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
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  NET_DEPTH,
  POST_R,
  POST_RESTITUTION,
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

/** Bounce the puck off all four boards (the rink is fully enclosed). */
export function bouncePuckOffBoards(b: Body, radius: Fixed): void {
  clampSkaterToRink(b, radius);
}

/**
 * Resolve a circle against a single immovable point-circle (post or goalie):
 * only the moving body is pushed out and reflected.
 */
export function resolveCircleStatic(b: Body, radius: Fixed, px: Fixed, py: Fixed, postR: Fixed, restitution: Fixed): void {
  const dx = sub(b.x, px);
  const dy = sub(b.y, py);
  const distSq = add(mul(dx, dx), mul(dy, dy));
  const minDist = add(radius, postR);
  if (distSq >= mul(minDist, minDist)) return;

  let dist = sqrt(distSq);
  let nx: Fixed;
  let ny: Fixed;
  if (dist === ZERO) {
    nx = ONE;
    ny = ZERO;
    dist = ONE;
  } else {
    nx = div(dx, dist);
    ny = div(dy, dist);
  }
  // Push the body out of the post.
  const pen = sub(minDist, dist);
  b.x = add(b.x, mul(nx, pen));
  b.y = add(b.y, mul(ny, pen));
  // Reflect velocity if moving into the post.
  const vn = add(mul(b.vx, nx), mul(b.vy, ny));
  if (vn < ZERO) {
    const j = mul(add(ONE, restitution), vn);
    b.vx = sub(b.vx, mul(nx, j));
    b.vy = sub(b.vy, mul(ny, j));
  }
}

/** Solid vertical wall segment at x=wallX spanning [y0,y1] — bounce on either side. */
function resolveVWall(b: Body, radius: Fixed, wallX: Fixed, y0: Fixed, y1: Fixed, rest: Fixed): void {
  if (b.y < sub(y0, radius) || b.y > add(y1, radius)) return;
  const dx = sub(b.x, wallX);
  if (dx >= ZERO) {
    if (dx < radius) {
      b.x = add(wallX, radius);
      if (b.vx < ZERO) b.vx = neg(mul(b.vx, rest));
    }
  } else if (neg(dx) < radius) {
    b.x = sub(wallX, radius);
    if (b.vx > ZERO) b.vx = neg(mul(b.vx, rest));
  }
}

/** Solid horizontal wall segment at y=wallY spanning [x0,x1] — bounce on either side. */
function resolveHWall(b: Body, radius: Fixed, wallY: Fixed, x0: Fixed, x1: Fixed, rest: Fixed): void {
  if (b.x < sub(x0, radius) || b.x > add(x1, radius)) return;
  const dy = sub(b.y, wallY);
  if (dy >= ZERO) {
    if (dy < radius) {
      b.y = add(wallY, radius);
      if (b.vy < ZERO) b.vy = neg(mul(b.vy, rest));
    }
  } else if (neg(dy) < radius) {
    b.y = sub(wallY, radius);
    if (b.vy > ZERO) b.vy = neg(mul(b.vy, rest));
  }
}

/**
 * Resolve a body against the solid parts of both nets: back wall + the two side
 * walls. The front (the mouth between the posts) is open, so the only way into a
 * net is from the front — you can't score through the side or back.
 */
export function resolveNetWalls(b: Body, radius: Fixed): void {
  const topY = sub(RINK_CY, GOAL_HALF_H);
  const botY = add(RINK_CY, GOAL_HALF_H);
  const lBack = sub(GOAL_LINE_LEFT, NET_DEPTH);
  const rBack = add(GOAL_LINE_RIGHT, NET_DEPTH);

  // Left net.
  resolveVWall(b, radius, lBack, topY, botY, WALL_RESTITUTION);
  resolveHWall(b, radius, topY, lBack, GOAL_LINE_LEFT, WALL_RESTITUTION);
  resolveHWall(b, radius, botY, lBack, GOAL_LINE_LEFT, WALL_RESTITUTION);
  // Right net.
  resolveVWall(b, radius, rBack, topY, botY, WALL_RESTITUTION);
  resolveHWall(b, radius, topY, GOAL_LINE_RIGHT, rBack, WALL_RESTITUTION);
  resolveHWall(b, radius, botY, GOAL_LINE_RIGHT, rBack, WALL_RESTITUTION);
}

/** Resolve a body against all four goal posts. */
export function resolvePosts(b: Body, radius: Fixed): void {
  const topY = sub(RINK_CY, GOAL_HALF_H);
  const botY = add(RINK_CY, GOAL_HALF_H);
  resolveCircleStatic(b, radius, GOAL_LINE_LEFT, topY, POST_R, POST_RESTITUTION);
  resolveCircleStatic(b, radius, GOAL_LINE_LEFT, botY, POST_R, POST_RESTITUTION);
  resolveCircleStatic(b, radius, GOAL_LINE_RIGHT, topY, POST_R, POST_RESTITUTION);
  resolveCircleStatic(b, radius, GOAL_LINE_RIGHT, botY, POST_R, POST_RESTITUTION);
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
 * Returns the index of the player who scored, or -1. A goal is the puck INSIDE a
 * net cage — past the goal line but not past the back wall — and between the
 * posts. Because the back/sides are solid, the cage is only reachable from the
 * front, so this can't trigger from a puck beside or behind the net.
 */
export function detectGoal(puck: Body): number {
  if (!inGoalMouth(puck.y)) return -1;
  if (puck.x < GOAL_LINE_LEFT && puck.x > sub(GOAL_LINE_LEFT, NET_DEPTH)) return 1;
  if (puck.x > GOAL_LINE_RIGHT && puck.x < add(GOAL_LINE_RIGHT, NET_DEPTH)) return 0;
  return -1;
}
