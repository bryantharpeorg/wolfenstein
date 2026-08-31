// The replay: `sprite-shape.ts`'s draw program onto one real canvas, uploaded as
// one texture (FR-009, US4-S2, US4-S7). This file owns the two facts the plan
// cannot hold — that a canvas exists, and that there is *one* per guard type, so
// ten guards share one canvas, one texture and one upload.

import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { buildSheetPlan } from './sprite-shape';
import type { DrawOp, SheetPlan, SheetPlanOptions } from './sprite-shape';

/** The one guard type this milestone ships. A second would be a second entry in
 *  the cache below and no other change. */
export const GUARD_TYPE = 'guard';

export interface GuardSheet {
  readonly type: string;
  readonly plan: SheetPlan;
  readonly canvas: HTMLCanvasElement;
  readonly texture: Texture;
}

/** Replays one cell's program; ops are cell-local, so the origin is a
 *  translate. */
function drawOps(context: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
  for (const op of ops) {
    context.fillStyle = op.color;
    switch (op.op) {
      case 'rect':
        context.fillRect(op.x, op.y, op.w, op.h);
        break;
      case 'ellipse':
        context.beginPath();
        context.ellipse(op.x, op.y, op.rx, op.ry, 0, 0, Math.PI * 2);
        context.fill();
        break;
      case 'polygon': {
        const [first, ...rest] = op.points;
        if (first == null) break;
        context.beginPath();
        context.moveTo(first.x, first.y);
        for (const point of rest) context.lineTo(point.x, point.y);
        context.closePath();
        context.fill();
        break;
      }
    }
  }
}

/** Draws the whole plan onto a context. Cleared and never filled: the background
 *  stays transparent, which is what lets the billboard's alpha test cut the
 *  figure out of its cell instead of hanging a grey card in the level. */
export function drawSheet(context: CanvasRenderingContext2D, plan: SheetPlan): void {
  context.clearRect(0, 0, plan.width, plan.height);
  for (const cell of plan.cells) {
    context.save();
    context.translate(cell.x, cell.y);
    drawOps(context, cell.ops);
    context.restore();
  }
}

// One entry per guard type, for the life of the page (US4-S7).
const sheets = new Map<string, GuardSheet>();

function buildSheet(type: string, options: SheetPlanOptions): GuardSheet {
  const plan = buildSheetPlan(options);
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;

  const context = canvas.getContext('2d');
  if (context == null) throw new Error(`no 2D context for the ${type} sprite sheet`);
  drawSheet(context, plan);

  const texture = new CanvasTexture(canvas);
  // Nearest, no mipmaps: the figure stays crisp rather than blurring into the
  // wall behind it as the player backs away.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  return { type, plan, canvas, texture };
}

/** The sheet for a guard type, drawn on first ask and shared thereafter — so the
 *  count of canvases, and of textures, is the count of guard *types* whatever
 *  the guard count is (US4-S2, US4-S7, Edge Cases). */
export function guardSpriteSheet(type: string = GUARD_TYPE, options: SheetPlanOptions = {}): GuardSheet {
  const existing = sheets.get(type);
  if (existing != null) return existing;
  const sheet = buildSheet(type, options);
  sheets.set(type, sheet);
  return sheet;
}

/** How many sheets, and so textures, have been uploaded — published through the
 *  billboard system so US4-S7 is checkable from the smoke gate. */
export function guardSheetCount(): number {
  return sheets.size;
}
