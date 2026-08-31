// The guard sprite sheet as a *plan*: dimensions plus the ordered canvas-2D draw
// program for every angle-and-frame cell (FR-009, US4-S2). Pure — no canvas, no
// DOM, no three.js (FR-001) — so the geometry and the figure are asserted under
// `npm run test` and `sprite-sheet.ts` is left a replay loop. 8 columns by
// `frames` rows, the last `deathFrames` of them the death animation, every pixel
// from these numbers at load time (Constitution II).

import { createRng } from './rng';
import { VIEW_ANGLE_COUNT } from './view-angle';

/** One cell's edge in pixels; 64 keeps the sheet at 512x512. */
export const SPRITE_CELL_PIXELS = 64;

/** Columns: the eight view angles `view-angle.ts` indexes (FR-009). */
export const SPRITE_VIEW_ANGLES = VIEW_ANGLE_COUNT;

/** Rows: the walk cycle first, then the death frames. */
export const WALK_FRAME_COUNT = 4;
export const DEATH_FRAME_COUNT = 4;
export const SPRITE_FRAME_COUNT = WALK_FRAME_COUNT + DEATH_FRAME_COUNT;

/** Milliseconds per frame, and so the declared death duration (US4-S5). */
export const WALK_FRAME_MS = 180;
export const DEATH_FRAME_MS = 150;
export const DEATH_ANIMATION_MS = DEATH_FRAME_COUNT * DEATH_FRAME_MS;

/** The seed the figure's jitter is drawn from, so the sheet repeats exactly. */
export const GUARD_SHEET_SEED = 0x73707274;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** One canvas-2D operation, in cell-local pixels, y downward: the canvas's own
 *  axes, so the replay needs no arithmetic. */
export type DrawOp =
  | { readonly op: 'rect'; readonly color: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'ellipse'; readonly color: string; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
  | { readonly op: 'polygon'; readonly color: string; readonly points: readonly Vec2[] };

export interface SpriteCellPlan {
  readonly angle: number;
  readonly frame: number;
  readonly kind: 'walk' | 'death';
  /** Top-left corner on the sheet, in pixels. */
  readonly x: number;
  readonly y: number;
  readonly ops: readonly DrawOp[];
}

export interface SheetPlan {
  readonly cell: number;
  readonly angles: number;
  readonly frames: number;
  readonly walkFrames: number;
  readonly deathFrames: number;
  readonly width: number;
  readonly height: number;
  /** Row-major: frame 0's angles first. Indexed by `cellPlan`. */
  readonly cells: readonly SpriteCellPlan[];
}

export interface SheetPlanOptions {
  readonly cell?: number;
  readonly angles?: number;
  readonly frames?: number;
  readonly deathFrames?: number;
  readonly seed?: number;
}

// Original colours, mixed from numbers (Constitution VI); the uniform darkens as
// the guard turns away, so the columns read as one figure lit from the front.
const UNIFORM = [0x3d, 0x4a, 0x63] as const;
const TRIM = [0x1e, 0x22, 0x30] as const;
const SKIN = [0xc8, 0x9a, 0x72] as const;
const WEAPON = [0x2a, 0x2a, 0x2e] as const;
const SHADOW = [0x1a, 0x1c, 0x22] as const;
const BLOOD = [0x6a, 0x1c, 0x1c] as const;

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Three channels to `#rrggbb`. */
const hex = (channels: readonly [number, number, number], shade = 0): string =>
  `#${channels.map((c) => Math.round(clamp(c * (1 + shade), 0, 255)).toString(16).padStart(2, '0')).join('')}`;

// Unit coordinates (0..1 across the cell), converted once here and clamped so
// nothing spills into the neighbouring cell.
function createOps(cell: number) {
  const ops: DrawOp[] = [];
  const px = (value: number): number => clamp(value * cell, 0, cell);
  return {
    ops,
    rect(color: string, x: number, y: number, w: number, h: number): void {
      const x0 = round3(px(x));
      const y0 = round3(px(y));
      const x1 = round3(px(x + w));
      const y1 = round3(px(y + h));
      if (x1 <= x0 || y1 <= y0) return;
      ops.push({ op: 'rect', color, x: x0, y: y0, w: round3(x1 - x0), h: round3(y1 - y0) });
    },
    ellipse(color: string, x: number, y: number, rx: number, ry: number): void {
      const rxp = round3(clamp(rx * cell, 0, cell / 2));
      const ryp = round3(clamp(ry * cell, 0, cell / 2));
      if (rxp <= 0 || ryp <= 0) return;
      const cx = round3(clamp(x * cell, rxp, cell - rxp));
      const cy = round3(clamp(y * cell, ryp, cell - ryp));
      ops.push({ op: 'ellipse', color, x: cx, y: cy, rx: rxp, ry: ryp });
    },
    polygon(color: string, points: readonly Vec2[]): void {
      if (points.length < 3) return;
      const scaled = points.map((p) => ({ x: round3(px(p.x)), y: round3(px(p.y)) }));
      ops.push({ op: 'polygon', color, points: scaled });
    },
  };
}

/** Where the ground is, and where the guard stands on it. */
const GROUND_Y = 0.93;
const CENTRE_X = 0.5;

interface Turn {
  /** Sideways component of the relative bearing: +-1 abeam. */
  readonly side: number;
  /** +1 seeing the guard's front, -1 its back. */
  readonly front: number;
  /** Where the nose points across the *image*: -1 left, +1 right, 0 face on. */
  readonly nose: number;
}

/** The two projections of one view angle; column 0 is the front. The `nose` sign
 *  follows `view-angle.ts` — reflecting it reflects every profile, which no test
 *  of column *distinctness* would catch. */
function turnFor(angle: number, angles: number): Turn {
  const radians = angle * ((Math.PI * 2) / angles);
  const side = Math.sin(radians);
  return { side, front: Math.cos(radians), nose: -side };
}

/** A standing guard at one bearing, one step of the walk cycle. */
function walkCell(cell: number, turn: Turn, phase: number, jitter: () => number): DrawOp[] {
  const draw = createOps(cell);
  const swing = Math.sin(phase) * 0.05;
  const bob = Math.cos(phase) * 0.012;
  // Narrower from the side, widest face on: the silhouette sells the bearing.
  const halfWidth = 0.135 - 0.05 * Math.abs(turn.side);
  const shade = 0.12 * turn.front;
  const uniform = hex(UNIFORM, shade);
  const trim = hex(TRIM, shade);

  const shoulderY = 0.34 - bob;
  const hipY = 0.62 - bob;
  const headY = 0.22 - bob;

  draw.ellipse(hex(SHADOW), CENTRE_X, GROUND_Y + 0.02, 0.16, 0.035);

  // Legs, in opposite phase, so the cycle reads as a walk.
  for (const leg of [-1, 1]) {
    const x = CENTRE_X + leg * 0.055 + leg * swing;
    draw.rect(uniform, x - 0.045, hipY, 0.09, GROUND_Y - 0.05 - hipY);
    draw.rect(trim, x - 0.05, GROUND_Y - 0.06, 0.1, 0.06);
  }

  // Torso: shoulders wider than hips, leaning the way the guard looks so a side
  // view is not a mirror of the front.
  const lean = 0.02 * turn.nose;
  draw.polygon(uniform, [
    { x: CENTRE_X - halfWidth - 0.03 + lean, y: shoulderY },
    { x: CENTRE_X + halfWidth + 0.03 + lean, y: shoulderY },
    { x: CENTRE_X + halfWidth, y: hipY },
    { x: CENTRE_X - halfWidth, y: hipY },
  ]);
  draw.rect(trim, CENTRE_X - halfWidth, hipY - 0.05, halfWidth * 2, 0.05);

  // Head: a cap over skin; two eyes front, one in profile, none from behind.
  const headX = CENTRE_X + 0.02 * turn.nose + jitter();
  draw.ellipse(hex(SKIN, shade * 0.5), headX, headY, 0.095, 0.105);
  draw.rect(trim, headX - 0.095, headY - 0.105, 0.19, 0.075 - 0.03 * turn.front);
  if (turn.front > 0.3) {
    for (const eye of [-1, 1]) draw.rect(hex(TRIM), headX + eye * 0.04 - 0.012, headY + 0.01, 0.024, 0.018);
  } else if (turn.front > -0.3) {
    draw.rect(hex(TRIM), headX + turn.nose * 0.045 - 0.012, headY + 0.01, 0.024, 0.018);
  }

  // The weapon lies along the nose: a stub face on, full length abeam — the
  // other half of the bearing cue.
  const barrel = 0.06 + 0.16 * Math.abs(turn.side);
  const armX = CENTRE_X - turn.front * (halfWidth + 0.02);
  draw.rect(hex(WEAPON), turn.nose >= 0 ? armX : armX - barrel, 0.5 - bob, barrel, 0.045);
  draw.rect(hex(SKIN, shade * 0.5), armX - 0.03, 0.47 - bob, 0.06, 0.06);

  return draw.ops;
}

/** The collapse: `progress` 0 at the first death frame to 1 at the last, where
 *  the guard is a heap on the floor and stays one (US4-S5). */
function deathCell(cell: number, turn: Turn, progress: number, jitter: () => number): DrawOp[] {
  const draw = createOps(cell);
  const shade = 0.12 * turn.front;
  const uniform = hex(UNIFORM, shade - 0.15 * progress);
  const trim = hex(TRIM, shade);
  // A body falls the way it was turned, so the heap differs by bearing.
  const fall = turn.nose >= 0 ? 1 : -1;

  draw.ellipse(hex(SHADOW), CENTRE_X, GROUND_Y + 0.02, 0.16 + 0.08 * progress, 0.035);
  if (progress > 0.5) draw.ellipse(hex(BLOOD), CENTRE_X + fall * 0.1, GROUND_Y - 0.01, 0.09 * progress, 0.03);

  // The body sinks and spreads: upright at 0, prone at 1.
  const topY = 0.34 + 0.46 * progress;
  const halfWidth = 0.13 + 0.14 * progress;
  draw.polygon(uniform, [
    { x: CENTRE_X - halfWidth + fall * 0.08 * progress, y: topY },
    { x: CENTRE_X + halfWidth + fall * 0.08 * progress, y: topY },
    { x: CENTRE_X + halfWidth * 0.8, y: GROUND_Y - 0.02 },
    { x: CENTRE_X - halfWidth * 0.8, y: GROUND_Y - 0.02 },
  ]);
  draw.rect(trim, CENTRE_X - halfWidth * 0.8, GROUND_Y - 0.07, halfWidth * 1.6, 0.05);

  const headX = CENTRE_X + fall * (0.03 + 0.22 * progress) + jitter();
  const headY = 0.22 + (GROUND_Y - 0.06 - 0.22) * progress;
  draw.ellipse(hex(SKIN, shade * 0.5 - 0.2 * progress), headX, headY, 0.095, 0.1 - 0.015 * progress);
  draw.rect(trim, headX - 0.095, headY - 0.1, 0.19, 0.055);

  // The weapon is dropped, not carried: it falls away as the guard does.
  draw.rect(hex(WEAPON), CENTRE_X + fall * (0.1 + 0.16 * progress), GROUND_Y - 0.05 - 0.3 * (1 - progress), 0.16, 0.04);

  return draw.ops;
}

/** The whole sheet: `angles * cell` wide by `frames * cell` tall, with an
 *  ordered draw program for every cell (US4-S2). Deterministic for a given seed:
 *  the jitter is the only randomness and it comes from `rng.ts`. */
export function buildSheetPlan(options: SheetPlanOptions = {}): SheetPlan {
  const cell = options.cell ?? SPRITE_CELL_PIXELS;
  const angles = options.angles ?? SPRITE_VIEW_ANGLES;
  const frames = options.frames ?? SPRITE_FRAME_COUNT;
  // At least one walk frame survives however few rows are asked for.
  const deathFrames = clamp(options.deathFrames ?? DEATH_FRAME_COUNT, 1, Math.max(1, frames - 1));
  const walkFrames = frames - deathFrames;

  const rng = createRng(options.seed ?? GUARD_SHEET_SEED);
  const jitter = (): number => rng.nextSigned() * 0.006;

  const cells: SpriteCellPlan[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const kind: 'walk' | 'death' = frame < walkFrames ? 'walk' : 'death';
    const progress = deathFrames === 1 ? 1 : (frame - walkFrames) / (deathFrames - 1);
    for (let angle = 0; angle < angles; angle += 1) {
      const turn = turnFor(angle, angles);
      const ops =
        kind === 'walk'
          ? walkCell(cell, turn, (frame / walkFrames) * Math.PI * 2, jitter)
          : deathCell(cell, turn, progress, jitter);
      cells.push({ angle, frame, kind, x: angle * cell, y: frame * cell, ops });
    }
  }

  return { cell, angles, frames, walkFrames, deathFrames, width: angles * cell, height: frames * cell, cells };
}

/** The cell at one angle and frame. Throws rather than returning a hole. */
export function cellPlan(plan: SheetPlan, angle: number, frame: number): SpriteCellPlan {
  const cell = plan.cells[frame * plan.angles + angle];
  if (cell == null) throw new Error(`no sprite cell at angle ${angle}, frame ${frame}`);
  return cell;
}

const sinceStart = (ms: number): number => (Number.isFinite(ms) && ms > 0 ? ms : 0);

/** The walk row for a guard that has been moving for `elapsedMs`. Cycles. */
export function walkFrameIndex(plan: SheetPlan, elapsedMs: number): number {
  return Math.floor(sinceStart(elapsedMs) / WALK_FRAME_MS) % plan.walkFrames;
}

/** The death row for a guard `elapsedMs` into dying: advances over the declared
 *  duration and then *holds* the last frame forever (US4-S5, US4-S6). */
export function deathFrameIndex(plan: SheetPlan, elapsedMs: number): number {
  const step = DEATH_ANIMATION_MS / plan.deathFrames;
  return plan.walkFrames + Math.min(plan.deathFrames - 1, Math.floor(sinceStart(elapsedMs) / step));
}
