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
import { resetPositions, teamOf, type Body, type Skater, type GameState } from './state.js';
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
  SHOT_SPEED_MAX,
  CHECK_PICKUP_COOLDOWN,
  SHOT_SPREAD,
  SHOT_MAX_CHARGE,
  CHARGE_SPREAD,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  POSSESSION_OFFSET,
  PICKUP_RADIUS,
  STEAL_RADIUS,
  PICKUP_DELAY,
  KNOCK_DELAY,
  PASS_SPEED,
  PASS_DELAY,
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
  SKATERS_PER_TEAM,
  LANE_Y,
  AI_DEADZONE,
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
function shotDirection(state: GameState, carrier: Skater, team: 0 | 1, extraSpread: Fixed): { nx: Fixed; ny: Fixed } {
  const targetX = team === 0 ? GOAL_LINE_RIGHT : GOAL_LINE_LEFT;
  const aim = normalize(sub(targetX, carrier.x), sub(RINK_CY, carrier.y));
  const maxErr = mul(SHOT_SPREAD, add(sub(ONE, carrier.accuracy), extraSpread));
  const r = (nextU32(state.rng) % 2001) - 1000; // -1000..1000
  const err = mul(div(fromInt(r), fromInt(1000)), maxErr); // [-maxErr, maxErr]
  // Deflect along the perpendicular (-ny, nx) and renormalize.
  return normalize(add(aim.nx, mul(neg(aim.ny), err)), add(aim.ny, mul(aim.nx, err)));
}

/** Accelerate an AI skater toward a target point and face that way. */
function moveToward(sk: Skater, tx: Fixed, ty: Fixed): void {
  const dx = sub(tx, sk.x);
  const dy = sub(ty, sk.y);
  if (add(mul(dx, dx), mul(dy, dy)) <= mul(AI_DEADZONE, AI_DEADZONE)) return;
  const { nx, ny } = normalize(dx, dy);
  sk.vx = add(sk.vx, mul(nx, SKATER_ACCEL));
  sk.vy = add(sk.vy, mul(ny, SKATER_ACCEL));
  sk.fx = nx;
  sk.fy = ny;
}

/** The team-slot (0-3) of the team `t` skater nearest the puck. */
function nearestSlotToPuck(state: GameState, t: 0 | 1): number {
  const base = t * SKATERS_PER_TEAM;
  let best = 0;
  let bestD = distSq(state.skaters[base]!, state.puck);
  for (let s = 1; s < SKATERS_PER_TEAM; s++) {
    const d = distSq(state.skaters[base + s]!, state.puck);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Pick the teammate to pass to: the one best matching the held direction; if no
 * direction is held (or no teammate lies that way), the nearest teammate.
 */
function choosePassTarget(state: GameState, carrierIdx: number, input: PlayerInput): number {
  const t = teamOf(carrierIdx);
  const base = t * SKATERS_PER_TEAM;
  const carrier = state.skaters[carrierIdx]!;
  const { dx, dy } = inputDir(input);
  const hasDir = !(dx === ZERO && dy === ZERO);

  let dirBest = -1;
  let dirScore = ZERO;
  let nearBest = -1;
  let nearScore = ZERO;
  for (let s = 0; s < SKATERS_PER_TEAM; s++) {
    const gi = base + s;
    if (gi === carrierIdx) continue;
    const ox = sub(state.skaters[gi]!.x, carrier.x);
    const oy = sub(state.skaters[gi]!.y, carrier.y);
    const d2 = add(mul(ox, ox), mul(oy, oy));
    if (nearBest < 0 || d2 < nearScore) {
      nearBest = gi;
      nearScore = d2;
    }
    if (hasDir) {
      const dot = add(mul(ox, dx), mul(oy, dy));
      if (dot > ZERO && (dirBest < 0 || dot > dirScore)) {
        dirBest = gi;
        dirScore = dot;
      }
    }
  }
  return dirBest >= 0 ? dirBest : nearBest;
}

/** Pass the carried puck to a teammate and hand control to the receiver. */
function passPuck(state: GameState, t: 0 | 1, input: PlayerInput): void {
  const carrierIdx = state.possessor;
  const carrier = state.skaters[carrierIdx]!;
  const target = choosePassTarget(state, carrierIdx, input);
  if (target < 0) return;
  const tgt = state.skaters[target]!;
  const dir = normalize(sub(tgt.x, carrier.x), sub(tgt.y, carrier.y));
  const puck = state.puck;
  puck.x = add(carrier.x, mul(dir.nx, POSSESSION_OFFSET));
  puck.y = add(carrier.y, mul(dir.ny, POSSESSION_OFFSET));
  puck.vx = mul(dir.nx, PASS_SPEED);
  puck.vy = mul(dir.ny, PASS_SPEED);
  state.possessor = -1;
  state.puckFree = PASS_DELAY;
  state.shotCharge[t] = 0; // passing cancels any charge
  state.controlled[t] = target - t * SKATERS_PER_TEAM; // follow the pass
}

/**
 * Update one goalie: the controlling team moves it up/down with Up/Down (it does
 * NOT track the puck), clamped to the goal mouth. Then it blocks shots/skaters
 * as an immovable collider.
 */
function updateGoalie(state: GameState, idx: 0 | 1, gx: Fixed, input: PlayerInput): void {
  const lo = sub(RINK_CY, GOAL_HALF_H);
  const hi = add(RINK_CY, GOAL_HALF_H);
  let gy = state.goalies[idx];
  if (hasButton(input, Button.Up)) gy = sub(gy, GOALIE_SPEED);
  if (hasButton(input, Button.Down)) gy = add(gy, GOALIE_SPEED);
  gy = clamp(gy, lo, hi);
  state.goalies[idx] = gy;

  for (const sk of state.skaters) {
    resolveCircleStatic(sk, SKATER_R, gx, gy, GOALIE_R, GOALIE_RESTITUTION);
  }
  if (state.possessor < 0) {
    resolveCircleStatic(state.puck, PUCK_R, gx, gy, GOALIE_R, GOALIE_RESTITUTION);
  }
}

/** The global index of the skater team `t`'s human currently controls. */
function controlledIndex(state: GameState, t: 0 | 1): number {
  return t * SKATERS_PER_TEAM + state.controlled[t];
}

/** Advance one fixed timestep. */
export function step(state: GameState, inputs: [PlayerInput, PlayerInput]): GameState {
  const skaters = state.skaters;
  const puck = state.puck;
  const n = skaters.length;

  // Always advance the RNG once per tick so its stream stays frame-aligned,
  // even during a faceoff freeze.
  nextU32(state.rng);
  state.tick++;

  if (state.faceoff > 0) {
    state.faceoff--;
    return state;
  }

  // Switch button (edge-triggered): if your team carries the puck, PASS it to the
  // teammate in the held direction; otherwise switch control to the teammate
  // nearest the puck.
  for (const t of [0, 1] as const) {
    if (hasButton(inputs[t], Button.Switch)) {
      if (state.switchLatch[t] === 0) {
        state.switchLatch[t] = 1;
        if (state.possessor >= 0 && teamOf(state.possessor) === t) {
          passPuck(state, t, inputs[t]);
        } else {
          state.controlled[t] = nearestSlotToPuck(state, t);
        }
      }
    } else {
      state.switchLatch[t] = 0;
    }
  }

  // Human input drives each team's controlled skater; AI drives the rest.
  // While a team is charging a shot (carries the puck and holds Action), its
  // carrier can't accelerate — it just drifts to a stop, as if no d-pad.
  const ctrl0 = controlledIndex(state, 0);
  const ctrl1 = controlledIndex(state, 1);
  const carrierTeam = state.possessor >= 0 ? teamOf(state.possessor) : -1;
  const charging = (t: 0 | 1) => carrierTeam === t && hasButton(inputs[t], Button.Action);
  if (!charging(0)) applyInput(skaters[ctrl0]!, inputs[0]);
  if (!charging(1)) applyInput(skaters[ctrl1]!, inputs[1]);
  for (let i = 0; i < n; i++) {
    if (i === ctrl0 || i === ctrl1) continue;
    moveToward(skaters[i]!, puck.x, LANE_Y[i]!);
  }

  // Integrate skaters; tick down any post-check pickup cooldowns.
  for (let i = 0; i < n; i++) {
    integrate(skaters[i]!, SKATER_DAMPING);
    if (skaters[i]!.pickupCooldown > 0) skaters[i]!.pickupCooldown--;
  }

  // Puck possession.
  if (state.possessor >= 0) {
    const carrier = skaters[state.possessor]!;
    const carrierTeam = teamOf(state.possessor);
    // You always control the puck carrier on your team (NES style).
    state.controlled[carrierTeam] = state.possessor - carrierTeam * SKATERS_PER_TEAM;

    // A check by any opponent within range knocks the puck loose.
    let checked = false;
    const stealSq = mul(STEAL_RADIUS, STEAL_RADIUS);
    for (let i = 0; i < n; i++) {
      if (teamOf(i) !== carrierTeam && distSq(carrier, skaters[i]!) <= stealSq) {
        checked = true;
        break;
      }
    }

    if (checked) {
      puck.x = carrier.x;
      puck.y = carrier.y;
      puck.vx = carrier.vx;
      puck.vy = carrier.vy;
      state.possessor = -1;
      state.puckFree = KNOCK_DELAY;
      state.shotCharge[carrierTeam] = 0;
      carrier.pickupCooldown = CHECK_PICKUP_COOLDOWN; // can't immediately re-grab
    } else if (hasButton(inputs[carrierTeam], Button.Action)) {
      // Hold to charge; keep carrying meanwhile.
      if (state.shotCharge[carrierTeam] < SHOT_MAX_CHARGE) state.shotCharge[carrierTeam]++;
      carryPuck(carrier, puck);
    } else if (state.shotCharge[carrierTeam] > 0) {
      // Released: shoot with the charged power (faster + less accurate).
      const f = div(fromInt(state.shotCharge[carrierTeam]), fromInt(SHOT_MAX_CHARGE));
      const speed = add(SHOT_SPEED, mul(f, sub(SHOT_SPEED_MAX, SHOT_SPEED)));
      const dir = shotDirection(state, carrier, carrierTeam, mul(f, CHARGE_SPREAD));
      puck.x = add(carrier.x, mul(dir.nx, POSSESSION_OFFSET));
      puck.y = add(carrier.y, mul(dir.ny, POSSESSION_OFFSET));
      puck.vx = mul(dir.nx, speed);
      puck.vy = mul(dir.ny, speed);
      state.possessor = -1;
      state.puckFree = PICKUP_DELAY;
      state.shotCharge[carrierTeam] = 0;
    } else {
      carryPuck(carrier, puck);
    }
  } else {
    // Loose puck: free physics, then maybe picked up by the nearest skater.
    integrate(puck, PUCK_DAMPING);
    if (state.puckFree > 0) state.puckFree--;
    for (let i = 0; i < n; i++) {
      resolveCircleCircle(skaters[i]!, puck, SKATER_R, PUCK_R, SKATER_INV_MASS, PUCK_INV_MASS, PUCK_SKATER_RESTITUTION);
    }
    if (state.puckFree === 0) {
      const r2 = mul(PICKUP_RADIUS, PICKUP_RADIUS);
      let best = -1;
      let bestD = ZERO;
      for (let i = 0; i < n; i++) {
        if (skaters[i]!.pickupCooldown > 0) continue;
        const d = distSq(skaters[i]!, puck);
        if (d <= r2 && (best < 0 || d < bestD)) {
          best = i;
          bestD = d;
        }
      }
      if (best >= 0) {
        state.possessor = best;
        const t = teamOf(best);
        state.controlled[t] = best - t * SKATERS_PER_TEAM;
      }
    }
  }

  // Skater-skater collisions (all pairs, deterministic order).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      resolveCircleCircle(skaters[i]!, skaters[j]!, SKATER_R, SKATER_R, SKATER_INV_MASS, SKATER_INV_MASS, SKATER_SKATER_RESTITUTION);
    }
  }

  // Boards + net walls + goal posts.
  for (let i = 0; i < n; i++) {
    clampSkaterToRink(skaters[i]!, SKATER_R);
    resolveNetWalls(skaters[i]!, SKATER_R);
    resolvePosts(skaters[i]!, SKATER_R);
  }
  if (state.possessor < 0) {
    bouncePuckOffBoards(puck, PUCK_R);
    resolveNetWalls(puck, PUCK_R);
    resolvePosts(puck, PUCK_R);
  }

  // Goalies are moved up/down by their team's input (Up/Down); they block shots.
  updateGoalie(state, 0, GOALIE_LEFT_X, inputs[0]);
  updateGoalie(state, 1, GOALIE_RIGHT_X, inputs[1]);

  // Cap speeds so collision resolution can't inject runaway energy.
  for (let i = 0; i < n; i++) clampSpeed(skaters[i]!, MAX_SKATER_SPEED);
  if (state.possessor < 0) clampSpeed(puck, MAX_PUCK_SPEED);

  // Goal? Only a LOOSE puck can score — you must shoot it in past the goalie.
  const scorer = state.possessor < 0 ? detectGoal(puck) : -1;
  if (scorer === 0 || scorer === 1) {
    state.score[scorer]++;
    resetPositions(state);
    state.faceoff = FACEOFF_TICKS;
  }

  return state;
}
