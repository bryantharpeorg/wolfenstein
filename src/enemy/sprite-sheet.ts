// The replay half of the sprite sheet: `./sprite-shape.ts`'s draw program onto a
// real canvas, once per guard *type* (FR-009, US4-S2, US4-S7).
//
// Two facts are load-bearing and are counted rather than asserted in a comment.
// One canvas and one texture exist per type, memoized here, so ten guards cost
// one sheet and one upload — a per-instance canvas is the failure this module is
// shaped to make impossible (Edge Cases). And the canvas is drawn by canvas-2D
// calls at load time from code, never decoded from a file, which is the whole of
// Constitution II for the guard's art.

import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import { GUARD_SHEET_SEED, guardSheetPlan, type DrawOp, type SheetPlan } from './sprite-shape';

/** The guard types this milestone ships. One sheet is built per entry. */
export const GUARD_TYPES = ['guard'] as const;

export type GuardType = (typeof GUARD_TYPES)[number];

export interface GuardSheet {
  readonly type: string;
  readonly plan: SheetPlan;
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
}

/** How many sheets have been built, and how many textures they cost. US4-S7 is
 *  stated over these numbers, so the renderer publishes them rather than
 *  claiming them. */
export interface SheetStats {
  readonly types: number;
  readonly canvases: number;
  readonly textures: number;
}

const sheets = new Map<string, GuardSheet>();

/** A type's own seed: the same guard type always draws the same figure, and a
 *  second type would draw a different one without a new constant. */
function seedForType(type: string, seed: number): number {
  let hash = seed | 0;
  for (let index = 0; index < type.length; index += 1) {
    hash = (Math.imul(hash, 31) + type.charCodeAt(index)) | 0;
  }
  return hash;
}

function applyOp(context: CanvasRenderingContext2D, op: DrawOp): void {
  context.fillStyle = op.color;
  switch (op.op) {
    case 'rect':
      context.fillRect(op.x, op.y, op.w, op.h);
      return;
    case 'ellipse':
      context.beginPath();
      context.ellipse(op.x, op.y, op.rx, op.ry, 0, 0, Math.PI * 2);
      context.fill();
      return;
    case 'polygon': {
      if (op.points.length < 6) return;
      context.beginPath();
      context.moveTo(op.points[0]!, op.points[1]!);
      for (let index = 2; index + 1 < op.points.length; index += 2) {
        context.lineTo(op.points[index]!, op.points[index + 1]!);
      }
      context.closePath();
      context.fill();
      return;
    }
  }
}

/**
 * Replays a plan onto a context, cell by cell in the plan's own order. The
 * canvas is left transparent everywhere the program does not paint, so the
 * billboard's alpha test cuts the figure out of its cell.
 */
export function replayPlan(context: CanvasRenderingContext2D, plan: SheetPlan): void {
  context.clearRect(0, 0, plan.width, plan.height);
  for (const cell of plan.cells) {
    context.save();
    context.translate(cell.x, cell.y);
    for (const op of cell.ops) applyOp(context, op);
    context.restore();
  }
}

/**
 * The sheet for a guard type, built once. A second call for the same type
 * returns the same canvas and the same texture — that identity *is* US4-S7's
 * "exactly one texture per guard type", so it is asserted by comparing objects
 * rather than by counting uploads after the fact.
 */
export function buildGuardSheet(
  type: GuardType | string = 'guard',
  seed: number = GUARD_SHEET_SEED,
): GuardSheet {
  const existing = sheets.get(type);
  if (existing != null) return existing;

  const plan = guardSheetPlan(seedForType(type, seed));
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;

  const context = canvas.getContext('2d');
  if (context == null) {
    throw new Error(`sprite sheet for '${type}': the canvas gave no 2d context`);
  }
  replayPlan(context, plan);

  const texture = new CanvasTexture(canvas);
  // A sheet is an atlas: mipmaps and linear filtering bleed one cell into the
  // next, which shows up as a seam of the neighbouring bearing down the edge of
  // every sprite. Nearest and no mipmaps keep each cell to itself.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  const sheet: GuardSheet = { type, plan, canvas, texture };
  sheets.set(type, sheet);
  return sheet;
}

/** What has actually been built, for the diagnostics US4-S7 is read through. */
export function guardSheetStats(): SheetStats {
  return { types: sheets.size, canvases: sheets.size, textures: sheets.size };
}

/** Test seam only. Production code builds a sheet once and keeps it. */
export function resetGuardSheetsForTest(): void {
  for (const sheet of sheets.values()) sheet.texture.dispose();
  sheets.clear();
}
