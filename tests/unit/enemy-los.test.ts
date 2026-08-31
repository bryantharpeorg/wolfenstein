import { describe, it, expect } from 'vitest';
import { MAX_LOS_STEPS, hasLineOfSight } from '../../src/enemy/los';
import { LEVEL_GRID } from '../../src/level';
import { NO_OPEN_TILES, draw, openTileSet, put, roomDraft } from './enemy-grid';
import { enemySource, expectPure } from './enemy-pure';

// Sight, hand-computed (FR-005, US2-S5..S8). Every case here is small enough to
// draw on paper, which is the point: the raycast is asserted against arithmetic a
// reader can redo, never against whatever the implementation happened to return.

/** A 12x12 room with a solid border and nothing inside. */
const ROOM = draw(roomDraft(12, 12));

/** The same room with one wall pillar at (4, 3). */
const PILLAR = draw(put(roomDraft(12, 12), 4, 3, '1'));

/** The same room split by a wall at x=6 with a single door at (6, 5). */
const DOORWAY = draw(
  (() => {
    const draft = roomDraft(12, 12);
    for (let z = 1; z < 11; z += 1) put(draft, 6, z, '1');
    return put(draft, 6, 5, 'D');
  })(),
);

/**
 * The pinwheel of the Edge Cases list: (1,1) and (2,2) are floor and touch only
 * at the corner point (2,2); both cells orthogonally between them are walls.
 *
 *   z=0  1111
 *   z=1  1011   <- (2,1) wall
 *   z=2  1101   <- (1,2) wall
 *   z=3  1111
 */
const PINWHEEL = ['1111', '1011', '1101', '1111'];
/** The same corner with one orthogonal neighbour opened. */
const HALF_PINWHEEL = ['1111', '1001', '1101', '1111'];

const centre = (x: number, z: number) => ({ x: x + 0.5, z: z + 0.5 });

describe('hasLineOfSight across open cells (US2-S5)', () => {
  it('sees a cell in the same open room', () => {
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, centre(1, 1), centre(10, 10))).toBe(true);
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, centre(1, 5), centre(10, 5))).toBe(true);
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, centre(5, 1), centre(5, 10))).toBe(true);
  });

  it('sees itself, and sees the cell it already stands in', () => {
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, centre(4, 4), centre(4, 4))).toBe(true);
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, { x: 4.1, z: 4.9 }, { x: 4.8, z: 4.2 })).toBe(true);
  });

  it('is symmetric — sight is a property of the segment, not of who asks', () => {
    const a = centre(1, 1);
    const b = centre(9, 7);
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, a, b)).toBe(
      hasLineOfSight(ROOM, NO_OPEN_TILES, b, a),
    );
    expect(hasLineOfSight(PILLAR, NO_OPEN_TILES, centre(1, 3), centre(10, 3))).toBe(
      hasLineOfSight(PILLAR, NO_OPEN_TILES, centre(10, 3), centre(1, 3)),
    );
  });
});

describe('hasLineOfSight with one intervening wall (US2-S5)', () => {
  it('is blocked by the single pillar on the segment', () => {
    expect(hasLineOfSight(PILLAR, NO_OPEN_TILES, centre(1, 3), centre(10, 3))).toBe(false);
  });

  it('still sees along a row the pillar does not sit on', () => {
    expect(hasLineOfSight(PILLAR, NO_OPEN_TILES, centre(1, 4), centre(10, 4))).toBe(true);
  });

  it('is blocked by the level border, and by anything outside it', () => {
    expect(hasLineOfSight(ROOM, NO_OPEN_TILES, centre(1, 1), { x: 20.5, z: 1.5 })).toBe(false);
  });
});

describe('hasLineOfSight through a door (US2-S6)', () => {
  const a = centre(2, 5);
  const b = centre(9, 5);

  it('is blocked by a closed door on the segment', () => {
    expect(hasLineOfSight(DOORWAY, NO_OPEN_TILES, a, b)).toBe(false);
  });

  it('sees through that same door once it is open', () => {
    expect(hasLineOfSight(DOORWAY, openTileSet('6,5'), a, b)).toBe(true);
  });

  it('opening a different door does not open this one', () => {
    expect(hasLineOfSight(DOORWAY, openTileSet('6,7'), a, b)).toBe(false);
  });
});

describe('hasLineOfSight across a diagonal corner (US2-S7)', () => {
  it('refuses the corner when both orthogonal neighbours are walls', () => {
    expect(hasLineOfSight(PINWHEEL, NO_OPEN_TILES, centre(1, 1), centre(2, 2))).toBe(false);
    expect(hasLineOfSight(PINWHEEL, NO_OPEN_TILES, centre(2, 2), centre(1, 1))).toBe(false);
  });

  it('allows the corner when one orthogonal neighbour is open', () => {
    expect(hasLineOfSight(HALF_PINWHEEL, NO_OPEN_TILES, centre(1, 1), centre(2, 2))).toBe(true);
  });

  it('refuses a corner whose two orthogonal neighbours are closed doors', () => {
    const doors = ['1111', '10D1', '1D01', '1111'];
    expect(hasLineOfSight(doors, NO_OPEN_TILES, centre(1, 1), centre(2, 2))).toBe(false);
    expect(hasLineOfSight(doors, openTileSet('2,1'), centre(1, 1), centre(2, 2))).toBe(true);
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
    // ...and it does step: a bounded loop over integer cell coordinates.
    expect(/for \(let steps = 0; steps < MAX_LOS_STEPS/.test(body)).toBe(true);
  });

  it('declares its step cap and returns rather than running past it', () => {
    expect(Number.isInteger(MAX_LOS_STEPS)).toBe(true);
    expect(MAX_LOS_STEPS).toBeGreaterThan(0);
    // A corridor longer than the cap is wholly open, and is still refused: the
    // bound is what makes "no map can hang a frame" true rather than hoped for.
    const long = draw(roomDraft(MAX_LOS_STEPS + 80, 3));
    expect(hasLineOfSight(long, NO_OPEN_TILES, centre(1, 1), centre(60, 1))).toBe(true);
    expect(
      hasLineOfSight(long, NO_OPEN_TILES, centre(1, 1), centre(MAX_LOS_STEPS + 78, 1)),
    ).toBe(false);
  });

  it('runs against the real level grid with no DOM and no three.js', () => {
    expectPure('los.ts');
    expect(hasLineOfSight(LEVEL_GRID, NO_OPEN_TILES, centre(5, 5), centre(6, 5))).toBe(true);
    // The brick wall at x=21 divides the north-west room from its neighbour.
    expect(hasLineOfSight(LEVEL_GRID, NO_OPEN_TILES, centre(5, 5), centre(30, 5))).toBe(false);
  });
});
