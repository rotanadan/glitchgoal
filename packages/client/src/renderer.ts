/**
 * PixiJS render-from-state.
 *
 * The renderer is a pure view of the simulation: it never mutates sim state. The
 * sim runs on a fixed 60Hz timestep; the display refreshes at the monitor's rate
 * and INTERPOLATES between the previous and current sim frames so motion stays
 * smooth regardless of refresh rate. Sprites are drawn NES Ice Hockey style:
 * chunky pixel skaters on a horizontal rink with goals at each end.
 */

import { Application, Container, Graphics, Text } from 'pixi.js';
import { RINK_W, RINK_H, RINK_CY, GOAL_HALF_H, SKATER_R, PUCK_R, toFloat } from '@glitchgoal/sim';

/** A render-friendly snapshot of the sim (floats, sim units). */
export interface ViewState {
  skaters: [Mover, Mover];
  puck: { x: number; y: number };
  score: [number, number];
}
interface Mover {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

const SCALE = 2; // sim units -> screen pixels
const W = toFloat(RINK_W);
const H = toFloat(RINK_H);
const CY = toFloat(RINK_CY);
const GOAL_H = toFloat(GOAL_HALF_H);
const SK_R = toFloat(SKATER_R);
const PK_R = toFloat(PUCK_R);

const TEAM_COLORS = [0xe23a3a, 0x3a7ae2] as const; // P0 red, P1 blue

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Renderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly skaters: Container[] = [];
  private puck!: Graphics;
  private scoreText!: Text;

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      width: W * SCALE,
      height: H * SCALE,
      background: 0xeaf2f8, // ice
      antialias: false,
    });
    mount.appendChild(this.app.canvas);

    this.world.scale.set(SCALE);
    this.app.stage.addChild(this.world);

    this.drawRink();
    this.skaters.push(this.makeSkater(TEAM_COLORS[0]), this.makeSkater(TEAM_COLORS[1]));
    this.skaters.forEach((s) => this.world.addChild(s));
    this.puck = new Graphics().circle(0, 0, PK_R).fill(0x141414);
    this.world.addChild(this.puck);

    this.scoreText = new Text({
      text: '0  :  0',
      style: { fill: 0x102030, fontFamily: 'monospace', fontSize: 9, fontWeight: 'bold' },
    });
    this.scoreText.anchor.set(0.5, 0);
    this.scoreText.position.set(W / 2, 4);
    this.world.addChild(this.scoreText);
  }

  private drawRink(): void {
    const g = new Graphics();
    // Center line and faceoff circle.
    g.moveTo(W / 2, 0).lineTo(W / 2, H).stroke({ width: 1, color: 0xc23b3b, alpha: 0.5 });
    g.circle(W / 2, CY, 22).stroke({ width: 1, color: 0x3b6fc2, alpha: 0.5 });
    g.circle(W / 2, CY, 2).fill(0x3b6fc2);

    // Boards: full top/bottom; left/right split around the goal mouth.
    const boards = (x1: number, y1: number, x2: number, y2: number) =>
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2, color: 0x2a3a4a });
    boards(0, 0, W, 0);
    boards(0, H, W, H);
    boards(0, 0, 0, CY - GOAL_H);
    boards(0, CY + GOAL_H, 0, H);
    boards(W, 0, W, CY - GOAL_H);
    boards(W, CY + GOAL_H, W, H);

    // Goal mouths.
    g.rect(-4, CY - GOAL_H, 4, GOAL_H * 2).fill({ color: TEAM_COLORS[0], alpha: 0.3 });
    g.rect(W, CY - GOAL_H, 4, GOAL_H * 2).fill({ color: TEAM_COLORS[1], alpha: 0.3 });
    g.moveTo(0, CY - GOAL_H).lineTo(0, CY + GOAL_H).stroke({ width: 1, color: TEAM_COLORS[0] });
    g.moveTo(W, CY - GOAL_H).lineTo(W, CY + GOAL_H).stroke({ width: 1, color: TEAM_COLORS[1] });

    this.world.addChildAt(g, 0);
  }

  /** A chunky NES-style skater, drawn facing +x; rotated to its facing each frame. */
  private makeSkater(jersey: number): Container {
    const c = new Container();
    const g = new Graphics();
    // Skates / shadow.
    g.rect(-SK_R, SK_R - 3, SK_R * 2, 3).fill(0x222222);
    // Jersey body.
    g.rect(-SK_R + 2, -SK_R + 3, SK_R * 2 - 4, SK_R * 2 - 6).fill(jersey);
    // Head.
    g.circle(0, -SK_R + 2, 3).fill(0xf2c79a);
    // Stick pointing forward (+x), the facing indicator.
    g.moveTo(SK_R - 2, 2).lineTo(SK_R + 5, 6).stroke({ width: 2, color: 0x6b4321 });
    c.addChild(g);
    return c;
  }

  /** Render one frame, interpolating between two sim states. */
  render(prev: ViewState, curr: ViewState, alpha: number): void {
    for (let i = 0; i < 2; i++) {
      const p = prev.skaters[i]!;
      const c = curr.skaters[i]!;
      const sprite = this.skaters[i]!;
      sprite.position.set(lerp(p.x, c.x, alpha), lerp(p.y, c.y, alpha));
      if (c.fx !== 0 || c.fy !== 0) sprite.rotation = Math.atan2(c.fy, c.fx);
    }
    this.puck.position.set(lerp(prev.puck.x, curr.puck.x, alpha), lerp(prev.puck.y, curr.puck.y, alpha));

    const text = `${curr.score[0]}  :  ${curr.score[1]}`;
    if (this.scoreText.text !== text) this.scoreText.text = text;
  }
}
