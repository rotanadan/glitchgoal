/**
 * Keyboard input -> sim PlayerInput, for local hot-seat play.
 *
 * In step 5 the local player's input will instead be fed into the rollback
 * session and the opponent's input will arrive over the network; this module
 * stays as the source for the *local* keyboard player.
 */

import { Button, EMPTY_INPUT, type PlayerInput } from '@glitchgoal/sim';

type KeyMap = {
  up: string;
  down: string;
  left: string;
  right: string;
  action: string;
};

const PLAYER1: KeyMap = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space' };
const PLAYER2: KeyMap = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  action: 'Enter',
};

export class Keyboard {
  private readonly down = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      // Stop arrows/space from scrolling the page.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
  }

  private read(map: KeyMap): PlayerInput {
    let input: PlayerInput = EMPTY_INPUT;
    if (this.down.has(map.up)) input |= Button.Up;
    if (this.down.has(map.down)) input |= Button.Down;
    if (this.down.has(map.left)) input |= Button.Left;
    if (this.down.has(map.right)) input |= Button.Right;
    if (this.down.has(map.action)) input |= Button.Action;
    return input;
  }

  player1(): PlayerInput {
    return this.read(PLAYER1);
  }

  player2(): PlayerInput {
    return this.read(PLAYER2);
  }
}
