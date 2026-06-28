import { toFloat, GOALIE_LEFT_X, GOALIE_RIGHT_X, type GameState, type Skater } from '@glitchgoal/sim';
import type { ViewState } from './renderer.js';

const mover = (sk: Skater) => ({
  x: toFloat(sk.x),
  y: toFloat(sk.y),
  fx: toFloat(sk.fx),
  fy: toFloat(sk.fy),
});

/** Project the fixed-point sim state into render-friendly floats. */
export function view(s: GameState): ViewState {
  return {
    skaters: s.skaters.map(mover),
    puck: { x: toFloat(s.puck.x), y: toFloat(s.puck.y) },
    score: [s.score[0], s.score[1]],
    possessor: s.possessor,
    controlled: [s.controlled[0], s.controlled[1]],
    goalies: [
      { x: toFloat(GOALIE_LEFT_X), y: toFloat(s.goalies[0]) },
      { x: toFloat(GOALIE_RIGHT_X), y: toFloat(s.goalies[1]) },
    ],
  };
}
