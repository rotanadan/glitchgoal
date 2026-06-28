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

  it('shooting the carried puck into the empty net scores', () => {
    let s = initialState(2);
    // Player 0 carries the puck near the right goal, facing right.
    s.possessor = 0;
    s.puckFree = 0;
    s.skaters[0].x = (RINK_W - fromFloat(30)) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].fx = fromFloat(1) as Fixed;
    s.skaters[0].fy = 0 as Fixed;
    // Keep the defender far away so it's not a check.
    s.skaters[1].x = fromFloat(60) as Fixed;
    s.skaters[1].y = RINK_CY;

    const shoot: [PlayerInput, PlayerInput] = [Button.Action, NONE];
    const before = s.score[0];
    for (let i = 0; i < 60; i++) s = step(s, shoot);
    expect(s.score[0]).toBe(before + 1);
  });

  it('picks up a loose puck, carries it on the stick, and a check knocks it loose', () => {
    let s = initialState(5);
    // Loose puck right next to player 0; defender far away.
    s.possessor = -1;
    s.puckFree = 0;
    s.skaters[0].x = fromFloat(100) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].fx = fromFloat(1) as Fixed;
    s.skaters[0].fy = 0 as Fixed;
    s.puck.x = fromFloat(108) as Fixed;
    s.puck.y = RINK_CY;
    s.puck.vx = 0 as Fixed;
    s.puck.vy = 0 as Fixed;
    s.skaters[1].x = fromFloat(280) as Fixed;
    s.skaters[1].y = RINK_CY;

    // Picks it up.
    s = step(s, [NONE, NONE]);
    expect(s.possessor).toBe(0);

    // Carries it: the puck stays glued near the skater.
    for (let i = 0; i < 10; i++) s = step(s, [Button.Up, NONE]);
    expect(s.possessor).toBe(0);
    const d = Math.hypot(
      toFloat(s.puck.x) - toFloat(s.skaters[0].x),
      toFloat(s.puck.y) - toFloat(s.skaters[0].y),
    );
    expect(d).toBeLessThan(20);

    // Defender skates into the carrier -> puck knocked loose.
    s.skaters[1].x = s.skaters[0].x;
    s.skaters[1].y = s.skaters[0].y;
    s = step(s, [NONE, NONE]);
    expect(s.possessor).toBe(-1);
  });

  it('stays stable when both skaters squeeze the puck between them', () => {
    // Regression: the puck trapped between the two skaters used to blow up
    // (fixed-point overflow in distSq -> phantom collisions -> runaway energy).
    let s = initialState(7);
    const squeeze: [PlayerInput, PlayerInput] = [
      Button.Right | Button.Down,
      Button.Left | Button.Up,
    ];
    for (let i = 0; i < 3000; i++) {
      s = step(s, squeeze);
      for (const b of [s.skaters[0], s.skaters[1], s.puck]) {
        const sp = Math.hypot(toFloat(b.vx), toFloat(b.vy));
        const x = toFloat(b.x);
        const y = toFloat(b.y);
        expect(sp).toBeLessThan(20); // well under any blow-up
        expect(x).toBeGreaterThan(-50);
        expect(x).toBeLessThan(toFloat(RINK_W) + 50);
        expect(y).toBeGreaterThan(-50);
        expect(y).toBeLessThan(toFloat(RINK_H) + 50);
      }
    }
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
