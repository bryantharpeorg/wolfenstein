import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveMove } from '../../src/player/collide';
import { isCircleWalkable, isTileBlocking, BOUNDARY_EPSILON } from '../../src/player/tiles';
import { COLLIDER_RADIUS } from '../../src/player/params';

const R = COLLIDER_RADIUS;
// All doors/secrets closed: the default open-state for US2.
const OPEN: ReadonlySet<string> = new Set<string>();

// A grid from rows of single-character cells, row 0 = z 0 (north). Cells use the
// level alphabet: '0' empty floor, '1' wall.
function g(rows: string[]): string[] {
  return rows;
}

describe('resolveMove', () => {
  it('stops flush against a wall within 1e-6 (US2-S2)', () => {
    const grid = g(['111', '101', '111']);
    // Player at the centre of empty tile (1,1); wall directly north at (1,0).
    const result = resolveMove(grid, { x: 1.5, z: 1.5 }, { x: 0, z: -5 }, OPEN);
    // North face (top edge) stops flush at z = 1, the wall tile's south boundary.
    expect(result.position.z - R).toBeCloseTo(1.0, 6);
    expect(result.position.z).toBeCloseTo(1.3, 6);
    expect(result.blockedAxes.n).toBe(true);
    expect(result.blockedAxes.s).toBe(false);
    expect(result.stuck).toBe(false);
  });

  it('slides along the free axis in a corner (US2-S4)', () => {
    const grid = g(['111', '101', '000']);
    // Wall east at (2,1); south is free. A diagonal south-east move slides south.
    const result = resolveMove(grid, { x: 1.5, z: 1.5 }, { x: 0.5, z: 0.5 }, OPEN);
    expect(result.position.x).toBeCloseTo(2 - R, 6); // 1.7, blocked east
    expect(result.position.z).toBeCloseTo(2.0, 6); // full south movement
    expect(result.blockedAxes.e).toBe(true);
    expect(result.blockedAxes.s).toBe(false);
    expect(isCircleWalkable(grid, result.position.x, result.position.z, R, OPEN)).toBe(true);
  });

  it('comes to rest walkable in a full corner, not overlapping (US2-S4)', () => {
    const grid = g(['111', '101', '111']);
    // Walls east (2,1) and south (1,2). A diagonal south-east move stops at the corner.
    const result = resolveMove(grid, { x: 1.5, z: 1.5 }, { x: 0.5, z: 0.5 }, OPEN);
    expect(result.position.x).toBeCloseTo(2 - R, 6);
    expect(result.position.z).toBeCloseTo(2 - R, 6);
    expect(result.blockedAxes.e).toBe(true);
    expect(result.blockedAxes.s).toBe(true);
    expect(isCircleWalkable(grid, result.position.x, result.position.z, R, OPEN)).toBe(true);
  });

  it('reports per-axis blocked flags (US2-S8)', () => {
    const grid = g(['111', '101', '111']);
    const centre = { x: 1.5, z: 1.5 };

    const east = resolveMove(grid, centre, { x: 5, z: 0 }, OPEN);
    expect(east.blockedAxes).toEqual({ n: false, s: false, e: true, w: false });

    const west = resolveMove(grid, centre, { x: -5, z: 0 }, OPEN);
    expect(west.blockedAxes).toEqual({ n: false, s: false, e: false, w: true });

    const north = resolveMove(grid, centre, { x: 0, z: -5 }, OPEN);
    expect(north.blockedAxes).toEqual({ n: true, s: false, e: false, w: false });

    const south = resolveMove(grid, centre, { x: 0, z: 5 }, OPEN);
    expect(south.blockedAxes).toEqual({ n: false, s: true, e: false, w: false });
  });

  it('pushes a start inside solid out along the axis of least penetration (US2-S7)', () => {
    const grid = g(['10', '00']);
    // Player at (0.9, 0.5): AABB [0.6,1.2]x[0.2,0.8] overlaps solid (0,0) by 0.4 in x
    // and 0.6 in z, so the least-penetration axis is x, pushed east to x = 1.3.
    const result = resolveMove(grid, { x: 0.9, z: 0.5 }, { x: 0, z: 0 }, OPEN);
    expect(result.stuck).toBe(true);
    expect(result.position.x).toBeCloseTo(1.3, 6);
    expect(result.position.z).toBeCloseTo(0.5, 6);
    expect(isCircleWalkable(grid, result.position.x, result.position.z, R, OPEN)).toBe(true);
  });

  it('does not throw on a start inside solid (US2-S7)', () => {
    const grid = g(['1']);
    expect(() => resolveMove(grid, { x: 0.5, z: 0.5 }, { x: 0, z: 0 }, OPEN)).not.toThrow();
  });

  it('does not report a spurious block at a tile boundary (US2-S8)', () => {
    const grid = g(['01']); // (0,0) empty, (1,0) wall
    // Flush against the wall: a tiny push is not a block.
    const tiny = resolveMove(grid, { x: 0.7, z: 0.5 }, { x: 1e-9, z: 0 }, OPEN);
    expect(tiny.position.x).toBeCloseTo(0.7, 9);
    expect(tiny.blockedAxes.e).toBe(false);

    // A real push is a block.
    const real = resolveMove(grid, { x: 0.7, z: 0.5 }, { x: 0.1, z: 0 }, OPEN);
    expect(real.position.x).toBeCloseTo(0.7, 9);
    expect(real.blockedAxes.e).toBe(true);
  });

  it('is stable at a position holding 0.9999999 adjacent to a wall (US2-S8)', () => {
    const grid = g(['01']);
    // 0.9999999 is within epsilon of the boundary; the resolver depenetrates
    // deterministically rather than jittering or throwing.
    const a = resolveMove(grid, { x: 0.9999999, z: 0.5 }, { x: 0, z: 0 }, OPEN);
    const b = resolveMove(grid, { x: 0.9999999, z: 0.5 }, { x: 0, z: 0 }, OPEN);
    expect(a.position.x).toBeCloseTo(b.position.x, 12);
    expect(a.position.z).toBeCloseTo(b.position.z, 12);
    expect(isCircleWalkable(grid, a.position.x, a.position.z, R, OPEN)).toBe(true);
  });
});

describe('tiles', () => {
  it('treats walls, doors and secrets as blocking, floor and exit as open (FR-007)', () => {
    const grid = g(['01DES']);
    expect(isTileBlocking(grid, 0, 0, OPEN)).toBe(false); // '0'
    expect(isTileBlocking(grid, 1, 0, OPEN)).toBe(true); // '1'
    expect(isTileBlocking(grid, 2, 0, OPEN)).toBe(true); // 'D'
    expect(isTileBlocking(grid, 3, 0, OPEN)).toBe(false); // 'E'
    expect(isTileBlocking(grid, 4, 0, OPEN)).toBe(true); // 'S'
  });

  it('treats a door or secret marked open as walkable (FR-007)', () => {
    const grid = g(['0DS']);
    const open = new Set<string>(['1,0', '2,0']);
    expect(isTileBlocking(grid, 1, 0, open)).toBe(false); // door open
    expect(isTileBlocking(grid, 2, 0, open)).toBe(false); // secret open
    expect(isTileBlocking(grid, 1, 0, OPEN)).toBe(true); // door closed
  });

  it('treats out-of-bounds as blocking', () => {
    const grid = g(['0']);
    expect(isTileBlocking(grid, -1, 0, OPEN)).toBe(true);
    expect(isTileBlocking(grid, 0, -1, OPEN)).toBe(true);
    expect(isTileBlocking(grid, 1, 0, OPEN)).toBe(true);
  });

  it('declares a boundary epsilon used for flush comparisons', () => {
    expect(BOUNDARY_EPSILON).toBeGreaterThan(0);
    expect(BOUNDARY_EPSILON).toBeLessThanOrEqual(1e-6);
  });
});

describe('collision module purity (US2-S1)', () => {
  const THREE_IMPORT =
    /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
  const DOM_GLOBAL =
    /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

  const tilesSource = readFileSync(new URL('../../src/player/tiles.ts', import.meta.url), 'utf8');
  const collideSource = readFileSync(new URL('../../src/player/collide.ts', import.meta.url), 'utf8');
  const integrateSource = readFileSync(
    new URL('../../src/player/integrate.ts', import.meta.url),
    'utf8',
  );

  it('imports neither three nor a DOM API', () => {
    for (const source of [tilesSource, collideSource, integrateSource]) {
      expect(THREE_IMPORT.test(source)).toBe(false);
      expect(DOM_GLOBAL.test(source)).toBe(false);
    }
  });

  it('takes the grid as an argument rather than reading a global', () => {
    for (const source of [tilesSource, collideSource, integrateSource]) {
      expect(source).not.toMatch(/LEVEL_GRID/);
      expect(source).not.toMatch(/from\s+['"]\.\.\/level['"]/);
    }
  });

  it('imports the modules from a test file that defines no window', () => {
    expect(resolveMove).toBeTypeOf('function');
    expect(isCircleWalkable).toBeTypeOf('function');
    expect(isTileBlocking).toBeTypeOf('function');
  });
});
