// T029 (US4): the sheet plan. Dimensions are `8 * cell` by `frames * cell`, every
// angle-and-frame pair carries an ordered draw program including the death
// frames, and the whole plan is a function of its seed. DOM-free and
// three.js-free, so the plan is provable without a canvas (FR-009, US4-S2).

import { describe, it, expect } from 'vitest';
import {
  DEATH_DURATION_MS,
  DEATH_FRAMES,
  GUARD_FRAMES,
  GUARD_SHEET_SEED,
  SPRITE_CELL_PX,
  WALK_FRAMES,
  cellRect,
  frameIndexOf,
  guardSheetPlan,
  type DrawOp,
} from '../../src/enemy/sprite-shape';
import { VIEW_ANGLE_COUNT } from '../../src/enemy/view-angle';
import { expectPure } from './enemy-pure';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const plan = guardSheetPlan();

describe('sprite-shape purity', () => {
  it('imports neither three.js nor a DOM API', () => {
    expectPure('sprite-shape.ts');
  });
});

describe('the declared frames', () => {
  it('declares at least one death frame and holds them at the end of the sheet', () => {
    expect(DEATH_FRAMES.length).toBeGreaterThanOrEqual(2);
    const tail = GUARD_FRAMES.slice(GUARD_FRAMES.length - DEATH_FRAMES.length);
    expect(tail).toEqual([...DEATH_FRAMES]);
  });

  it('declares the walk and death frames as distinct members of the sheet', () => {
    for (const frame of [...WALK_FRAMES, ...DEATH_FRAMES]) {
      expect(GUARD_FRAMES).toContain(frame);
    }
    expect(new Set(GUARD_FRAMES).size).toBe(GUARD_FRAMES.length);
  });

  it('declares a positive death duration for the animation to run over', () => {
    expect(DEATH_DURATION_MS).toBeGreaterThan(0);
  });

  it('numbers each frame by its row on the sheet', () => {
    GUARD_FRAMES.forEach((frame, index) => {
      expect(frameIndexOf(frame)).toBe(index);
    });
  });
});

// US4-S2: the sheet is `8 * cell` wide and `frames * cell` tall.
describe('the sheet dimensions', () => {
  it('is eight cells wide, one column per view angle', () => {
    expect(plan.columns).toBe(VIEW_ANGLE_COUNT);
    expect(plan.width).toBe(VIEW_ANGLE_COUNT * plan.cell);
    expect(plan.cell).toBe(SPRITE_CELL_PX);
  });

  it('is one cell tall per declared frame', () => {
    expect(plan.rows).toBe(GUARD_FRAMES.length);
    expect(plan.height).toBe(GUARD_FRAMES.length * plan.cell);
    expect(plan.frames).toEqual([...GUARD_FRAMES]);
  });

  it('places every cell inside the sheet on its own grid position', () => {
    for (const cell of plan.cells) {
      const rect = cellRect(cell.angle, cell.frameIndex);
      expect({ x: cell.x, y: cell.y }).toEqual({ x: rect.x, y: rect.y });
      expect(rect.x + rect.width).toBeLessThanOrEqual(plan.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(plan.height);
    }
  });
});

describe('the draw program', () => {
  it('emits one cell for every angle-and-frame pair, in row-major order', () => {
    expect(plan.cells).toHaveLength(VIEW_ANGLE_COUNT * GUARD_FRAMES.length);
    plan.cells.forEach((cell, index) => {
      expect(cell.angle).toBe(index % VIEW_ANGLE_COUNT);
      expect(cell.frameIndex).toBe(Math.floor(index / VIEW_ANGLE_COUNT));
      expect(cell.frame).toBe(GUARD_FRAMES[cell.frameIndex]);
    });
  });

  it('emits a non-empty ordered program for every cell, death frames included', () => {
    for (const cell of plan.cells) {
      expect(cell.ops.length).toBeGreaterThan(0);
    }
    for (const frame of DEATH_FRAMES) {
      const cells = plan.cells.filter((cell) => cell.frame === frame);
      expect(cells).toHaveLength(VIEW_ANGLE_COUNT);
      for (const cell of cells) expect(cell.ops.length).toBeGreaterThan(0);
    }
  });

  it('draws every operation inside its own cell, so no figure bleeds into its neighbour', () => {
    const withinCell = (value: number): boolean => value >= 0 && value <= plan.cell;
    for (const cell of plan.cells) {
      for (const op of cell.ops) {
        for (const value of opExtent(op)) {
          expect(withinCell(value), `${cell.frame}@${cell.angle}: ${JSON.stringify(op)}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('names a colour on every operation', () => {
    for (const cell of plan.cells) {
      for (const op of cell.ops) {
        expect(op.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('draws a different figure for each view angle, so the sheet is not eight copies', () => {
    const stand = plan.cells.filter((cell) => cell.frame === 'stand');
    const rendered = stand.map((cell) => JSON.stringify(cell.ops));
    expect(new Set(rendered).size).toBe(VIEW_ANGLE_COUNT);
  });

  it('draws a different figure at each step of the death animation', () => {
    const front = DEATH_FRAMES.map((frame) =>
      JSON.stringify(plan.cells.find((cell) => cell.frame === frame && cell.angle === 0)?.ops),
    );
    expect(new Set(front).size).toBe(DEATH_FRAMES.length);
  });

  it('sinks the figure toward the floor as the death animation runs', () => {
    const tops = DEATH_FRAMES.map((frame) => {
      const cell = plan.cells.find((c) => c.frame === frame && c.angle === 0);
      return Math.min(...(cell?.ops ?? []).map((op) => opTop(op)));
    });
    for (let i = 1; i < tops.length; i += 1) {
      expect(tops[i]!).toBeGreaterThanOrEqual(tops[i - 1]!);
    }
    expect(tops[tops.length - 1]!).toBeGreaterThan(tops[0]!);
  });
});

// US4-S2's second half, and Constitution II's whole point: the guard's art is a
// program in the tree, and there is no image file anywhere for it to have come
// from instead. Checked here rather than only in the smoke gate, because the
// story's Independent Test states it under `npm run test`.
describe('no image asset exists in the repository', () => {
  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const SKIP = new Set(['node_modules', 'dist', '.git', '.cache']);
  const root = fileURLToPath(new URL('../../', import.meta.url));

  function imagesUnder(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        found.push(...imagesUnder(join(dir, entry.name)));
      } else if (IMAGE_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
        found.push(join(dir, entry.name));
      }
    }
    return found;
  }

  it('finds no .png, .jpg, .jpeg, .gif or .webp at any path', () => {
    expect(imagesUnder(root)).toEqual([]);
  });
});

describe('determinism', () => {
  it('is byte-identical for a given seed', () => {
    expect(JSON.stringify(guardSheetPlan(1234))).toBe(JSON.stringify(guardSheetPlan(1234)));
    expect(JSON.stringify(guardSheetPlan())).toBe(JSON.stringify(guardSheetPlan(GUARD_SHEET_SEED)));
  });

  it('differs for a different seed, so the seed is load-bearing', () => {
    expect(JSON.stringify(guardSheetPlan(1234))).not.toBe(JSON.stringify(guardSheetPlan(5678)));
  });

  it('keeps the dimensions fixed whatever the seed', () => {
    const other = guardSheetPlan(99);
    expect(other.width).toBe(plan.width);
    expect(other.height).toBe(plan.height);
    expect(other.cells).toHaveLength(plan.cells.length);
  });
});

/** The topmost y an operation touches — the highest point of the figure. */
function opTop(op: DrawOp): number {
  if (op.op === 'rect') return op.y;
  if (op.op === 'ellipse') return op.y - op.ry;
  return Math.min(...op.points.filter((_, index) => index % 2 === 1));
}

/** Every coordinate an operation touches, for the containment assertions. */
function opExtent(op: DrawOp): number[] {
  if (op.op === 'rect') return [op.x, op.y, op.x + op.w, op.y + op.h];
  if (op.op === 'ellipse') return [op.x - op.rx, op.y - op.ry, op.x + op.rx, op.y + op.ry];
  return [...op.points];
}
