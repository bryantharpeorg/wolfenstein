// The guard sprite sheet as a *plan*: its dimensions and the ordered canvas-2D
// draw program for every angle-and-frame cell on it (FR-009, US4-S2). Pure — no
// canvas, no DOM, no three.js (FR-001) — which is the whole reason the sheet is
// split in two: the declared geometry and the figure itself are asserted under
// `npm run test`, and `sprite-sheet.ts` is left as a replay loop with no
// decisions in it.
//
// The sheet is 8 columns (one per view angle, `view-angle.ts`'s convention) by
// `frames` rows, the last `deathFrames` of which are the death animation. Every
// pixel of it is drawn from these numbers at load time: no image file is read,
// and none exists (Constitution II).

import { createRng } from './rng';
import { VIEW_ANGLE_COUNT, VIEW_ANGLE_STEP_RADIANS } from './view-angle';

/** One cell's edge in pixels. 64 keeps a ten-guard sheet at 512x512. */
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

/** One canvas-2D operation, in cell-local pixels with y growing downward — the
 *  canvas's own axes, so the replay in `sprite-sheet.ts` needs no arithmetic. */
export type DrawOp =
  | { readonly op: 'rect'; readonly color: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'ellipse'; readonly color: string; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
  | { readonly op: 'polygon'; readonly color: string; readonly points: readonly Vec2[] };

export interface SpriteCellPlan {
  readonly angle: number;
  readonly frame: number;
  readonly kind: 'walk' | 'death';
  /** The cell's top-left corner on the sheet, in pixels. */
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

// --- The palette ------------------------------------------------------------
//
// Original colours, mixed here from numbers (Constitution VI): a blue-grey
// uniform darkened as the guard turns away from the viewer, so the eight columns
// read as one figure lit from the front rather than as eight silhouettes.

const UNIFORM = [0x3d, 0x4a, 0x63] as const;
const TRIM = [0x1e, 0x22, 0x30] as const;
const SKIN = [0xc8, 0x9a, 0x72] as const;
const WEAPON = [0x2a, 0x2a, 0x2e] as const;
const SHADOW = [0x1a, 0x1c, 0x22] as const;
const BLOOD = [0x6a, 0x1c, 0x1c] as const;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Three channels to `#rrggbb`, lower case: the form a 2D context takes. */
function hex(channels: readonly [number, number, number], shade = 0): string {
  return `#${channels
    .map((channel) => Math.round(clamp(channel * (1 + shade), 0, 255)).toString(16).padStart(2, '0'))
    .join('')}`;
}

// --- The op builder ---------------------------------------------------------
//
// Shapes are written in unit coordinates (0..1 across the cell) and converted
// once here, clamped so nothing can ever spill into the neighbouring cell — a
// sprite that bled sideways would show its neighbour's arm at that bearing.

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

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
      ops.push({
        op: 'ellipse',
        color,
        x: round3(clamp(x * cell, rxp, cell - rxp)),
        y: round3(clamp(y * cell, ryp, cell - ryp)),
        rx: rxp,
        ry: ryp,
      });
    },
    polygon(color: string, points: readonly Vec2[]): void {
      if (points.length < 3) return;
      ops.push({
        op: 'polygon',
        color,
        points: points.map((point) => ({ x: round3(px(point.x)), y: round3(px(point.y)) })),
      });
    },
  };
}

// --- The figure -------------------------------------------------------------

/** Where the ground is in the cell, and where the guard stands on it. */
const GROUND_Y = 0.93;
const CENTRE_X = 0.5;

interface Turn {
  /** The sideways component of the relative bearing: +1 with the viewer abeam
   *  the guard on one side, -1 on the other. */
  readonly side: number;
  /** +1 when the viewer sees the guard's front, -1 its back. */
  readonly front: number;
  /** Which way the guard's nose points across the *image*, from the viewer's
   *  own left (-1) to its right (+1). A guard seen face on has its nose toward
   *  the viewer and this is 0; abeam, it is the profile's direction. */
  readonly nose: number;
}

/** The two projections of one view angle. Column 0 is the front (`view-angle.ts`). */
function turnFor(angle: number, angles: number): Turn {
  const radians = angle * ((Math.PI * 2) / angles);
  const side = Math.sin(radians);
  // Derived once, here: with `view-angle.ts`'s convention a viewer at relative
  // bearing `b` sees the guard's front projected onto its own right as `-sin b`.
  // Getting this sign wrong reflects every profile, which no test of column
  // *distinctness* would ever catch.
  return { side, front: Math.cos(radians), nose: -side };
}

/** A standing guard at one bearing, one step of the walk cycle. */
function walkCell(cell: number, turn: Turn, phase: number, jitter: () => number): DrawOp[] {
  const draw = createOps(cell);
  const swing = Math.sin(phase) * 0.05;
  const bob = Math.cos(phase) * 0.012;
  // Narrower from the side, widest face on: the silhouette is what sells the
  // bearing, so it is the first thing that changes with the angle.
  const halfWidth = 0.135 - 0.05 * Math.abs(turn.side);
  const shade = 0.12 * turn.front;
  const uniform = hex(UNIFORM, shade);
  const trim = hex(TRIM, shade);

  const shoulderY = 0.34 - bob;
  const hipY = 0.62 - bob;
  const headY = 0.22 - bob;

  draw.ellipse(hex(SHADOW), CENTRE_X, GROUND_Y + 0.02, 0.16, 0.035);

  // Legs, swinging in opposite phase so the cycle reads as a walk.
  for (const leg of [-1, 1]) {
    const x = CENTRE_X + leg * 0.055 + leg * swing;
    draw.rect(uniform, x - 0.045, hipY, 0.09, GROUND_Y - 0.05 - hipY);
    draw.rect(trim, x - 0.05, GROUND_Y - 0.06, 0.1, 0.06);
  }

  // Torso: a trapezoid, shoulders wider than hips, leaning very slightly the way
  // the guard is looking so a side view is not a mirror of the front.
  const lean = 0.02 * turn.nose;
  draw.polygon(uniform, [
    { x: CENTRE_X - halfWidth - 0.03 + lean, y: shoulderY },
    { x: CENTRE_X + halfWidth + 0.03 + lean, y: shoulderY },
    { x: CENTRE_X + halfWidth, y: hipY },
    { x: CENTRE_X - halfWidth, y: hipY },
  ]);
  draw.rect(trim, CENTRE_X - halfWidth, hipY - 0.05, halfWidth * 2, 0.05);

  // Head: skin face on, a cap covering it from behind.
  const headX = CENTRE_X + 0.02 * turn.nose + jitter();
  draw.ellipse(hex(SKIN, shade * 0.5), headX, headY, 0.095, 0.105);
  draw.rect(trim, headX - 0.095, headY - 0.105, 0.19, 0.075 - 0.03 * turn.front);
  if (turn.front > 0.3) {
    for (const eye of [-1, 1]) draw.rect(hex(TRIM), headX + eye * 0.04 - 0.012, headY + 0.01, 0.024, 0.018);
  } else if (turn.front > -0.3) {
    // A profile: one eye, on the side the nose points.
    draw.rect(hex(TRIM), headX + turn.nose * 0.045 - 0.012, headY + 0.01, 0.024, 0.018);
  }

  // The weapon, held in the guard's right hand: that hand is across the image at
  // `-front`, and the barrel lies along the guard's nose, so it foreshortens to a
  // stub face on and reaches its full length abeam -- the other half of the
  // bearing cue after the silhouette.
  const barrel = 0.06 + 0.16 * Math.abs(turn.side);
  const armX = CENTRE_X - turn.front * (halfWidth + 0.02);
  draw.rect(hex(WEAPON), turn.nose >= 0 ? armX : armX - barrel, 0.5 - bob, barrel, 0.045);
  draw.rect(hex(SKIN, shade * 0.5), armX - 0.03, 0.47 - bob, 0.06, 0.06);

  return draw.ops;
}

/** The collapse: `progress` runs 0 at the first death frame to 1 at the last,
 *  where the guard is a heap on the floor and stays one (US4-S5). */
function deathCell(cell: number, turn: Turn, progress: number, jitter: () => number): DrawOp[] {
  const draw = createOps(cell);
  const shade = 0.12 * turn.front;
  const uniform = hex(UNIFORM, shade - 0.15 * progress);
  const trim = hex(TRIM, shade);
  // A body falls the way it was turned, so the heap is not the same picture at
  // every bearing.
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

// --- The plan ---------------------------------------------------------------

/**
 * The whole sheet: `angles * cell` wide by `frames * cell` tall, with an ordered
 * draw program for every cell (US4-S2). Deterministic for a given seed — the
 * jitter is the only randomness and it comes from `rng.ts`, so two builds of one
 * seed are byte-identical programs.
 */
export function buildSheetPlan(options: SheetPlanOptions = {}): SheetPlan {
  const cell = options.cell ?? SPRITE_CELL_PIXELS;
  const angles = options.angles ?? SPRITE_VIEW_ANGLES;
  const frames = options.frames ?? SPRITE_FRAME_COUNT;
  // At least one walk frame survives however few rows are asked for: a sheet of
  // nothing but corpses would have no living guard to draw.
  const deathFrames = clamp(options.deathFrames ?? DEATH_FRAME_COUNT, 1, Math.max(1, frames - 1));
  const walkFrames = frames - deathFrames;

  const rng = createRng(options.seed ?? GUARD_SHEET_SEED);
  const jitter = (): number => rng.nextSigned() * 0.006;

  const cells: SpriteCellPlan[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const kind: 'walk' | 'death' = frame < walkFrames ? 'walk' : 'death';
    for (let angle = 0; angle < angles; angle += 1) {
      const turn = turnFor(angle, angles);
      const ops =
        kind === 'walk'
          ? walkCell(cell, turn, (frame / walkFrames) * Math.PI * 2, jitter)
          : deathCell(
              cell,
              turn,
              deathFrames === 1 ? 1 : (frame - walkFrames) / (deathFrames - 1),
              jitter,
            );
      cells.push({ angle, frame, kind, x: angle * cell, y: frame * cell, ops });
    }
  }

  return {
    cell,
    angles,
    frames,
    walkFrames,
    deathFrames,
    width: angles * cell,
    height: frames * cell,
    cells,
  };
}

/** The cell at one angle and frame. Throws rather than returning a hole: an
 *  out-of-range column is a bug in the caller's arithmetic, not a blank sprite. */
export function cellPlan(plan: SheetPlan, angle: number, frame: number): SpriteCellPlan {
  const cell = plan.cells[frame * plan.angles + angle];
  if (cell == null) throw new Error(`no sprite cell at angle ${angle}, frame ${frame}`);
  return cell;
}

/** The walk row for a guard that has been moving for `elapsedMs`. Cycles. */
export function walkFrameIndex(plan: SheetPlan, elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.floor(elapsed / WALK_FRAME_MS) % plan.walkFrames;
}

/** The death row for a guard `elapsedMs` into dying: advances over the declared
 *  duration and then *holds* the last frame forever (US4-S5, US4-S6). */
export function deathFrameIndex(plan: SheetPlan, elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const step = DEATH_ANIMATION_MS / plan.deathFrames;
  const reached = Math.floor(elapsed / step);
  return plan.walkFrames + Math.min(plan.deathFrames - 1, reached);
}

/** The angular width of a column, restated for the replay so it need not import
 *  the bearing module to know how wide a view is. */
export const SPRITE_ANGLE_STEP_RADIANS = VIEW_ANGLE_STEP_RADIANS;
