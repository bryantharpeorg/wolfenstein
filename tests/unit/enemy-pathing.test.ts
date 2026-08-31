import { describe, it, expect } from 'vitest';
import { MAX_NODE_EXPANSIONS, findPath } from '../../src/enemy/pathing';
import { isUnreachable } from '../../src/enemy/step';
import type { Cell, PathResult } from '../../src/enemy/step';
import { GRID_SIZE, LEVEL_GRID } from '../../src/level';
import {
  NO_OPEN_TILES,
  draw,
  expectWalkablePath,
  freeCellCount,
  openTileSet,
  put,
  roomDraft,
  solidDraft,
} from './enemy-grid';
import { expectPure } from './enemy-pure';

// A* on hand-drawn 64x64 grids (FR-003, FR-004, US2-S1..S4, US2-S9). The paths
// asserted here are the ones a reader can trace with a finger; the cap cases are
// the ones that decide whether a guard can stall a frame.

const cell = (x: number, z: number): Cell => ({ x, z });

/** The `cells` of a result that must have been found, or a failing assertion. */
function found(result: PathResult): readonly Cell[] {
  if (isUnreachable(result)) throw new Error('expected a path, got unreachable');
  return result.cells;
}

/** A 64x64 grid of solid stone with a single one-wide corridor along z=1. */
const CORRIDOR = draw(
  (() => {
    const draft = solidDraft(GRID_SIZE, GRID_SIZE);
    for (let x = 1; x < GRID_SIZE - 1; x += 1) put(draft, x, 1, '0');
    return draft;
  })(),
);

/** A 64x64 room split at x=32 by a wall whose only gap is the door at (32, 10). */
const SPLIT_ROOM = draw(
  (() => {
    const draft = roomDraft(GRID_SIZE, GRID_SIZE);
    for (let z = 1; z < GRID_SIZE - 1; z += 1) put(draft, 32, z, '1');
    return put(draft, 32, 10, 'D');
  })(),
);

/** A 64x64 room with the goal sealed inside a closed ring of walls (US2-S2). */
const WALL_RING = draw(
  (() => {
    const draft = roomDraft(GRID_SIZE, GRID_SIZE);
    for (let z = 38; z <= 44; z += 1) {
      for (let x = 38; x <= 44; x += 1) {
        const onRing = z === 38 || z === 44 || x === 38 || x === 44;
        if (onRing) put(draft, x, z, '1');
      }
    }
    return draft;
  })(),
);

describe('findPath on a known layout (FR-003, US2-S1)', () => {
  it('returns the exact ordered corridor cells from start to goal', () => {
    const result = findPath(CORRIDOR, NO_OPEN_TILES, cell(1, 1), cell(6, 1));
    const cells = found(result);
    expect(cells).toEqual([
      cell(1, 1),
      cell(2, 1),
      cell(3, 1),
      cell(4, 1),
      cell(5, 1),
      cell(6, 1),
    ]);
    expectWalkablePath(CORRIDOR, NO_OPEN_TILES, cells, cell(1, 1), cell(6, 1));
  });

  it('returns an orthogonally adjacent wall-free path around an obstacle', () => {
    // A stub hanging off the north border from z=1 to z=12, so the only way past
    // it is round the south end at z=13 and the shortest route is not ambiguous.
    const draft = roomDraft(GRID_SIZE, GRID_SIZE);
    for (let z = 1; z <= 12; z += 1) put(draft, 8, z, '1');
    const grid = draw(draft);
    const from = cell(4, 8);
    const to = cell(12, 8);
    const cells = found(findPath(grid, NO_OPEN_TILES, from, to));
    expectWalkablePath(grid, NO_OPEN_TILES, cells, from, to);
    // 8 across, plus 5 down and 5 back up around the stub, plus the start cell.
    expect(cells.length).toBe(8 + 10 + 1);
  });

  it('paths across the real 64x64 level grid', () => {
    const from = cell(5, 5);
    const to = cell(18, 18);
    const cells = found(findPath(LEVEL_GRID, NO_OPEN_TILES, from, to));
    expectWalkablePath(LEVEL_GRID, NO_OPEN_TILES, cells, from, to);
    // An open room: the shortest route is Manhattan, plus the start cell.
    expect(cells.length).toBe(13 + 13 + 1);
  });

  it('reports a start that is already the goal as a one-cell path', () => {
    const cells = found(findPath(CORRIDOR, NO_OPEN_TILES, cell(4, 1), cell(4, 1)));
    expect(cells).toEqual([cell(4, 1)]);
  });
});

describe('findPath behind a closed wall ring (FR-003, US2-S2)', () => {
  const from = cell(2, 2);
  const to = cell(41, 41);

  it('returns the declared unreachable result, not null, [] or a partial path', () => {
    const result = findPath(WALL_RING, NO_OPEN_TILES, from, to);
    expect(result).not.toBeNull();
    expect(isUnreachable(result)).toBe(true);
    expect(result).toEqual({ unreachable: true, nodesExpanded: expect.any(Number) });
    expect('cells' in result).toBe(false);
  });

  it('reaches the same cell once one ring tile is opened', () => {
    const draft = roomDraft(GRID_SIZE, GRID_SIZE);
    for (let z = 38; z <= 44; z += 1) {
      for (let x = 38; x <= 44; x += 1) {
        if (z === 38 || z === 44 || x === 38 || x === 44) put(draft, x, z, '1');
      }
    }
    put(draft, 41, 38, '0');
    const grid = draw(draft);
    const cells = found(findPath(grid, NO_OPEN_TILES, from, to));
    expectWalkablePath(grid, NO_OPEN_TILES, cells, from, to);
  });

  it('reports a goal standing on a wall as unreachable', () => {
    const result = findPath(WALL_RING, NO_OPEN_TILES, from, cell(38, 38));
    expect(isUnreachable(result)).toBe(true);
  });
});

describe('findPath and door state (FR-003, US2-S3)', () => {
  const from = cell(10, 10);
  const to = cell(50, 10);

  it('returns unreachable while the only route stands on a closed door', () => {
    const result = findPath(SPLIT_ROOM, NO_OPEN_TILES, from, to);
    expect(isUnreachable(result)).toBe(true);
  });

  it('traverses that door tile once it is open', () => {
    const cells = found(findPath(SPLIT_ROOM, openTileSet('32,10'), from, to));
    expectWalkablePath(SPLIT_ROOM, openTileSet('32,10'), cells, from, to);
    expect(cells.some((step) => step.x === 32 && step.z === 10)).toBe(true);
  });

  it('opening a different tile leaves the route closed', () => {
    const result = findPath(SPLIT_ROOM, openTileSet('32,20'), from, to);
    expect(isUnreachable(result)).toBe(true);
  });
});

describe('findPath node-expansion cap (FR-004, US2-S4, SC-003)', () => {
  /** ~2000 open cells with the goal sealed off, so every one of them is expanded. */
  const PATHOLOGICAL = draw(
    (() => {
      const draft = solidDraft(GRID_SIZE, GRID_SIZE);
      for (let z = 1; z <= 50; z += 1) {
        for (let x = 1; x <= 50; x += 1) put(draft, x, z, '0');
      }
      // A comb of stubs, so the Manhattan heuristic misleads the search rather
      // than letting it fan out cleanly: this is the maximising part.
      for (let x = 3; x <= 47; x += 4) {
        for (let z = 1; z <= 48; z += 1) put(draft, x, z, '1');
      }
      // The goal: one open cell with four solid neighbours, in the sealed half.
      put(draft, 58, 58, '0');
      return draft;
    })(),
  );

  it('is built to maximise search: about 2000 reachable cells and no route', () => {
    expect(freeCellCount(PATHOLOGICAL)).toBeGreaterThan(1500);
    expect(freeCellCount(PATHOLOGICAL)).toBeLessThan(2500);
  });

  it('returns unreachable within the cap and reports an integer count', () => {
    const result = findPath(PATHOLOGICAL, NO_OPEN_TILES, cell(1, 1), cell(58, 58));
    expect(isUnreachable(result)).toBe(true);
    expect(Number.isInteger(result.nodesExpanded)).toBe(true);
    expect(result.nodesExpanded).toBeGreaterThan(0);
    expect(result.nodesExpanded).toBeLessThanOrEqual(MAX_NODE_EXPANSIONS);
  });

  it('every result of every shape reports nodesExpanded at or below the cap', () => {
    const results: PathResult[] = [
      findPath(CORRIDOR, NO_OPEN_TILES, cell(1, 1), cell(62, 1)),
      findPath(WALL_RING, NO_OPEN_TILES, cell(2, 2), cell(41, 41)),
      findPath(SPLIT_ROOM, openTileSet('32,10'), cell(10, 10), cell(50, 10)),
      findPath(LEVEL_GRID, NO_OPEN_TILES, cell(5, 5), cell(18, 40)),
    ];
    for (const result of results) {
      expect(Number.isInteger(result.nodesExpanded)).toBe(true);
      expect(result.nodesExpanded).toBeLessThanOrEqual(MAX_NODE_EXPANSIONS);
    }
  });

  it('stops at the cap instead of continuing to search a larger grid', () => {
    // 98x98 of open floor is far more than the cap: the search must give up.
    const draft = roomDraft(100, 100);
    for (let z = 90; z <= 96; z += 1) {
      for (let x = 90; x <= 96; x += 1) put(draft, x, z, '1');
    }
    put(draft, 93, 93, '0');
    const grid = draw(draft);
    const result = findPath(grid, NO_OPEN_TILES, cell(1, 1), cell(93, 93));
    expect(isUnreachable(result)).toBe(true);
    expect(result.nodesExpanded).toBe(MAX_NODE_EXPANSIONS);
  });

  it('declares the cap as one named constant', () => {
    expect(Number.isInteger(MAX_NODE_EXPANSIONS)).toBe(true);
    expect(MAX_NODE_EXPANSIONS).toBeGreaterThanOrEqual(GRID_SIZE * GRID_SIZE);
  });
});

describe('findPath is deterministic (FR-004, US2-S9, SC-003)', () => {
  it('returns identical paths for two identical calls', () => {
    const cases: Array<[string[], ReadonlySet<string>, Cell, Cell]> = [
      [LEVEL_GRID, NO_OPEN_TILES, cell(5, 5), cell(18, 18)],
      [LEVEL_GRID, NO_OPEN_TILES, cell(2, 2), cell(19, 19)],
      [SPLIT_ROOM, openTileSet('32,10'), cell(10, 10), cell(50, 10)],
      [CORRIDOR, NO_OPEN_TILES, cell(1, 1), cell(62, 1)],
    ];
    for (const [grid, doors, from, to] of cases) {
      const first = findPath(grid, doors, from, to);
      const second = findPath(grid, doors, from, to);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
  });

  it('is unaffected by an earlier search on the same grid', () => {
    const solo = findPath(LEVEL_GRID, NO_OPEN_TILES, cell(5, 5), cell(18, 18));
    findPath(LEVEL_GRID, NO_OPEN_TILES, cell(40, 40), cell(50, 50));
    findPath(LEVEL_GRID, NO_OPEN_TILES, cell(2, 2), cell(3, 9));
    const again = findPath(LEVEL_GRID, NO_OPEN_TILES, cell(5, 5), cell(18, 18));
    expect(JSON.stringify(again)).toBe(JSON.stringify(solo));
  });

  it('is DOM-free and three.js-free', () => {
    expectPure('pathing.ts');
  });
});
