/**
 * Local hot-seat game: two keyboard players on one machine, no netcode. Useful
 * for testing feel and for offline play.
 */

import { initialState, step, type GameState } from '@glitchgoal/sim';
import { Keyboard } from './input.js';
import { Renderer } from './renderer.js';
import { view } from './view.js';

const FIXED_DT = 1000 / 60;
const MAX_FRAME = 250;

export function startLocalGame(renderer: Renderer): void {
  const keyboard = new Keyboard();
  let state: GameState = initialState(Date.now() & 0xffff);
  let prev = view(state);
  let curr = prev;
  let last = performance.now();
  let accumulator = 0;

  renderer.app.ticker.add(() => {
    const now = performance.now();
    accumulator += Math.min(now - last, MAX_FRAME);
    last = now;

    while (accumulator >= FIXED_DT) {
      prev = curr;
      state = step(state, [keyboard.player1(), keyboard.player2()]);
      curr = view(state);
      accumulator -= FIXED_DT;
    }

    renderer.render(prev, curr, accumulator / FIXED_DT);
  });
}
