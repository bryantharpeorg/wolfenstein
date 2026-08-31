// The guard sprite sheet as a *plan* rather than as pixels (FR-009, US4-S2).
// Constitution II forbids a binary asset, so the art is a program: canvas-2D ops per
// cell, replayed by `./sprite-sheet.ts`. That split puts US4-S2 — the dimensions, and
// a figure for every angle and frame, death included — under `npm run test` with no
// canvas shim (Article III). The sheet is angle-across, frame-down.

import { createRng } from './rng';
import { VIEW_ANGLE_COUNT, VIEW_ANGLE_STEP_RADIANS } from './view-angle';

export const SPRITE_CELL_PX = 64;

export const GUARD_SHEET_SEED = 0x5eed6a4d;

export const GUARD_FRAMES = [
  'stand', 'walk-a', 'walk-b', 'walk-c', 'attack',
  'death-a', 'death-b', 'death-c', 'death-d',
] as const;

export type GuardFrame = (typeof GUARD_FRAMES)[number];

export const WALK_FRAMES: readonly GuardFrame[] = ['walk-a', 'walk-b', 'walk-c'];

/** The death frames in play order; the last is held forever after (US4-S5). */
export const DEATH_FRAMES: readonly GuardFrame[] = ['death-a', 'death-b', 'death-c', 'death-d'];

export const DEATH_DURATION_MS = 800;

export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { op: 'ellipse'; x: number; y: number; rx: number; ry: number; color: string }
  | { op: 'polygon'; points: number[]; color: string };

export interface SheetCell {
  readonly angle: number;
  readonly frame: GuardFrame;
  readonly frameIndex: number;
  readonly x: number;
  readonly y: number;
  readonly ops: readonly DrawOp[];
}

export interface SheetPlan {
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly frames: readonly GuardFrame[];
  readonly cells: readonly SheetCell[];
}

export function frameIndexOf(frame: GuardFrame): number {
  return GUARD_FRAMES.indexOf(frame);
}

export function cellRect(angle: number, frameIndex: number) {
  const c = SPRITE_CELL_PX;
  return { x: angle * c, y: frameIndex * c, width: c, height: c };
}

// The figure: an original blocky guard in a field uniform (Constitution VI) — boots,
// tunic, belt, helmet, rifle. Nothing is traced from anything; every number below is
// a coordinate in a 64-pixel cell.

const C = {
  shadow: '#101010', boot: '#221f1c', trouser: '#3a4436',
  tunic: '#4a5f42', shade: '#36452f', belt: '#1d1a17',
  buckle: '#8a7a3f', skin: '#c0996f', helmet: '#4d4f52',
  helmetShade: '#35373a', eye: '#141414', weapon: '#26241f',
  metal: '#787876', muzzle: '#f5c451', blood: '#5c1b1b',
} as const;

const CX = SPRITE_CELL_PX / 2;
const GROUND = 60;
const HEAD_Y = 18;
const TOP = 26;
const HIP = 45;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const fit = (v: number): number => Math.min(SPRITE_CELL_PX, Math.max(0, v));

/** The emitter, in figure space. It carries the death fold — the body scaled about
 *  the floor line and spread sideways — so a caller draws a standing guard once and
 *  every death frame falls out of `sink` and `spread`, which is why the sequence sinks
 *  monotonically rather than snapping to a new drawing. Coordinates are clamped into
 *  the cell, so a folded figure cannot bleed into its neighbour. */
class CellProgram {
  private readonly ops: DrawOp[] = [];

  constructor(private readonly sink: number, private readonly spread: number) {}

  private X(v: number): number {
    return fit(CX + (v - CX) * this.spread);
  }

  private Y(v: number): number {
    return fit(GROUND - (GROUND - v) * this.sink);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const x0 = this.X(x);
    const y0 = this.Y(y);
    const x1 = this.X(x + w);
    const y1 = this.Y(y + h);
    if (x1 <= x0 || y1 <= y0) return;
    this.ops.push({ op: 'rect', x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0), color });
  }

  ellipse(x: number, y: number, rx: number, ry: number, color: string): void {
    const cx = this.X(x);
    const cy = this.Y(y);
    const rxc = Math.max(0, Math.min(rx * this.spread, cx, SPRITE_CELL_PX - cx));
    const ryc = Math.max(0, Math.min(ry * this.sink, cy, SPRITE_CELL_PX - cy));
    if (rxc <= 0 || ryc <= 0) return;
    this.ops.push({ op: 'ellipse', x: r3(cx), y: r3(cy), rx: r3(rxc), ry: r3(ryc), color });
  }

  polygon(points: readonly number[], color: string): void {
    const mapped = points.map((v, i) => r3(i % 2 === 0 ? this.X(v) : this.Y(v)));
    this.ops.push({ op: 'polygon', points: mapped, color });
  }

  done(): readonly DrawOp[] {
    return this.ops;
  }
}

function poseFor(frame: GuardFrame): { stride: number; collapse: number; firing: boolean } {
  const death = DEATH_FRAMES.indexOf(frame);
  if (death >= 0) return { stride: 0, collapse: (death + 1) / DEATH_FRAMES.length, firing: false };
  if (frame === 'walk-a') return { stride: 1, collapse: 0, firing: false };
  if (frame === 'walk-c') return { stride: -1, collapse: 0, firing: false };
  return { stride: 0, collapse: 0, firing: frame === 'attack' };
}

function drawGuard(angle: number, frame: GuardFrame, jitter: () => number): readonly DrawOp[] {
  const theta = angle * VIEW_ANGLE_STEP_RADIANS;
  const lateral = Math.sin(theta);
  const forward = Math.cos(theta);
  const side = Math.abs(lateral);
  const { stride, collapse, firing } = poseFor(frame);
  const p = new CellProgram(1 - 0.72 * collapse, 1 + 0.22 * collapse);

  // The shadow stays on the floor whatever the body does, widening as it falls.
  p.ellipse(CX, GROUND + 1, 12 + 6 * collapse, 3.5, C.shadow);

  const torsoW = 20 - 6 * side;
  const weaponX = CX + lateral * 8;
  const behind = forward < 0;

  // A dark stock across the body, a lighter barrel past it, a muzzle flash only
  // while firing. Drawn first when the guard is turned away.
  const drawWeapon = (): void => {
    const barrelY = firing ? 33 : 36;
    p.rect(weaponX - 11, barrelY + 1, 13, 3, C.weapon);
    p.rect(weaponX + 2, barrelY + 1.6, 12, 1.8, C.metal);
    if (firing) {
      const tip = weaponX + 14;
      p.polygon([tip, barrelY + 2.5, tip + 6, barrelY - 1, tip + 6, barrelY + 6], C.muzzle);
    }
  };
  if (behind) drawWeapon();

  // Legs and boots, then arms, far side first so the near one overlaps it.
  for (const sign of [-1, 1]) {
    const legX = CX + sign * (4 - 1.6 * side) + sign * stride * (2.5 + 2.5 * side);
    const legW = 5.5 - 1.2 * side + jitter() * 0.4;
    const far = sign * lateral < 0;
    p.rect(legX - legW / 2, HIP - 1, legW, GROUND - HIP - 3, far ? C.shade : C.trouser);
    p.rect(legX - legW / 2 - 0.5, GROUND - 4, legW + 1, 4, C.boot);
  }

  // Tunic, with the shaded half showing when the guard is turned away.
  p.rect(CX - torsoW / 2, TOP, torsoW, HIP - TOP, C.tunic);
  p.rect(CX - torsoW / 2 + (lateral >= 0 ? 0 : torsoW * 0.6), TOP, torsoW * 0.4, HIP - TOP, C.shade);

  const armY = TOP + 6 + jitter();
  for (const sign of [-1, 1]) {
    const armX = CX + sign * (torsoW / 2 - 1);
    p.rect(armX - 2, armY, 4, firing ? 10 : 13, sign * lateral < 0 ? C.shade : C.tunic);
  }

  p.rect(CX - torsoW / 2, HIP - 4, torsoW, 3, C.belt);
  p.rect(CX - 1.5, HIP - 4, 3, 3, C.buckle);

  // A face only when there is one to see, the helmet strap when there is not.
  const headRx = 6 - 1.4 * side;
  p.ellipse(CX, HEAD_Y + 4, headRx, 6, C.skin);
  p.ellipse(CX, HEAD_Y + 1, headRx + 1.5, 5, C.helmet);
  p.rect(CX - headRx - 1.5, HEAD_Y + 1, (headRx + 1.5) * 2, 2, C.helmetShade);
  if (forward > 0.3) {
    const eyes = 2.4 * (1 - side * 0.5);
    p.rect(CX - eyes - 1, HEAD_Y + 4, 1.6, 1.6, C.eye);
    p.rect(CX + eyes - 0.6, HEAD_Y + 4, 1.6, 1.6, C.eye);
  } else if (forward < -0.3) {
    p.rect(CX - headRx, HEAD_Y + 6, headRx * 2, 1.6, C.helmetShade);
  }

  if (!behind) drawWeapon();

  // The last two death frames carry the wound that put the guard there.
  if (collapse >= 0.5) p.ellipse(CX + lateral * 3, TOP + 6, 3.5, 2.5, C.blood);

  return p.done();
}

/** Deterministic in `seed`: the jitter that keeps eight angles from looking machined
 *  is drawn from `./rng.ts` in a fixed order, so two calls with one seed produce
 *  byte-identical programs (US4-S2). */
export function guardSheetPlan(seed: number = GUARD_SHEET_SEED): SheetPlan {
  const cells: SheetCell[] = [];
  for (let frameIndex = 0; frameIndex < GUARD_FRAMES.length; frameIndex += 1) {
    const frame = GUARD_FRAMES[frameIndex]!;
    for (let angle = 0; angle < VIEW_ANGLE_COUNT; angle += 1) {
      // One generator per cell, seeded by the cell's own position, so a cell's
      // jitter does not depend on how many cells were drawn before it.
      const rng = createRng(seed + frameIndex * VIEW_ANGLE_COUNT + angle);
      const { x, y } = cellRect(angle, frameIndex);
      const ops = drawGuard(angle, frame, () => rng.nextSigned() * 0.6);
      cells.push({ angle, frame, frameIndex, x, y, ops });
    }
  }

  return {
    cell: SPRITE_CELL_PX,
    columns: VIEW_ANGLE_COUNT,
    rows: GUARD_FRAMES.length,
    width: VIEW_ANGLE_COUNT * SPRITE_CELL_PX,
    height: GUARD_FRAMES.length * SPRITE_CELL_PX,
    frames: GUARD_FRAMES,
    seed,
    cells,
  };
}
