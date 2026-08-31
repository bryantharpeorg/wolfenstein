// Sight, hand-computed (FR-005, US2-S5..S8). Every case is small enough to draw
// on paper, which is the point: the raycast is asserted against arithmetic a
// reader can redo, never against whatever the implementation happened to return.

import { describe, it, expect } from 'vitest';
import { MAX_LOS_STEPS, hasLineOfSight } from '../../src/enemy/los';
import { LEVEL_GRID } from '../../src/level';
import { NO_OPEN_TILES, draw, openTileSet, put, roomDraft } from './enemy-grid';
import { enemySource, expectPure } from './enemy-pure';

/** A 12x12 room with a solid border, and the same room with a pillar at (4, 3). */
const ROOM = draw(roomDraft(12, 12));
const PILLAR = draw(put(roomDraft(12, 12), 4, 3, '1'));

/** The same room split by a wall at x=6 whose only gap is the door at (6, 5). */
const DOORWAY = draw(
  (() => {
    const draft = roomDraft(12, 12);
    for (let z = 1; z < 11; z += 1) put(draft, 6, z, '1');
    return put(draft, 6, 5, 'D');
  })(),
);

/**
 * The pinwheel of the Edge Cases list: (1,1) and (2,2) are floor and touch only
 * at the corner point; both cells orthogonally between them are walls. Then the
 * same corner with one neighbour opened, and with two closed doors instead.
 */
const PINWHEEL = ['1111', '1011', '1101', '1111'];
const HALF_PINWHEEL = ['1111', '1001', '1101', '1111'];
const DOOR_CORNER = ['1111', '10D1', '1D01', '1111'];

const centre = (x: number, z: number) => ({ x: x + 0.5, z: z + 0.5 });

/** grid, open tiles, from, to, visible — one row per hand-computed case. */
const CASES: Array<[string, string[], ReadonlySet<string>, [number, number], [number, number], boolean]> = [
  ['across an open room (US2-S5)', ROOM, NO_OPEN_TILES, [1, 1], [10, 10], true],
  ['along a row', ROOM, NO_OPEN_TILES, [1, 5], [10, 5], true],
  ['along a column', ROOM, NO_OPEN_TILES, [5, 1], [5, 10], true],
  ['at itself', ROOM, NO_OPEN_TILES, [4, 4], [4, 4], true],
  ['blocked by one pillar on the segment (US2-S5)', PILLAR, NO_OPEN_TILES, [1, 3], [10, 3], false],
  ['and symmetric in the same case', PILLAR, NO_OPEN_TILES, [10, 3], [1, 3], false],
  ['clear along a row the pillar misses', PILLAR, NO_OPEN_TILES, [1, 4], [10, 4], true],
  ['blocked by a closed door (US2-S6)', DOORWAY, NO_OPEN_TILES, [2, 5], [9, 5], false],
  ['open once that door is (US2-S6)', DOORWAY, openTileSet('6,5'), [2, 5], [9, 5], true],
  ['still shut when another door opens', DOORWAY, openTileSet('6,7'), [2, 5], [9, 5], false],
  ['refused at a two-wall corner (US2-S7)', PINWHEEL, NO_OPEN_TILES, [1, 1], [2, 2], false],
  ['refused from the other side too', PINWHEEL, NO_OPEN_TILES, [2, 2], [1, 1], false],
  ['allowed when one flank is open (US2-S7)', HALF_PINWHEEL, NO_OPEN_TILES, [1, 1], [2, 2], true],
  ['refused at a corner of two closed doors', DOOR_CORNER, NO_OPEN_TILES, [1, 1], [2, 2], false],
  ['allowed once one of those doors opens', DOOR_CORNER, openTileSet('2,1'), [1, 1], [2, 2], true],
  ['clear between neighbours on the real level', LEVEL_GRID, NO_OPEN_TILES, [5, 5], [6, 5], true],
  ['blocked by the real level’s dividing wall', LEVEL_GRID, NO_OPEN_TILES, [5, 5], [30, 5], false],
];

describe('hasLineOfSight', () => {
  it.each(CASES)('sees %s', (_name, grid, doors, from, to, visible) => {
    expect(hasLineOfSight(grid, doors, centre(...from), centre(...to))).toBe(visible);
  });

  it('sees within one cell, and is blocked by anything outside the border', () => {
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, { x: 4.1, z: 4.9 }, { x: 4.8, z: 4.2 })).toBe(true);
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, centre(1, 1), { x: 20.5, z: 1.5 })).toBe(false);
  });
});

describe('hasLineOfSight is bounded and pure (FR-001, FR-005, US2-S8)', () => {
  it('steps cell by cell and allocates no array per call', () => {
    const source = enemySource('los.ts');
    // The body of the raycast, i.e. everything after the last import line.
    const body = source.slice(source.lastIndexOf('\nimport '));
    // An array *literal*: `[` that is not the `[]` of a `string[]` type suffix.
    expect(/(^|[^A-Za-z0-9_\]])\[\s*\]/.test(body), 'los.ts allocates an array').toBe(false);
    expect(/\.push\(|\.concat\(|\.map\(|\.slice\(|\.filter\(/.test(body)).toBe(false);
    expect(/\bnew\s+[A-Z]/.test(body), 'los.ts constructs an object per call').toBe(false);
    expect(/\bArray\b/.test(body), 'los.ts names Array').toBe(false);
    expect(/for \(let steps = 0; steps < MAX_LOS_STEPS/.test(body)).toBe(true);
  });

  it('declares its step cap and returns rather than running past it', () => {
    expect(Number.isInteger(MAX_LOS_STEPS)).toBe(true);
    // A corridor longer than the cap is wholly open, and is still refused: the
    // bound is what makes "no map can hang a frame" true rather than hoped for.
    const long = draw(roomDraft(MAX_LOS_STEPS + 80, 3));
    expect(hasLineOfSight(long, NO_OPEN_TILES, centre(1, 1), centre(60, 1))).toBe(true);
    expect(hasLineOfSight(long, NO_OPEN_TILES, centre(1, 1), centre(MAX_LOS_STEPS + 78, 1))).toBe(false);
  });

  it('is DOM-free and three.js-free', () => {
    expectPure('los.ts');
  });
});
