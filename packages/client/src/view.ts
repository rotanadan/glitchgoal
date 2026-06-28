import { toFloat, type GameState, type Skater } from '@glitchgoal/sim';
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
    skaters: [mover(s.skaters[0]), mover(s.skaters[1])],
    puck: { x: toFloat(s.puck.x), y: toFloat(s.puck.y) },
    score: [s.score[0], s.score[1]],
    possessor: s.possessor,
  };
}
