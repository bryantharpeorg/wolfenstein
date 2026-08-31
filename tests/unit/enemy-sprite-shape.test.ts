// T029 (FR-009, US4-S2): the sprite sheet as a *plan* — dimensions and an
// ordered draw program — with no canvas anywhere near it.
//
// This is the half of the generator a unit test can hold: `sprite-shape.ts` is
// pure, so the declared geometry of the sheet (8 columns of view angles by
// `frames` rows, the last of them the death frames) and the determinism of the
// figure are asserted here, and `sprite-sheet.ts` is left as a replay loop the
// smoke gate exercises in a real browser. Constitution II is re-checked at the
// bottom: the sheet is drawn, never loaded.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { walkAndReport } from '../../tools/check-no-binaries';
import {
  DEATH_FRAME_COUNT,
  DEATH_FRAME_MS,
  DEATH_ANIMATION_MS,
  GUARD_SHEET_SEED,
  SPRITE_CELL_PIXELS,
  SPRITE_FRAME_COUNT,
  SPRITE_VIEW_ANGLES,
  WALK_FRAME_COUNT,
  WALK_FRAME_MS,
  buildSheetPlan,
  cellPlan,
  deathFrameIndex,
  walkFrameIndex,
} from '../../src/enemy/sprite-shape';
import type { DrawOp, SheetPlan } from '../../src/enemy/sprite-shape';
import { expectPure } from './enemy-pure';

/** The extent of one op in cell-local pixels, so "inside the cell" is checkable
 *  without knowing which shape it is. */
function extent(op: DrawOp): { x0: number; y0: number; x1: number; y1: number } {
  switch (op.op) {
    case 'rect':
      return { x0: op.x, y0: op.y, x1: op.x + op.w, y1: op.y + op.h };
    case 'ellipse':
      return { x0: op.x - op.rx, y0: op.y - op.ry, x1: op.x + op.rx, y1: op.y + op.ry };
    case 'polygon': {
      const xs = op.points.map((p) => p.x);
      const ys = op.points.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
  }
}

const plan: SheetPlan = buildSheetPlan();

describe('sprite sheet plan dimensions (US4-S2)', () => {
  it('declares eight view angles and a frame count that contains the death frames', () => {
    expect(SPRITE_VIEW_ANGLES).toBe(8);
    expect(DEATH_FRAME_COUNT).toBeGreaterThan(1);
    expect(SPRITE_FRAME_COUNT).toBe(WALK_FRAME_COUNT + DEATH_FRAME_COUNT);
    expect(DEATH_ANIMATION_MS).toBe(DEATH_FRAME_COUNT * DEATH_FRAME_MS);
  });

  it('is 8 * cell wide and frames * cell tall', () => {
    expect(plan.cell).toBe(SPRITE_CELL_PIXELS);
    expect(plan.angles).toBe(8);
    expect(plan.frames).toBe(SPRITE_FRAME_COUNT);
    expect(plan.width).toBe(8 * plan.cell);
    expect(plan.height).toBe(plan.frames * plan.cell);
  });

  it('honours a frame count and a cell size it is called with', () => {
    const small = buildSheetPlan({ frames: 6, cell: 32 });
    expect(small.frames).toBe(6);
    expect(small.width).toBe(8 * 32);
    expect(small.height).toBe(6 * 32);
    expect(small.walkFrames).toBe(6 - DEATH_FRAME_COUNT);
  });

  it('never plans fewer than one walk frame, whatever it is asked for', () => {
    const tiny = buildSheetPlan({ frames: 2 });
    expect(tiny.walkFrames).toBeGreaterThanOrEqual(1);
    expect(tiny.walkFrames + tiny.deathFrames).toBe(tiny.frames);
  });
});

describe('the draw program', () => {
  it('emits one non-empty cell for every angle-and-frame pair', () => {
    expect(plan.cells.length).toBe(plan.angles * plan.frames);
    for (let frame = 0; frame < plan.frames; frame += 1) {
      for (let angle = 0; angle < plan.angles; angle += 1) {
        const cell = cellPlan(plan, angle, frame);
        expect(cell.angle).toBe(angle);
        expect(cell.frame).toBe(frame);
        expect(cell.x).toBe(angle * plan.cell);
        expect(cell.y).toBe(frame * plan.cell);
        expect(cell.ops.length).toBeGreaterThan(0);
      }
    }
  });

  it('names the last rows as the death frames and the rest as walk frames', () => {
    for (const cell of plan.cells) {
      const expected = cell.frame < plan.walkFrames ? 'walk' : 'death';
      expect(cell.kind).toBe(expected);
    }
    expect(plan.cells.filter((c) => c.kind === 'death').length).toBe(plan.angles * DEATH_FRAME_COUNT);
  });

  it('draws every shape inside its own cell', () => {
    for (const cell of plan.cells) {
      for (const op of cell.ops) {
        const box = extent(op);
        expect(box.x0, `${op.op} at angle ${cell.angle} frame ${cell.frame}`).toBeGreaterThanOrEqual(0);
        expect(box.y0).toBeGreaterThanOrEqual(0);
        expect(box.x1).toBeLessThanOrEqual(plan.cell);
        expect(box.y1).toBeLessThanOrEqual(plan.cell);
      }
    }
  });

  it('gives every op an opaque CSS colour a canvas 2D context can take', () => {
    for (const cell of plan.cells) {
      for (const op of cell.ops) expect(op.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('draws a different figure for each of the eight view angles', () => {
    const rendered = new Set(
      Array.from({ length: plan.angles }, (_, angle) => JSON.stringify(cellPlan(plan, angle, 0).ops)),
    );
    expect(rendered.size).toBe(plan.angles);
  });

  it('moves between walk frames, so the guard is not a still image', () => {
    const frames = new Set(
      Array.from({ length: plan.walkFrames }, (_, frame) => JSON.stringify(cellPlan(plan, 0, frame).ops)),
    );
    expect(frames.size).toBe(plan.walkFrames);
  });

  it('collapses through the death frames, each one different from the last', () => {
    const deaths = new Set(
      Array.from({ length: plan.deathFrames }, (_, i) =>
        JSON.stringify(cellPlan(plan, 0, plan.walkFrames + i).ops),
      ),
    );
    expect(deaths.size).toBe(plan.deathFrames);
  });

  it('is deterministic for a given seed and varies with a different one', () => {
    expect(buildSheetPlan({ seed: 1234 })).toEqual(buildSheetPlan({ seed: 1234 }));
    expect(buildSheetPlan()).toEqual(buildSheetPlan({ seed: GUARD_SHEET_SEED }));
    expect(JSON.stringify(buildSheetPlan({ seed: 1234 }).cells)).not.toBe(
      JSON.stringify(buildSheetPlan({ seed: 4321 }).cells),
    );
  });
});

describe('frame selection over time', () => {
  it('advances the death frames over the declared duration and then holds (US4-S5)', () => {
    const first = plan.walkFrames;
    const last = plan.frames - 1;
    expect(deathFrameIndex(plan, 0)).toBe(first);
    expect(deathFrameIndex(plan, -5)).toBe(first);
    expect(deathFrameIndex(plan, DEATH_FRAME_MS * 0.5)).toBe(first);
    expect(deathFrameIndex(plan, DEATH_FRAME_MS * 1.5)).toBe(first + 1);
    expect(deathFrameIndex(plan, DEATH_ANIMATION_MS - 1)).toBe(last);
    // Held, not wrapped, for as long as the corpse lies there (US4-S6).
    expect(deathFrameIndex(plan, DEATH_ANIMATION_MS)).toBe(last);
    expect(deathFrameIndex(plan, DEATH_ANIMATION_MS * 100)).toBe(last);
  });

  it('never steps backwards as the death clock runs', () => {
    let previous = -1;
    for (let ms = 0; ms <= DEATH_ANIMATION_MS * 2; ms += 10) {
      const frame = deathFrameIndex(plan, ms);
      expect(frame).toBeGreaterThanOrEqual(previous);
      previous = frame;
    }
  });

  it('cycles the walk frames and never lands on a death row', () => {
    for (let ms = 0; ms < WALK_FRAME_MS * plan.walkFrames * 3; ms += 7) {
      const frame = walkFrameIndex(plan, ms);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(plan.walkFrames);
    }
    expect(walkFrameIndex(plan, 0)).toBe(0);
    expect(walkFrameIndex(plan, WALK_FRAME_MS * 1.5)).toBe(1 % plan.walkFrames);
    expect(walkFrameIndex(plan, WALK_FRAME_MS * plan.walkFrames)).toBe(0);
  });
});

describe('the sheet is drawn, not loaded (US4-S2, Constitution II)', () => {
  it('is pure: no DOM, no canvas and no three.js in the plan (FR-001)', () => {
    expectPure('sprite-shape.ts');
  });

  it('finds no image file at any path in the repository', () => {
    const root = resolve(__dirname, '../..');
    const findings = walkAndReport(root).filter((finding) =>
      /\.(png|jpe?g|gif|webp)$/i.test(finding),
    );
    expect(findings).toEqual([]);
  });
});
