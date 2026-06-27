/**
 * Rink geometry and physics tuning constants.
 *
 * Layout follows NES Ice Hockey: a horizontal rink with goals at the left and
 * right ends. Player 0 defends the LEFT goal and attacks RIGHT; player 1 the
 * reverse. The origin (0,0) is the top-left of the play field; +x is right,
 * +y is down.
 *
 * These are authored with fromFloat at module load (the "edge", outside the per
 * frame loop) so the rest of the sim stays in pure fixed-point integer math.
 */

import { fromFloat, fromInt, type Fixed } from './fixed.js';

/** Play-field dimensions (interior, board to board). NES-ish 4:3 feel. */
export const RINK_W: Fixed = fromInt(320);
export const RINK_H: Fixed = fromInt(240);

/** Vertical center of the rink (where each goal mouth is centered). */
export const RINK_CY: Fixed = fromInt(120);

/** Half-height of the goal mouth opening in the end boards. */
export const GOAL_HALF_H: Fixed = fromInt(34);

/** Entity radii. */
export const PUCK_R: Fixed = fromInt(4);
export const SKATER_R: Fixed = fromInt(10);

/** Inverse masses (puck is light, skaters are heavy). */
export const PUCK_INV_MASS: Fixed = fromFloat(1.0);
export const SKATER_INV_MASS: Fixed = fromFloat(0.2);

/** Restitution (bounciness) for the various contacts. */
export const WALL_RESTITUTION: Fixed = fromFloat(0.7);
export const PUCK_SKATER_RESTITUTION: Fixed = fromFloat(0.4);
export const SKATER_SKATER_RESTITUTION: Fixed = fromFloat(0.3);

/** Skater acceleration per tick while a direction is held. */
export const SKATER_ACCEL: Fixed = fromFloat(0.6);

/** Velocity retained each tick (ice friction). Puck glides further. */
export const SKATER_DAMPING: Fixed = fromFloat(0.90);
export const PUCK_DAMPING: Fixed = fromFloat(0.985);

/** Shooting. */
export const SHOT_SPEED: Fixed = fromFloat(7.0);
/** Extra reach beyond touching radius within which a skater can shoot. */
export const SHOT_REACH: Fixed = fromInt(6);
/** Ticks before a skater can shoot again. */
export const SHOT_COOLDOWN = 20;

/** Faceoff freeze duration (ticks) after a goal. */
export const FACEOFF_TICKS = 60;

/** Goals needed to win a match. */
export const WIN_GOALS = 5;

/** Faceoff spawn positions. */
export const SKATER0_SPAWN_X: Fixed = fromInt(110);
export const SKATER1_SPAWN_X: Fixed = fromInt(210);
export const PUCK_SPAWN_X: Fixed = fromInt(160);
