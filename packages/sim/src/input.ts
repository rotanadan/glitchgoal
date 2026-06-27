/**
 * Per-player, per-frame input.
 *
 * Rollback sends *inputs*, not state. Inputs must be compact and serializable
 * to a fixed-width integer so they pack tightly onto the wire and hash cleanly.
 * We use an 8-direction d-pad + action buttons encoded in one byte.
 */

export enum Button {
  Up = 1 << 0,
  Down = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  Action = 1 << 4, // shoot / pass
  Boost = 1 << 5,
}

/** One player's input for one frame, encoded as a single byte. */
export type PlayerInput = number;

export const EMPTY_INPUT: PlayerInput = 0;

export function hasButton(input: PlayerInput, b: Button): boolean {
  return (input & b) !== 0;
}

export function withButton(input: PlayerInput, b: Button, on: boolean): PlayerInput {
  return on ? input | b : input & ~b;
}
