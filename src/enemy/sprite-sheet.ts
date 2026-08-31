// The replay half: `./sprite-shape.ts`'s program onto a real canvas, once per guard
// *type* (FR-009, US4-S2, US4-S7). One canvas and one texture per type, memoized, so
// ten guards cost one sheet and one upload — a per-instance canvas is the failure this
// module is shaped to make impossible. Drawn at load time, never decoded (Const. II).

import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import { GUARD_SHEET_SEED, guardSheetPlan, type DrawOp, type SheetPlan } from './sprite-shape';

export interface GuardSheet {
  readonly type: string;
  readonly plan: SheetPlan;
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
}

/** US4-S7 is stated over these numbers, so the renderer publishes them. */
export interface SheetStats {
  readonly types: number;
  readonly canvases: number;
  readonly textures: number;
}

const sheets = new Map<string, GuardSheet>();

function seedForType(type: string, seed: number): number {
  let hash = seed | 0;
  for (let i = 0; i < type.length; i += 1) hash = (Math.imul(hash, 31) + type.charCodeAt(i)) | 0;
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
      for (let i = 2; i + 1 < op.points.length; i += 2) context.lineTo(op.points[i]!, op.points[i + 1]!);
      context.closePath();
      context.fill();
      return;
    }
  }
}

export function replayPlan(context: CanvasRenderingContext2D, plan: SheetPlan): void {
  context.clearRect(0, 0, plan.width, plan.height);
  for (const cell of plan.cells) {
    context.save();
    context.translate(cell.x, cell.y);
    for (const op of cell.ops) applyOp(context, op);
    context.restore();
  }
}

/** Built once per type: a second call returns the same canvas and texture, and that
 *  identity *is* US4-S7's "exactly one texture per guard type". */
export function buildGuardSheet(type = 'guard', seed: number = GUARD_SHEET_SEED): GuardSheet {
  const existing = sheets.get(type);
  if (existing != null) return existing;

  const plan = guardSheetPlan(seedForType(type, seed));
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;

  const context = canvas.getContext('2d');
  if (context == null) throw new Error(`sprite sheet for '${type}': the canvas gave no 2d context`);
  replayPlan(context, plan);

  // A sheet is an atlas: mipmaps and linear filtering bleed one cell into the
  // next, showing as a seam of the neighbouring bearing down every sprite's edge.
  const texture = new CanvasTexture(canvas);
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
