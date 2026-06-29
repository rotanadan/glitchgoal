/**
 * PixiJS render-from-state.
 *
 * The renderer is a pure view of the simulation: it never mutates sim state. The
 * sim runs on a fixed 60Hz timestep; the display refreshes at the monitor's rate
 * and INTERPOLATES between the previous and current sim frames so motion stays
 * smooth. The rink is wider than the viewport, so a camera scrolls horizontally
 * to follow the puck (NES Ice Hockey style). Sprites are chunky pixel skaters on
 * a full-markings rink with real goal nets.
 */

import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  RINK_W,
  RINK_H,
  RINK_CY,
  GOAL_HALF_H,
  GOAL_LINE_LEFT,
  GOAL_LINE_RIGHT,
  NET_DEPTH,
  POST_R,
  SKATER_R,
  PUCK_R,
  SKATERS_PER_TEAM,
  toFloat,
} from '@glitchgoal/sim';

/** A render-friendly snapshot of the sim (floats, sim units). */
export interface ViewState {
  /** 8 skaters: 0-3 team 0, 4-7 team 1. */
  skaters: Mover[];
  puck: { x: number; y: number };
  score: [number, number];
  /** Which skater carries the puck: -1, or a global index 0-7. */
  possessor: number;
  /** Team-slot (0-3) each team's human controls. */
  controlled: [number, number];
  /** Shot-charge fraction (0..1) per team. */
  charge: [number, number];
  goalies: [{ x: number; y: number }, { x: number; y: number }];
}
interface Mover {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

const SCALE = 2; // sim units -> screen pixels
const VIEW_W = 360; // visible width (sim units); the rink is wider and scrolls
const W = toFloat(RINK_W);
const H = toFloat(RINK_H);
const CY = toFloat(RINK_CY);
const GOAL_H = toFloat(GOAL_HALF_H);
const GLL = toFloat(GOAL_LINE_LEFT);
const GLR = toFloat(GOAL_LINE_RIGHT);
const NETD = toFloat(NET_DEPTH);
const POSTR = toFloat(POST_R);
const SK_R = toFloat(SKATER_R);
const PK_R = toFloat(PUCK_R);

// Marking positions (sim units).
const BLUE_L = W / 2 - 88;
const BLUE_R = W / 2 + 88;
const FACEOFF_R = 30;
const CREASE_R = 26;

const TEAM_COLORS = [0xe23a3a, 0x3a7ae2] as const; // P0 red, P1 blue
const RED_LINE = 0xc23b3b;
const BLUE_LINE = 0x2b5fae;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Renderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly skaters: Container[] = [];
  private readonly possessionRings: Graphics[] = [];
  private readonly goalieSprites: Graphics[] = [];
  private readonly controlIndicators: Graphics[] = [];
  private chargeMeter!: Graphics;
  private puck!: Graphics;
  private scoreText!: Text;
  private cameraX = 0;
  private cameraReady = false;

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      width: VIEW_W * SCALE,
      height: H * SCALE,
      background: 0x0a0a12,
      antialias: false,
    });
    mount.appendChild(this.app.canvas);

    this.world.scale.set(SCALE);
    this.app.stage.addChild(this.world);

    this.drawRink();
    // Goalies (behind skaters).
    this.goalieSprites.push(this.makeGoalie(TEAM_COLORS[0]), this.makeGoalie(TEAM_COLORS[1]));
    this.goalieSprites.forEach((g) => this.world.addChild(g));
    // 8 skaters: 0-3 team 0, 4-7 team 1.
    for (let i = 0; i < SKATERS_PER_TEAM * 2; i++) {
      const c = this.makeSkater(i < SKATERS_PER_TEAM ? TEAM_COLORS[0] : TEAM_COLORS[1]);
      this.skaters.push(c);
      this.world.addChild(c);
    }
    // Control indicators (one per team), shown above the human-controlled skater.
    this.controlIndicators.push(this.makeChevron(TEAM_COLORS[0]), this.makeChevron(TEAM_COLORS[1]));
    this.controlIndicators.forEach((c) => this.world.addChild(c));
    this.puck = new Graphics().circle(0, 0, PK_R).fill(0x141414);
    this.world.addChild(this.puck);
    this.chargeMeter = new Graphics();
    this.chargeMeter.visible = false;
    this.world.addChild(this.chargeMeter);

    // Scoreboard lives on the stage (screen space) so it doesn't scroll away.
    const cx = (VIEW_W * SCALE) / 2;
    const plate = new Graphics().roundRect(cx - 46, 2, 92, 32, 6).fill({ color: 0x0a0a12, alpha: 0.8 });
    this.app.stage.addChild(plate);
    this.scoreText = new Text({
      text: '0 : 0',
      style: { fill: 0xffffff, fontFamily: 'monospace', fontSize: 22, fontWeight: 'bold' },
    });
    this.scoreText.anchor.set(0.5, 0);
    this.scoreText.position.set(cx, 6);
    this.app.stage.addChild(this.scoreText);
  }

  private drawRink(): void {
    const g = new Graphics();

    // Ice surface (rounded rink) + boards.
    g.roundRect(0, 0, W, H, 28).fill(0xf2f8fc);
    g.roundRect(0, 0, W, H, 28).stroke({ width: 3, color: 0x2a3a4a });

    // Blue lines.
    for (const x of [BLUE_L, BLUE_R]) {
      g.moveTo(x, 2).lineTo(x, H - 2).stroke({ width: 5, color: BLUE_LINE });
    }
    // Center red line + center faceoff.
    g.moveTo(W / 2, 2).lineTo(W / 2, H - 2).stroke({ width: 3, color: RED_LINE });
    g.circle(W / 2, CY, FACEOFF_R).stroke({ width: 1.5, color: BLUE_LINE });
    g.circle(W / 2, CY, 3).fill(BLUE_LINE);

    // Goal lines (thin red, across the rink at each goal line).
    for (const x of [GLL, GLR]) {
      g.moveTo(x, 2).lineTo(x, H - 2).stroke({ width: 1.5, color: RED_LINE, alpha: 0.8 });
    }

    // Zone faceoff circles + dots.
    for (const x of [GLL + 90, GLR - 90]) {
      for (const y of [CY - 60, CY + 60]) {
        g.circle(x, y, FACEOFF_R).stroke({ width: 1.5, color: RED_LINE });
        g.circle(x, y, 3).fill(RED_LINE);
      }
    }
    // Neutral-zone faceoff dots.
    for (const x of [BLUE_L - 22, BLUE_R + 22]) {
      for (const y of [CY - 60, CY + 60]) g.circle(x, y, 3).fill(RED_LINE);
    }

    // Goal creases (light blue), facing center ice.
    g.arc(GLL, CY, CREASE_R, -Math.PI / 2, Math.PI / 2).lineTo(GLL, CY - CREASE_R).fill({ color: 0x4a90d9, alpha: 0.22 });
    g.arc(GLR, CY, CREASE_R, Math.PI / 2, (3 * Math.PI) / 2).lineTo(GLR, CY + CREASE_R).fill({ color: 0x4a90d9, alpha: 0.22 });

    // Nets.
    this.drawNet(g, GLL, -1, TEAM_COLORS[0]);
    this.drawNet(g, GLR, +1, TEAM_COLORS[1]);

    this.world.addChildAt(g, 0);
  }

  /** Draw a goal net: cage extending `sign` away from the goal line, with posts. */
  private drawNet(g: Graphics, goalLineX: number, sign: number, postColor: number): void {
    const backX = goalLineX + sign * NETD;
    const topY = CY - GOAL_H;
    const botY = CY + GOAL_H;

    // Cage (mesh) — filled translucent, with a back/side outline.
    g.poly([goalLineX, topY, backX, topY, backX, botY, goalLineX, botY]).fill({ color: 0xffffff, alpha: 0.5 });
    g.poly([goalLineX, topY, backX, topY, backX, botY, goalLineX, botY]).stroke({ width: 1, color: 0x9aa7b3 });
    // A couple of mesh lines.
    g.moveTo(backX, CY).lineTo(goalLineX, CY).stroke({ width: 0.5, color: 0xb9c4cd });
    g.moveTo(goalLineX + (sign * NETD) / 2, topY).lineTo(goalLineX + (sign * NETD) / 2, botY).stroke({ width: 0.5, color: 0xb9c4cd });

    // Posts (and crossbar feel) at the goal line.
    g.moveTo(goalLineX, topY).lineTo(goalLineX, botY).stroke({ width: 2, color: postColor });
    g.circle(goalLineX, topY, POSTR).fill(postColor);
    g.circle(goalLineX, botY, POSTR).fill(postColor);
  }

  /** A small downward chevron marking the human-controlled skater. */
  private makeChevron(color: number): Graphics {
    const g = new Graphics();
    g.poly([-4, -SK_R - 8, 4, -SK_R - 8, 0, -SK_R - 3]).fill(color);
    g.poly([-4, -SK_R - 8, 4, -SK_R - 8, 0, -SK_R - 3]).stroke({ width: 1, color: 0x10131a });
    return g;
  }

  /** A goalie: a vertical pad in team colors with a helmet. */
  private makeGoalie(color: number): Graphics {
    const g = new Graphics();
    g.roundRect(-5, -13, 10, 26, 2).fill(color);
    g.roundRect(-5, -13, 10, 26, 2).stroke({ width: 1, color: 0x10131a });
    g.circle(0, 0, 3.5).fill(0xe8e8e8); // mask
    return g;
  }

  /** A chunky NES-style skater, drawn facing +x; rotated to its facing each frame. */
  private makeSkater(jersey: number): Container {
    const c = new Container();

    // Possession halo (behind the skater), toggled on for whoever has the puck.
    const ring = new Graphics();
    ring.circle(0, 0, SK_R + 4).fill({ color: 0xffd23f, alpha: 0.22 });
    ring.circle(0, 0, SK_R + 4).stroke({ width: 2, color: 0xffd23f });
    ring.visible = false;
    c.addChild(ring);
    this.possessionRings.push(ring);

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
    const sx: number[] = [];
    const sy: number[] = [];
    for (let i = 0; i < this.skaters.length; i++) {
      const p = prev.skaters[i]!;
      const c = curr.skaters[i]!;
      const x = lerp(p.x, c.x, alpha);
      const y = lerp(p.y, c.y, alpha);
      sx[i] = x;
      sy[i] = y;
      const sprite = this.skaters[i]!;
      sprite.position.set(x, y);
      if (c.fx !== 0 || c.fy !== 0) sprite.rotation = Math.atan2(c.fy, c.fx);
      this.possessionRings[i]!.visible = curr.possessor === i;
    }
    // Control indicators above each team's controlled skater.
    for (let t = 0; t < 2; t++) {
      const idx = t * SKATERS_PER_TEAM + curr.controlled[t]!;
      this.controlIndicators[t]!.position.set(sx[idx]!, sy[idx]!);
    }
    for (let i = 0; i < 2; i++) {
      const gp = prev.goalies[i]!;
      const gc = curr.goalies[i]!;
      this.goalieSprites[i]!.position.set(gc.x, lerp(gp.y, gc.y, alpha));
    }

    const puckX = lerp(prev.puck.x, curr.puck.x, alpha);
    const puckY = lerp(prev.puck.y, curr.puck.y, alpha);
    this.puck.position.set(puckX, puckY);

    // Camera follows the puck, clamped to the rink, smoothed.
    const target = clamp(puckX - VIEW_W / 2, 0, Math.max(0, W - VIEW_W));
    this.cameraX = this.cameraReady ? lerp(this.cameraX, target, 0.12) : target;
    this.cameraReady = true;
    this.world.x = -this.cameraX * SCALE;

    // Shot-charge meter under the carrier (fills green -> gold -> red).
    const carrier = curr.possessor;
    if (carrier >= 0 && curr.charge[carrier < SKATERS_PER_TEAM ? 0 : 1]! > 0.001) {
      const frac = curr.charge[carrier < SKATERS_PER_TEAM ? 0 : 1]!;
      const w = 18;
      const h = 3;
      const mx = sx[carrier]! - w / 2;
      const my = sy[carrier]! + SK_R + 6;
      this.chargeMeter.clear();
      this.chargeMeter.rect(mx, my, w, h).fill({ color: 0x10131a, alpha: 0.85 });
      const c = frac < 0.5 ? 0x4caf50 : frac < 0.85 ? 0xffd23f : 0xe23a3a;
      this.chargeMeter.rect(mx, my, w * frac, h).fill(c);
      this.chargeMeter.visible = true;
    } else {
      this.chargeMeter.visible = false;
    }

    const text = `${curr.score[0]} : ${curr.score[1]}`;
    if (this.scoreText.text !== text) this.scoreText.text = text;
  }
}
