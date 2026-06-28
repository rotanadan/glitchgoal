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

/**
 * Half-height of the goal mouth (between the posts). Wide enough (NES Ice Hockey
 * style) that the goalie can't cover the whole net — it must pick a side, so a
 * quick shot to the open corner beats it.
 */
export const GOAL_HALF_H: Fixed = fromInt(24);

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
 * Max lateral aim error (as a fraction of the aim vector) at accuracy 0. The
 * actual spread is SHOT_SPREAD * (1 - accuracy), randomized via the sim RNG.
 */
export const SHOT_SPREAD: Fixed = fromFloat(0.7);
/** Default per-skater shooting accuracy (0..1); profile-driven later. */
export const DEFAULT_ACCURACY: Fixed = fromFloat(0.75);

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
/** Pass puck speed and how long it stays live so the passer can't re-grab it. */
export const PASS_SPEED: Fixed = fromFloat(8.0);
export const PASS_DELAY = 10;

/** Faceoff freeze duration (ticks) after a goal. */
export const FACEOFF_TICKS = 60;

/** Goals needed to win a match. */
export const WIN_GOALS = 5;

/** Skaters per team (plus a goalie). 8 skaters total, NES Ice Hockey style. */
export const SKATERS_PER_TEAM = 4;

/** Puck faceoff spawn (center ice). */
export const PUCK_SPAWN_X: Fixed = fromInt(340);

/**
 * Faceoff formation: 4 skaters per team. Indices 0-3 are team 0 (defends LEFT,
 * attacks RIGHT) on the left half; 4-7 are team 1, mirrored. [x, y] in sim units.
 */
const FORMATION: ReadonlyArray<readonly [number, number]> = [
  [280, 150], [210, 70], [210, 230], [140, 150], // team 0
  [400, 150], [470, 70], [470, 230], [540, 150], // team 1
];
export const SPAWN_X: readonly Fixed[] = FORMATION.map(([x]) => fromInt(x));
export const SPAWN_Y: readonly Fixed[] = FORMATION.map(([, y]) => fromInt(y));

/**
 * AI lane (home y) per team slot — spreads the four skaters vertically so they
 * don't clump. AI seeks (puck.x, laneY[slot]) when not controlled.
 */
const LANES = [45, 115, 185, 255];
export const LANE_Y: readonly Fixed[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => fromInt(LANES[i % 4]!));

/** AI stops accelerating once within this distance of its target. */
export const AI_DEADZONE: Fixed = fromInt(6);
