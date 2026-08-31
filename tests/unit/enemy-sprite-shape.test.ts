// T029 (US4): the sheet plan is `8 * cell` by `frames * cell`, every angle-and-frame
// pair carries an ordered draw program including the death frames, the plan is a
// function of its seed, and no image file exists anywhere in the tree — all without a
// canvas (FR-009, US4-S2).

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
import { VIEW_ANGLE_COUNT as N } from '../../src/enemy/view-angle';
import { expectPure } from './enemy-pure';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const plan = guardSheetPlan();
const frontCell = (frame: string) => plan.cells.find((c) => c.frame === frame && c.angle === 0);

const extent = (op: DrawOp): number[] =>
  op.op === 'rect'
    ? [op.x, op.y, op.x + op.w, op.y + op.h]
    : op.op === 'ellipse'
      ? [op.x - op.rx, op.y - op.ry, op.x + op.rx, op.y + op.ry]
      : [...op.points];

const top = (op: DrawOp): number =>
  op.op === 'rect' ? op.y : op.op === 'ellipse' ? op.y - op.ry : Math.min(...op.points.filter((_, i) => i % 2 === 1));

describe('the declared frames', () => {
  it('imports neither three.js nor a DOM API', () => {
    expectPure('sprite-shape.ts');
  });

  it('holds the walk and death frames as distinct rows, death last, over a duration', () => {
    expect(DEATH_FRAMES.length).toBeGreaterThanOrEqual(2);
    expect(GUARD_FRAMES.slice(GUARD_FRAMES.length - DEATH_FRAMES.length)).toEqual([...DEATH_FRAMES]);
    expect(DEATH_DURATION_MS).toBeGreaterThan(0);
    for (const frame of [...WALK_FRAMES, ...DEATH_FRAMES]) expect(GUARD_FRAMES).toContain(frame);
    expect(new Set(GUARD_FRAMES).size).toBe(GUARD_FRAMES.length);
    GUARD_FRAMES.forEach((frame, index) => expect(frameIndexOf(frame)).toBe(index));
  });
});

// US4-S2: the sheet is `8 * cell` wide and `frames * cell` tall.
describe('the sheet dimensions', () => {
  it('is eight cells wide and one cell tall per declared frame', () => {
    expect(plan.cell).toBe(SPRITE_CELL_PX);
    expect(plan.columns).toBe(N);
    expect(plan.width).toBe(N * plan.cell);
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
    expect(plan.cells).toHaveLength(N * GUARD_FRAMES.length);
    plan.cells.forEach((cell, index) => {
      expect(cell.angle).toBe(index % N);
      expect(cell.frameIndex).toBe(Math.floor(index / N));
      expect(cell.frame).toBe(GUARD_FRAMES[cell.frameIndex]);
    });
    for (const frame of DEATH_FRAMES) expect(plan.cells.filter((c) => c.frame === frame)).toHaveLength(N);
  });

  it('emits a non-empty program per cell, coloured and inside its own cell', () => {
    for (const cell of plan.cells) {
      expect(cell.ops.length).toBeGreaterThan(0);
      for (const op of cell.ops) {
        expect(op.color).toMatch(/^#[0-9a-f]{6}$/);
        for (const v of extent(op)) expect(v >= 0 && v <= plan.cell, `${cell.frame}@${cell.angle}`).toBe(true);
      }
    }
  });

  it('draws a different figure per view angle and per death step, sinking to the floor', () => {
    const stand = plan.cells.filter((cell) => cell.frame === 'stand');
    expect(new Set(stand.map((cell) => JSON.stringify(cell.ops))).size).toBe(N);
    const front = DEATH_FRAMES.map((frame) => JSON.stringify(frontCell(frame)?.ops));
    expect(new Set(front).size).toBe(DEATH_FRAMES.length);
    const tops = DEATH_FRAMES.map((frame) => Math.min(...(frontCell(frame)?.ops ?? []).map(top)));
    for (let i = 1; i < tops.length; i += 1) expect(tops[i]!).toBeGreaterThanOrEqual(tops[i - 1]!);
    expect(tops[tops.length - 1]!).toBeGreaterThan(tops[0]!);
  });
});

describe('determinism', () => {
  it('is byte-identical for a given seed and differs for another', () => {
    expect(JSON.stringify(guardSheetPlan(1234))).toBe(JSON.stringify(guardSheetPlan(1234)));
    expect(JSON.stringify(guardSheetPlan())).toBe(JSON.stringify(guardSheetPlan(GUARD_SHEET_SEED)));
    expect(JSON.stringify(guardSheetPlan(1234))).not.toBe(JSON.stringify(guardSheetPlan(5678)));
  });

  it('keeps the dimensions fixed whatever the seed', () => {
    const other = guardSheetPlan(99);
    expect([other.width, other.height]).toEqual([plan.width, plan.height]);
    expect(other.cells).toHaveLength(plan.cells.length);
  });
});

// US4-S2's second half, and Constitution II's whole point: the guard's art is a
// program in the tree, and there is no image file anywhere it could have come from
// instead. Asserted here as well as in the smoke gate, because the story's
// Independent Test states it under `npm run test`.
describe('no image asset exists in the repository', () => {
  const IMAGES = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const SKIP = new Set(['node_modules', 'dist', '.git', '.cache']);

  function imagesUnder(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) found.push(...imagesUnder(join(dir, entry.name)));
      } else if (IMAGES.includes(extname(entry.name).toLowerCase())) {
        found.push(join(dir, entry.name));
      }
    }
    return found;
  }

  it('finds no .png, .jpg, .jpeg, .gif or .webp at any path', () => {
    expect(imagesUnder(fileURLToPath(new URL('../../', import.meta.url)))).toEqual([]);
  });
});
