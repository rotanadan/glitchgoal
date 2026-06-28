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
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  GOAL_HALF_H,
  NET_DEPTH,
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

  it('a shot beats an out-of-position goalie and scores', () => {
    let s = initialState(2);
    // Player 0 carries near the right goal; auto-aim sends it at the net center.
    s.possessor = 0;
    s.puckFree = 0;
    s.skaters[0].x = (GOAL_LINE_RIGHT - fromFloat(24)) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].accuracy = fromFloat(1) as Fixed; // perfect aim, no spread
    s.skaters[1].x = fromFloat(200) as Fixed;
    // Goalie pinned to the BOTTOM corner, leaving the middle open.
    s.goalies[1] = (RINK_CY + GOAL_HALF_H) as Fixed;

    const shoot: [PlayerInput, PlayerInput] = [Button.Action, NONE];
    const before = s.score[0];
    for (let i = 0; i < 30; i++) s = step(s, shoot);
    expect(s.score[0]).toBe(before + 1);
  });

  it('the shoot button aims at the opponent net regardless of facing', () => {
    let s = initialState(3);
    s.possessor = 0; // player 0 attacks the RIGHT net
    s.skaters[0].x = fromFloat(340) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].fx = -fromFloat(1) as Fixed; // facing LEFT, away from the net
    s.skaters[0].fy = 0 as Fixed;
    s.skaters[0].accuracy = fromFloat(1) as Fixed;
    s.skaters[1].x = fromFloat(200) as Fixed;

    s = step(s, [Button.Action, NONE]);
    expect(s.possessor).toBe(-1); // shot released
    expect(s.puck.vx).toBeGreaterThan(0); // travels toward the right net, not left
  });

  it('carrying the puck into the net does not score — you must shoot it', () => {
    let s = initialState(9);
    // Carrier forced right inside the cage, holding the puck the whole time.
    s.possessor = 0;
    s.skaters[0].x = (GOAL_LINE_RIGHT + fromFloat(8)) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].fx = fromFloat(1) as Fixed;
    s.skaters[0].fy = 0 as Fixed;
    s.skaters[1].x = fromFloat(200) as Fixed;

    const before = s.score[0];
    for (let i = 0; i < 20; i++) s = step(s, [NONE, NONE]); // carrying, never shooting
    expect(s.score[0]).toBe(before); // a carried puck never scores
  });

  it('a puck behind or beside the net is not a goal', () => {
    let s = initialState(8);
    s.possessor = -1;
    s.puckFree = 0;
    s.skaters[0].x = fromFloat(300) as Fixed;
    s.skaters[1].x = fromFloat(360) as Fixed;

    // Directly behind the left net (past the back of the cage).
    s.puck.x = (GOAL_LINE_LEFT - NET_DEPTH - fromFloat(4)) as Fixed;
    s.puck.y = RINK_CY;
    s.puck.vx = 0 as Fixed;
    s.puck.vy = 0 as Fixed;
    s = step(s, [NONE, NONE]);
    expect(s.score[1]).toBe(0);

    // Fired at the SIDE of the net from outside (above it, moving down): it must
    // bounce off the side wall, not pass through into the goal.
    s.puck.x = (GOAL_LINE_LEFT - fromFloat(8)) as Fixed;
    s.puck.y = (RINK_CY - GOAL_HALF_H - fromFloat(6)) as Fixed;
    s.puck.vx = 0 as Fixed;
    s.puck.vy = fromFloat(3) as Fixed;
    for (let i = 0; i < 20; i++) s = step(s, [NONE, NONE]);
    expect(s.score[1]).toBe(0);
  });

  it('the goalie saves a shot fired straight at it', () => {
    let s = initialState(4);
    s.possessor = 0;
    s.puckFree = 0;
    s.skaters[0].x = (GOAL_LINE_RIGHT - fromFloat(30)) as Fixed;
    s.skaters[0].y = RINK_CY;
    s.skaters[0].accuracy = fromFloat(1) as Fixed; // dead-center aim
    s.skaters[1].x = fromFloat(200) as Fixed;
    s.goalies[1] = RINK_CY; // centered, in the puck's path

    const shoot: [PlayerInput, PlayerInput] = [Button.Action, NONE];
    const before = s.score[0];
    for (let i = 0; i < 30; i++) s = step(s, shoot);
    expect(s.score[0]).toBe(before); // saved
  });

  it('picks up a loose puck, carries it on the stick, and a check knocks it loose', () => {
    let s = initialState(5);
    // Loose puck right next to team-0 skater 0, off in a corner away from others.
    s.possessor = -1;
    s.puckFree = 0;
    s.skaters[0].x = fromFloat(100) as Fixed;
    s.skaters[0].y = fromFloat(60) as Fixed;
    s.skaters[0].fx = fromFloat(1) as Fixed;
    s.skaters[0].fy = 0 as Fixed;
    s.puck.x = fromFloat(108) as Fixed;
    s.puck.y = fromFloat(60) as Fixed;
    s.puck.vx = 0 as Fixed;
    s.puck.vy = 0 as Fixed;

    // Picks it up (it's the nearest skater).
    s = step(s, [NONE, NONE]);
    expect(s.possessor).toBe(0);

    // Carries it: the puck stays glued near the skater.
    for (let i = 0; i < 8; i++) s = step(s, [Button.Up, NONE]);
    expect(s.possessor).toBe(0);
    const d = Math.hypot(
      toFloat(s.puck.x) - toFloat(s.skaters[0].x),
      toFloat(s.puck.y) - toFloat(s.skaters[0].y),
    );
    expect(d).toBeLessThan(20);

    // An OPPONENT (team 1) skates into the carrier -> puck knocked loose.
    s.skaters[4].x = s.skaters[0].x;
    s.skaters[4].y = s.skaters[0].y;
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
      for (const b of [...s.skaters, s.puck]) {
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

  it('the switch button takes control of the teammate nearest the puck', () => {
    let s = initialState(11);
    s.possessor = -1;
    s.controlled[0] = 3; // currently controlling some other slot
    // Put the puck next to team-0 slot 1, far from the others.
    s.puck.x = fromFloat(250) as Fixed;
    s.puck.y = fromFloat(40) as Fixed;
    s.skaters[1].x = fromFloat(252) as Fixed;
    s.skaters[1].y = fromFloat(40) as Fixed;

    s = step(s, [Button.Switch, NONE]);
    expect(s.controlled[0]).toBe(1); // now controlling the skater by the puck
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
