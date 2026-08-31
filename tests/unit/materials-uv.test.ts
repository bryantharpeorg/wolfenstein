import { describe, it, expect } from 'vitest';
import { emitFaces } from '../../src/geometry/faces';
import { TILE_SIZE, CEILING_Y, FLOOR_Y } from '../../src/level';
import {
  UV_AGREEMENT_EPSILON as EPSILON,
  UV_REPEATS_PER_TILE,
  UV_TILE_EDGE,
  computeTileUVs,
  uvSpan,
  uvsAgree,
} from '../../src/materials/uv';

// FR-009 / US3-S5 / US3-S6: one repeat per tile edge, so a merged run of N tiles
// spans N UV units, a merge boundary is not a UV boundary, and two faces at a
// shared edge sample the same texel there.

/** Quads as [corners, normal], flattened into the parallel arrays UVs read. */
function build(quads: ReadonlyArray<readonly [readonly number[], readonly number[]]>) {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const [corners, normal] of quads) {
    positions.push(...corners);
    for (let i = 0; i < 4; i += 1) normals.push(...normal);
  }
  return computeTileUVs(new Float32Array(positions), new Float32Array(normals));
}

/** A -Z-facing wall quad over tile `x` at plane `z`: right, left, then tops. */
const north = (x: number, z: number) =>
  [[x + 1, FLOOR_Y, z, x, FLOOR_Y, z, x, CEILING_Y, z, x + 1, CEILING_Y, z], [0, 0, -1]] as const;

/** A -X-facing wall quad over tile `z` at plane `x`. */
const west = (x: number, z: number) =>
  [[x, FLOOR_Y, z, x, FLOOR_Y, z + 1, x, CEILING_Y, z + 1, x, CEILING_Y, z], [-1, 0, 0]] as const;

const uvAt = (uvs: Float32Array, v: number): [number, number] => [uvs[v * 2]!, uvs[v * 2 + 1]!];

describe('world-tile UVs', () => {
  const N = 20;
  const run = build(Array.from({ length: N }, (_, i) => north(i, 0)));

  it('declares one repeat per world tile edge and a float-slack epsilon', () => {
    expect(UV_TILE_EDGE).toBe(TILE_SIZE);
    expect(UV_REPEATS_PER_TILE).toBe(1);
    expect(EPSILON).toBeGreaterThan(0);
    expect(EPSILON).toBeLessThan(1e-2);
  });

  it('spans exactly N units across a merged run of N tiles (US3-S5)', () => {
    expect(uvSpan(run).u).toBeCloseTo(N, 6);
    expect(uvSpan(run).v).toBeCloseTo((CEILING_Y - FLOOR_Y) / UV_TILE_EDGE, 6);
  });

  it('gives every tile of the run exactly one repeat — nothing stretched', () => {
    for (let tile = 0; tile < N; tile += 1) {
      const [uLeft] = uvAt(run, tile * 4 + 1);
      const [uRight] = uvAt(run, tile * 4);
      expect(Math.abs(uRight - uLeft)).toBeCloseTo(UV_REPEATS_PER_TILE, 6);
    }
  });

  it('does not reset at a merge boundary (US3-S6)', () => {
    for (let tile = 1; tile < N; tile += 1) {
      // One world line: the previous tile's right edge is this tile's left edge.
      const previous = uvAt(run, (tile - 1) * 4)[0];
      const current = uvAt(run, tile * 4 + 1)[0];
      expect(uvsAgree(previous, current)).toBe(true);
      expect(Math.abs(previous - current)).toBeLessThanOrEqual(EPSILON);
    }
  });

  it('agrees within the epsilon where perpendicular faces meet (US3-S6)', () => {
    // Both faces of the tile at (21, 10) meet along the line x = 21, z = 10.
    const corner = build([north(21, 10), west(21, 10)]);
    expect(uvsAgree(uvAt(corner, 1)[0], uvAt(corner, 4)[0])).toBe(true);
    expect(Math.abs(uvAt(corner, 1)[1] - uvAt(corner, 4)[1])).toBeLessThanOrEqual(EPSILON);
    expect(uvsAgree(3, 3.5)).toBe(false);
  });

  it('takes U from world X and V from world Z on a horizontal face', () => {
    const up = [0, 1, 0] as const;
    const floor = build([[[7, FLOOR_Y, 9, 7, FLOOR_Y, 10, 8, FLOOR_Y, 10, 8, FLOOR_Y, 9], up]]);
    expect(uvAt(floor, 0)).toEqual([7, 9]);
    expect(uvAt(floor, 2)).toEqual([8, 10]);
  });

  it('refuses a mismatched pair', () => {
    expect(() => computeTileUVs(new Float32Array(6), new Float32Array(3))).toThrow();
  });
});

describe('the geometry 002 actually emits', () => {
  // A solid run of type '2' around open floor: 002 merges its interior faces,
  // and the floor below them, into one geometry each.
  const faces = emitFaces(['2'.repeat(22), `2${'0'.repeat(20)}2`, '2'.repeat(22)]);

  it('spans one UV unit per tile across the merged wall group (US3-S5)', () => {
    const wall = faces.walls['2']!;
    expect(uvSpan(computeTileUVs(wall.positions, wall.normals)).u).toBeGreaterThanOrEqual(20);
  });

  it('gives the merged floor a span equal to its extent in tiles (US3-S4)', () => {
    const span = uvSpan(computeTileUVs(faces.floor.positions, faces.floor.normals));
    expect(span.u).toBeCloseTo(20, 6);
    expect(span.v).toBeCloseTo(1, 6);
  });
});
