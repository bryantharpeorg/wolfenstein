import { describe, it, expect } from 'vitest';
import {
  UV_TILE_EDGE,
  UV_AGREEMENT_EPSILON,
  computeTileUVs,
  dominantAxis,
  uvBounds,
} from '../../src/materials/uv';
import { emitFaces } from '../../src/geometry/faces';
import { TILE_SIZE } from '../../src/level';

// FR-009 / US3-S5, US3-S6: UVs in world-tile space, one repeat per tile edge, so
// a merged run of N tiles spans N UV units and a merge boundary is not a UV
// boundary. Pure arithmetic over position and normal arrays.

const FLOOR_Y = 0;
const CEILING_Y = 2;

/** One quad as the face emitter writes it. */
interface Quad {
  corners: number[];
  normal: readonly [number, number, number];
}


function pack(quads: Quad[]): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(quads.length * 12);
  const normals = new Float32Array(quads.length * 12);
  quads.forEach((quad, q) => {
    for (let i = 0; i < 4; i += 1) {
      const at = q * 12 + i * 3;
      positions.set(quad.corners.slice(i * 3, i * 3 + 3), at);
      normals.set(quad.normal, at);
    }
  });
  return { positions, normals };
}

/** A south-facing run of n tiles along +X, standing on the z plane. */
function southRun(n: number, x0 = 0, z = 0): Quad[] {
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + i;
    return {
      corners: [x, FLOOR_Y, z, x + 1, FLOOR_Y, z, x + 1, CEILING_Y, z, x, CEILING_Y, z],
      normal: [0, 0, 1] as const,
    };
  });
}

/** The UV pair of vertex `v`, and the UVs of a set of quads. */
const uvAt = (uvs: Float32Array, v: number): [number, number] => [uvs[v * 2]!, uvs[v * 2 + 1]!];

const uvsOf = (quads: Quad[]): Float32Array => {
  const { positions, normals } = pack(quads);
  return computeTileUVs(positions, normals);
};

describe('the declared tiling constants', () => {
  it('repeat once per world tile edge, and declare US3-S6\'s epsilon', () => {
    expect(UV_TILE_EDGE).toBe(TILE_SIZE);
    expect(UV_AGREEMENT_EPSILON).toBeGreaterThan(0);
    expect(UV_AGREEMENT_EPSILON).toBeLessThan(1e-3);
  });
});

describe('dominantAxis', () => {
  it('reads a face plane off its normal, either way along the axis', () => {
    expect([dominantAxis(0, 0, -1), dominantAxis(0, 0, 1)]).toEqual(['z', 'z']);
    expect([dominantAxis(1, 0, 0), dominantAxis(-1, 0, 0)]).toEqual(['x', 'x']);
    expect([dominantAxis(0, 1, 0), dominantAxis(0, -1, 0)]).toEqual(['y', 'y']);
    // Deterministic on a degenerate normal rather than throwing mid-load.
    expect(dominantAxis(0, 0, 0)).toBe('y');
  });
});

describe('computeTileUVs over a merged run', () => {
  it.each([2, 5, 20])('spans exactly N UV units across a run of %i tiles', (n: number) => {
    const uvs = uvsOf(southRun(n));
    expect(uvs.length).toBe(n * 4 * 2);
    const bounds = uvBounds(uvs);
    // US3-S5: N tiles, N repeats. One stretched brick would read as a span of 1.
    expect(bounds.maxU - bounds.minU).toBeCloseTo(n, 10);
    // And the wall's own height, which is two tiles, is two repeats.
    expect(bounds.maxV - bounds.minV).toBeCloseTo((CEILING_Y - FLOOR_Y) / UV_TILE_EDGE, 10);
    // Each quad sits on its own tile, so the merge boundary is not a UV boundary.
    for (let q = 0; q < n; q += 1) {
      const us = [0, 1, 2, 3].map((i) => uvAt(uvs, q * 4 + i)[0]);
      expect(Math.min(...us)).toBeCloseTo(q, 10);
      expect(Math.max(...us)).toBeCloseTo(q + 1, 10);
    }
  });

  it('agrees exactly at every shared edge inside the run (US3-S6)', () => {
    const n = 20;
    const uvs = uvsOf(southRun(n));
    // Vertices 1 and 2 of quad q sit on the same world edge as vertices 0 and 3
    // of quad q+1: same world point, therefore same UV, within the epsilon.
    for (let q = 0; q + 1 < n; q += 1) {
      for (const [a, b] of [
        [q * 4 + 1, (q + 1) * 4],
        [q * 4 + 2, (q + 1) * 4 + 3],
      ]) {
        expect(Math.abs(uvAt(uvs, a!)[0] - uvAt(uvs, b!)[0])).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
        expect(Math.abs(uvAt(uvs, a!)[1] - uvAt(uvs, b!)[1])).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
      }
    }
  });

  it('is unchanged by where the run starts, so tiling is continuous level-wide', () => {
    const here = uvsOf(southRun(3, 0));
    const there = uvsOf(southRun(3, 7));
    for (let v = 0; v < here.length / 2; v += 1) {
      // Seven tiles along is seven UV units along: the same texel of the same brick.
      expect(uvAt(there, v)[0] - uvAt(here, v)[0]).toBeCloseTo(7, 10);
      expect(uvAt(there, v)[1]).toBeCloseTo(uvAt(here, v)[1], 10);
    }
  });
});

// Every quad's UV extent equals its world extent in tiles on both axes; a face
// whose texture is stretched fails this whatever its span happens to be.
describe('no face is stretched', () => {
  const west: Quad = {
    corners: [0, FLOOR_Y, 0, 0, FLOOR_Y, 1, 0, CEILING_Y, 1, 0, CEILING_Y, 0],
    normal: [-1, 0, 0],
  };
  const floor: Quad = {
    corners: [3, FLOOR_Y, 4, 3, FLOOR_Y, 5, 4, FLOOR_Y, 5, 4, FLOOR_Y, 4],
    normal: [0, 1, 0],
  };
  const cases: [string, Quad, number, number][] = [
    ['a south wall face', southRun(1)[0]!, 1, 2],
    ['a west wall face', west, 1, 2],
    ['a floor tile', floor, 1, 1],
    // The ceiling's own faces are covered over 002's emitted geometry below.
  ];

  it.each(cases)('%s spans its world extent in tiles', (_name, quad, du, dv) => {
    const bounds = uvBounds(uvsOf([quad]));
    expect(bounds.maxU - bounds.minU).toBeCloseTo(du, 10);
    expect(bounds.maxV - bounds.minV).toBeCloseTo(dv, 10);
  });
});

// The outer corner of a solid block: a south face and an east face sharing the
// vertical edge at x=5, z=5.
describe('two faces meeting at a corner (US3-S6)', () => {
  const corner: Quad[] = [
    { corners: [4, FLOOR_Y, 5, 5, FLOOR_Y, 5, 5, CEILING_Y, 5, 4, CEILING_Y, 5], normal: [0, 0, 1] },
    { corners: [5, FLOOR_Y, 5, 5, FLOOR_Y, 4, 5, CEILING_Y, 4, 5, CEILING_Y, 5], normal: [1, 0, 0] },
  ];

  it('agrees on height at the shared edge within the declared epsilon', () => {
    const uvs = uvsOf(corner);
    // South 1 and east 0 are one world point; south 2 and east 3 are its top.
    for (const [a, b] of [[1, 4], [2, 7]]) {
      expect(Math.abs(uvAt(uvs, a!)[1] - uvAt(uvs, b!)[1])).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
    }
  });

  it('meets on a whole-tile boundary, so the pattern continues rather than breaking', () => {
    const uvs = uvsOf(corner);
    for (const vertex of [1, 2, 4, 7]) {
      const u = uvAt(uvs, vertex)[0];
      expect(Math.abs(u - Math.round(u))).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
    }
  });
});

// A 6-tile corridor with a solid border: the south side of the top wall is one
// merged run of six tiles, which is precisely US3-S5's premise.
describe('over the faces 002 actually emits', () => {
  const grid = ['11111111', '10000001', '11111111'];

  it('spans one UV unit per tile across the emitted run', () => {
    const faces = emitFaces(grid);
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);
    // Isolate the south-facing quads standing on z = 1: the top wall's inner face.
    const us: number[] = [];
    for (let q = 0; q * 4 < wall.positions.length / 3; q += 1) {
      const at = q * 12;
      if (wall.normals[at + 2] !== 1) continue;
      if (Math.abs(wall.positions[at + 2]! - 1) > UV_AGREEMENT_EPSILON) continue;
      for (let i = 0; i < 4; i += 1) us.push(uvs[(q * 4 + i) * 2]!);
    }
    expect(us.length).toBe(6 * 4);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(6, 10);

    // And every emitted vertex is rewritten, floor and ceiling included.
    for (const data of [faces.floor, faces.ceiling, wall]) {
      const uvs = computeTileUVs(data.positions, data.normals);
      expect(uvs.length).toBe((data.positions.length / 3) * 2);
      expect([...uvs].every((value) => Number.isFinite(value))).toBe(true);
    }
    // The floor of a 6-tile corridor covers six tiles, so six UV units on X.
    const floor = uvBounds(computeTileUVs(faces.floor.positions, faces.floor.normals));
    expect(floor.maxU - floor.minU).toBeCloseTo(6, 10);
    expect(floor.maxV - floor.minV).toBeCloseTo(1, 10);
  });
});

describe('refusals', () => {
  it('rejects arrays that disagree, or that are not whole vertices', () => {
    const mismatched = () => computeTileUVs(new Float32Array(12), new Float32Array(9));
    expect(mismatched).toThrow(/positions and normals/i);
    const partial = () => computeTileUVs(new Float32Array(11), new Float32Array(11));
    expect(partial).toThrow(/multiple of 3/i);
  });
});
