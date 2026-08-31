// The guard sprite sheet as a *plan* rather than as pixels (FR-009, US4-S2).
//
// Constitution II forbids a binary asset, so the guard's art is a program: an
// ordered list of canvas-2D operations per cell, replayed onto a real canvas by
// `./sprite-sheet.ts`. Splitting the plan from the replay is what puts the whole
// of US4-S2 — the declared dimensions and the fact that a figure exists for every
// angle and every frame, death included — under `npm run test` with no canvas
// shim (Article III).
//
// The sheet is laid out angle-across, frame-down: `8 * cell` wide, one column per
// view angle of `./view-angle.ts`, and `frames * cell` tall, one row per declared
// frame. Nothing here knows what a texture is.

import { createRng } from './rng';
import { VIEW_ANGLE_COUNT, VIEW_ANGLE_STEP_RADIANS } from './view-angle';

/** One cell's side, in pixels. Square, so a column is as wide as a row is tall. */
export const SPRITE_CELL_PX = 64;

/** The default seed. The figure is jittered, not random: a seed reproduces it. */
export const GUARD_SHEET_SEED = 0x5eed6a4d;

/** The frames the sheet carries, in row order. The death frames are last so a
 *  frame index past the live ones is always a death frame. */
export const GUARD_FRAMES = [
  'stand',
  'walk-a',
  'walk-b',
  'walk-c',
  'attack',
  'death-a',
  'death-b',
  'death-c',
  'death-d',
] as const;

export type GuardFrame = (typeof GUARD_FRAMES)[number];

/** The walk cycle, in the order it plays. */
export const WALK_FRAMES: readonly GuardFrame[] = ['walk-a', 'walk-b', 'walk-c'];

/** The death frames, in the order they play; the last one is the one held
 *  forever afterwards (US4-S5). */
export const DEATH_FRAMES: readonly GuardFrame[] = ['death-a', 'death-b', 'death-c', 'death-d'];

/** How long the whole death animation takes. Declared here beside the frames it
 *  runs over, so `./billboard.ts` reads a constant rather than owning one. */
export const DEATH_DURATION_MS = 800;

/** One canvas-2D operation. A closed set: the replay in `./sprite-sheet.ts` is a
 *  total switch over it, so a new shape cannot be added silently on one side. */
export type DrawOp =
  | { readonly op: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: string }
  | { readonly op: 'ellipse'; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number; readonly color: string }
  | { readonly op: 'polygon'; readonly points: readonly number[]; readonly color: string };

/** One cell of the sheet: where it sits, and the program that fills it. */
export interface SheetCell {
  /** The view-angle column, `0..7`; 0 is the front view (see `./view-angle.ts`). */
  readonly angle: number;
  readonly frame: GuardFrame;
  /** The row, equal to the frame's index in `GUARD_FRAMES`. */
  readonly frameIndex: number;
  /** The cell's top-left corner on the sheet, in pixels. */
  readonly x: number;
  readonly y: number;
  /** Cell-local coordinates: `(0,0)` is the cell's own corner. */
  readonly ops: readonly DrawOp[];
}

export interface SheetPlan {
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly GuardFrame[];
  readonly seed: number;
  readonly cells: readonly SheetCell[];
}

/** The row a frame occupies. */
export function frameIndexOf(frame: GuardFrame): number {
  return GUARD_FRAMES.indexOf(frame);
}

/** Where a cell sits on the sheet, in pixels — the rectangle the renderer's UVs
 *  are cut from. */
export function cellRect(
  angle: number,
  frameIndex: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: angle * SPRITE_CELL_PX,
    y: frameIndex * SPRITE_CELL_PX,
    width: SPRITE_CELL_PX,
    height: SPRITE_CELL_PX,
  };
}

// --- The figure -------------------------------------------------------------
//
// An original blocky guard in a field uniform (Constitution VI): boots, tunic,
// belt, helmet, and a rifle held across the body. Nothing is traced from
// anything; every number below is a coordinate in a 64-pixel cell.

const PALETTE = {
  shadow: '#101010',
  boot: '#221f1c',
  trouser: '#3a4436',
  tunic: '#4a5f42',
  tunicShade: '#36452f',
  belt: '#1d1a17',
  buckle: '#8a7a3f',
  skin: '#c0996f',
  helmet: '#4d4f52',
  helmetShade: '#35373a',
  eye: '#141414',
  weapon: '#26241f',
  weaponMetal: '#787876',
  muzzle: '#f5c451',
  blood: '#5c1b1b',
} as const;

const CX = SPRITE_CELL_PX / 2;
const GROUND = 60;
const HEAD_Y = 18;
const TORSO_TOP = 26;
const TORSO_BOTTOM = 45;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const clamp = (value: number): number => Math.min(SPRITE_CELL_PX, Math.max(0, value));

/** The emitter. Clamps every coordinate into the cell, so a jittered or
 *  death-stretched figure can never bleed into the neighbouring column. */
class CellProgram {
  private readonly ops: DrawOp[] = [];

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const x0 = clamp(x);
    const y0 = clamp(y);
    const x1 = clamp(x + w);
    const y1 = clamp(y + h);
    if (x1 <= x0 || y1 <= y0) return;
    this.ops.push({ op: 'rect', x: round3(x0), y: round3(y0), w: round3(x1 - x0), h: round3(y1 - y0), color });
  }

  ellipse(x: number, y: number, rx: number, ry: number, color: string): void {
    const cx = clamp(x);
    const cy = clamp(y);
    const rxc = Math.max(0, Math.min(rx, cx, SPRITE_CELL_PX - cx));
    const ryc = Math.max(0, Math.min(ry, cy, SPRITE_CELL_PX - cy));
    if (rxc <= 0 || ryc <= 0) return;
    this.ops.push({ op: 'ellipse', x: round3(cx), y: round3(cy), rx: round3(rxc), ry: round3(ryc), color });
  }

  polygon(points: readonly number[], color: string): void {
    this.ops.push({ op: 'polygon', points: points.map((value) => round3(clamp(value))), color });
  }

  done(): readonly DrawOp[] {
    return this.ops;
  }
}

/** What a frame does to the pose, before the angle is applied. */
interface Pose {
  /** Leg swing, `-1..1`; 0 stands still. */
  readonly stride: number;
  /** How far through the death animation, `0..1`; 0 is alive. */
  readonly collapse: number;
  readonly firing: boolean;
}

function poseFor(frame: GuardFrame): Pose {
  const death = DEATH_FRAMES.indexOf(frame);
  if (death >= 0) {
    return { stride: 0, collapse: (death + 1) / DEATH_FRAMES.length, firing: false };
  }
  if (frame === 'walk-a') return { stride: 1, collapse: 0, firing: false };
  if (frame === 'walk-c') return { stride: -1, collapse: 0, firing: false };
  if (frame === 'attack') return { stride: 0, collapse: 0, firing: true };
  return { stride: 0, collapse: 0, firing: false };
}

/**
 * The program for one cell. `angle` is the view-angle column: 0 looks the guard
 * in the face, 4 is its back, and the obliques lie between, so `forward` runs
 * from +1 to -1 and `lateral` swings the weapon across the body.
 */
function drawGuard(angle: number, frame: GuardFrame, jitter: () => number): readonly DrawOp[] {
  const theta = angle * VIEW_ANGLE_STEP_RADIANS;
  const lateral = Math.sin(theta);
  const forward = Math.cos(theta);
  const side = Math.abs(lateral);
  const pose = poseFor(frame);

  const program = new CellProgram();
  const collapse = pose.collapse;

  // The shadow stays on the floor whatever the body does, and widens as the
  // guard falls into it.
  program.ellipse(CX, GROUND + 1, 12 + 6 * collapse, 3.5, PALETTE.shadow);

  // A death frame is the standing figure folded toward the ground: the whole
  // body is scaled about the floor line and spread sideways, which is why the
  // sequence sinks monotonically rather than snapping to a new drawing.
  const sink = 1 - 0.72 * collapse;
  const spread = 1 + 0.22 * collapse;
  const y = (value: number): number => GROUND - (GROUND - value) * sink;
  const x = (value: number): number => CX + (value - CX) * spread;
  const h = (value: number): number => value * sink;
  const w = (value: number): number => value * spread;

  const torsoW = 20 - 6 * side;
  const legGap = 4 - 1.6 * side;
  const legSwing = pose.stride * (2.5 + 2.5 * side);
  const armY = TORSO_TOP + 6 + jitter();
  const weaponX = CX + lateral * 8;
  const behind = forward < 0;

  const drawWeapon = (): void => {
    const raised = pose.firing ? -3 : 0;
    const barrelY = 36 + raised;
    // The rifle: a dark stock across the body and a lighter barrel past it.
    program.rect(x(weaponX - w(11)), y(barrelY + 1), w(13), h(3), PALETTE.weapon);
    program.rect(x(weaponX + w(2)), y(barrelY + 1.6), w(12), h(1.8), PALETTE.weaponMetal);
    if (pose.firing) {
      const tip = weaponX + 14;
      program.polygon(
        [x(tip), y(barrelY + 2.5), x(tip + 6), y(barrelY - 1), x(tip + 6), y(barrelY + 6)],
        PALETTE.muzzle,
      );
    }
  };

  if (behind) drawWeapon();

  // Legs and boots. The far leg is drawn first so the near one overlaps it.
  for (const sign of [-1, 1]) {
    const legX = CX + sign * legGap + sign * legSwing;
    const legW = 5.5 - 1.2 * side + jitter() * 0.4;
    const isFar = sign * lateral < 0;
    program.rect(x(legX - legW / 2), y(TORSO_BOTTOM - 1), w(legW), h(GROUND - TORSO_BOTTOM - 3), isFar ? PALETTE.tunicShade : PALETTE.trouser);
    program.rect(x(legX - legW / 2 - 0.5), y(GROUND - 4), w(legW + 1), h(4), PALETTE.boot);
  }

  // Tunic, with the shaded half showing when the guard is turned away.
  program.rect(x(CX - torsoW / 2), y(TORSO_TOP), w(torsoW), h(TORSO_BOTTOM - TORSO_TOP), PALETTE.tunic);
  program.rect(
    x(CX - torsoW / 2 + (lateral >= 0 ? 0 : torsoW * 0.6)),
    y(TORSO_TOP),
    w(torsoW * 0.4),
    h(TORSO_BOTTOM - TORSO_TOP),
    PALETTE.tunicShade,
  );

  // Arms: the far one first, again so the near one lies over it.
  for (const sign of [-1, 1]) {
    const armX = CX + sign * (torsoW / 2 - 1);
    const isFar = sign * lateral < 0;
    program.rect(x(armX - 2), y(armY), w(4), h(13 - 3 * (pose.firing ? 1 : 0)), isFar ? PALETTE.tunicShade : PALETTE.tunic);
  }

  program.rect(x(CX - torsoW / 2), y(TORSO_BOTTOM - 4), w(torsoW), h(3), PALETTE.belt);
  program.rect(x(CX - 1.5), y(TORSO_BOTTOM - 4), w(3), h(3), PALETTE.buckle);

  // Head, helmet, and a face only when there is one to see.
  const headRx = 6 - 1.4 * side;
  program.ellipse(x(CX), y(HEAD_Y + 4), w(headRx), h(6), PALETTE.skin);
  program.ellipse(x(CX), y(HEAD_Y + 1), w(headRx + 1.5), h(5), PALETTE.helmet);
  program.rect(x(CX - headRx - 1.5), y(HEAD_Y + 1), w((headRx + 1.5) * 2), h(2), PALETTE.helmetShade);
  if (forward > 0.3) {
    const eyeSpread = 2.4 * (1 - side * 0.5);
    program.rect(x(CX - eyeSpread - 1), y(HEAD_Y + 4), w(1.6), h(1.6), PALETTE.eye);
    program.rect(x(CX + eyeSpread - 0.6), y(HEAD_Y + 4), w(1.6), h(1.6), PALETTE.eye);
  } else if (forward < -0.3) {
    // The back of the head: the helmet strap, never a face.
    program.rect(x(CX - headRx), y(HEAD_Y + 6), w(headRx * 2), h(1.6), PALETTE.helmetShade);
  }

  if (!behind) drawWeapon();

  // The last two death frames carry the wound that put the guard there.
  if (collapse >= 0.5) {
    program.ellipse(x(CX + lateral * 3), y(TORSO_TOP + 6), w(3.5), h(2.5), PALETTE.blood);
  }

  return program.done();
}

/**
 * The whole sheet plan. Deterministic in `seed`: the jitter that keeps eight
 * angles from looking machined comes from `./rng.ts`, drawn in a fixed order, so
 * two calls with one seed produce byte-identical programs (US4-S2).
 */
export function guardSheetPlan(seed: number = GUARD_SHEET_SEED): SheetPlan {
  const cells: SheetCell[] = [];
  for (let frameIndex = 0; frameIndex < GUARD_FRAMES.length; frameIndex += 1) {
    const frame = GUARD_FRAMES[frameIndex]!;
    for (let angle = 0; angle < VIEW_ANGLE_COUNT; angle += 1) {
      // One generator per cell, seeded by the cell's own position, so a cell's
      // jitter does not depend on how many cells were drawn before it.
      const rng = createRng(seed + frameIndex * VIEW_ANGLE_COUNT + angle);
      const jitter = (): number => rng.nextSigned() * 0.6;
      const rect = cellRect(angle, frameIndex);
      cells.push({
        angle,
        frame,
        frameIndex,
        x: rect.x,
        y: rect.y,
        ops: drawGuard(angle, frame, jitter),
      });
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
