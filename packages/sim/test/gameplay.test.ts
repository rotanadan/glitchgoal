import { describe, it, expect } from 'vitest';
import {
  initialState,
  step,
  Button,
  toFloat,
  fromFloat,
  RINK_W,
  RINK_H,
  SKATER_R,
  RINK_CY,
  type Fixed,
  type PlayerInput,
} from '../src/index.js';

const NONE: PlayerInput = 0;

describe('rink physics', () => {
  it('keeps skaters inside the boards no matter how long they push a wall', () => {
    let s = initialState(1);
    // Player 0 holds up-left for a long time, trying to escape the rink.
    const push: [PlayerInput, PlayerInput] = [Button.Up | Button.Left, NONE];
    for (let i = 0; i < 300; i++) s = step(s, push);
    const sk = s.skaters[0];
    expect(sk.x).toBeGreaterThanOrEqual(SKATER_R - 1);
    expect(sk.y).toBeGreaterThanOrEqual(SKATER_R - 1);
    expect(sk.x).toBeLessThanOrEqual(RINK_W);
    expect(sk.y).toBeLessThanOrEqual(RINK_H);
  });

  it('a shot toward an empty net scores a goal', () => {
    let s = initialState(2);
    // Move the puck just in front of the right goal mouth, aimed right.
    s.puck.x = (RINK_W - fromFloat(20)) as Fixed;
    s.puck.y = RINK_CY;
    // Put skater 0 next to the puck, facing right, and shoot.
    s.skaters[0].x = (RINK_W - fromFloat(34)) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].fx = fromFloat(1) as Fixed;
    s.skaters[0].fy = 0 as Fixed;
    s.skaters[0].cooldown = 0;

    const shoot: [PlayerInput, PlayerInput] = [Button.Action, NONE];
    const before = s.score[0];
    for (let i = 0; i < 120; i++) s = step(s, shoot);
    expect(s.score[0]).toBe(before + 1);
  });

  it('freezes play during the faceoff window after a goal', () => {
    let s = initialState(3);
    s.faceoff = 30;
    const sk0Before = toFloat(s.skaters[0].x);
    const move: [PlayerInput, PlayerInput] = [Button.Right, Button.Left];
    s = step(s, move);
    // Position unchanged while frozen.
    expect(toFloat(s.skaters[0].x)).toBe(sk0Before);
    expect(s.faceoff).toBe(29);
  });
});
