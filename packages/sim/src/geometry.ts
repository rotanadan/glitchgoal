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

/**
 * Play-field dimensions (interior, board to board). Wider than the viewport,
 * so the camera scrolls horizontally (NES Ice Hockey style). ~2.27:1, close to
 * a regulation 200x88 ft sheet.
 */
export const RINK_W: Fixed = fromInt(680);
export const RINK_H: Fixed = fromInt(300);

/** Vertical center of the rink (goal mouths centered here). */
export const RINK_CY: Fixed = fromInt(150);

/** Half-height of the goal mouth opening (between the posts). */
export const GOAL_HALF_H: Fixed = fromInt(16);

/**
 * Goal nets are real objects set IN from the end boards. The goal line is at the
 * front of the net (where the posts stand); the cage extends NET_DEPTH behind it
 * toward the board. A goal counts when the puck crosses the goal line between the
 * posts.
 */
export const GOAL_LINE_LEFT: Fixed = fromInt(52);
export const GOAL_LINE_RIGHT: Fixed = fromInt(628); // RINK_W - 52
export const NET_DEPTH: Fixed = fromInt(22);
export const POST_R: Fixed = fromInt(3);

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
/** Goal posts ring the puck off harder. */
export const POST_RESTITUTION: Fixed = fromFloat(0.85);

/**
 * Goalies: a kinematic collider per net that tracks the puck's y within the
 * mouth, blocking shots and body-blocking carriers. X is fixed (just in front of
 * the goal line, in the crease); only the y moves, driven by deterministic AI.
 */
export const GOALIE_R: Fixed = fromInt(10);
export const GOALIE_LEFT_X: Fixed = fromInt(60); // GOAL_LINE_LEFT + crease depth
export const GOALIE_RIGHT_X: Fixed = fromInt(620); // GOAL_LINE_RIGHT - crease depth
export const GOALIE_SPEED: Fixed = fromFloat(2.6); // max y move per tick
export const GOALIE_RESTITUTION: Fixed = fromFloat(0.5);

/** Skater acceleration per tick while a direction is held. */
export const SKATER_ACCEL: Fixed = fromFloat(0.6);

/** Velocity retained each tick (ice friction). Puck glides further. */
export const SKATER_DAMPING: Fixed = fromFloat(0.90);
export const PUCK_DAMPING: Fixed = fromFloat(0.985);

/**
 * Hard per-frame speed caps. Without these, the light puck squeezed between two
 * skaters gains energy through sequential collision resolution and eventually
 * explodes. The caps bound that feedback loop deterministically.
 */
export const MAX_SKATER_SPEED: Fixed = fromFloat(9.0);
export const MAX_PUCK_SPEED: Fixed = fromFloat(14.0);

/** Shooting. */
export const SHOT_SPEED: Fixed = fromFloat(7.0);

/**
 * Puck possession (arcade hockey: the puck rides on the carrier's stick until
 * they shoot it or it's knocked loose by a check).
 */
/** Distance the carried puck sits ahead of the skater (its leading edge). */
export const POSSESSION_OFFSET: Fixed = fromInt(14); // SKATER_R + PUCK_R
/** A loose puck within this range of a skater is picked up. */
export const PICKUP_RADIUS: Fixed = fromInt(18);
/** When the non-carrier gets this close to the carrier, the puck is knocked loose. */
export const STEAL_RADIUS: Fixed = fromInt(22);
/** Frames a shot puck stays "live" (un-pickup-able) so it can travel. */
export const PICKUP_DELAY = 12;
/** Frames a knocked-loose puck stays live before it can be re-grabbed. */
export const KNOCK_DELAY = 8;

/** Faceoff freeze duration (ticks) after a goal. */
export const FACEOFF_TICKS = 60;

/** Goals needed to win a match. */
export const WIN_GOALS = 5;

/** Faceoff spawn positions (center ice). */
export const SKATER0_SPAWN_X: Fixed = fromInt(270);
export const SKATER1_SPAWN_X: Fixed = fromInt(410);
export const PUCK_SPAWN_X: Fixed = fromInt(340);
