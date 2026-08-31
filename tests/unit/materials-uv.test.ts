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

// FR-009 / US3-S5, US3-S6: UVs are computed in world-tile space, one repeat per
// tile edge, so a merged run of N tiles spans N UV units and a merge boundary is
// not a UV boundary. Everything here is pure arithmetic over position and normal
// arrays — no three.js, no page.

const FLOOR_Y = 0;
const CEILING_Y = 2;

/** One quad as the face emitter writes it: 4 vertices, 12 position numbers. */
type Quad = { corners: number[]; normal: readonly [number, number, number] };

function pack(quads: Quad[]): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(quads.length * 12);
  const normals = new Float32Array(quads.length * 12);
  quads.forEach((quad, q) => {
    for (let i = 0; i < 4; i += 1) {
      const at = q * 12 + i * 3;
      positions[at] = quad.corners[i * 3]!;
      positions[at + 1] = quad.corners[i * 3 + 1]!;
      positions[at + 2] = quad.corners[i * 3 + 2]!;
      normals[at] = quad.normal[0];
      normals[at + 1] = quad.normal[1];
      normals[at + 2] = quad.normal[2];
    }
  });
  return { positions, normals };
}

/** A south-facing wall run of N tiles along +X, standing on the z plane. */
function southRun(n: number, x0 = 0, z = 0): Quad[] {
  const quads: Quad[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = x0 + i;
    quads.push({
      corners: [x, FLOOR_Y, z, x + 1, FLOOR_Y, z, x + 1, CEILING_Y, z, x, CEILING_Y, z],
      normal: [0, 0, 1],
    });
  }
  return quads;
}

/** The UV pair of vertex `v`. */
function uvAt(uvs: Float32Array, v: number): [number, number] {
  return [uvs[v * 2]!, uvs[v * 2 + 1]!];
}

describe('the declared tiling constants', () => {
  it('repeats once per world tile edge', () => {
    expect(UV_TILE_EDGE).toBe(TILE_SIZE);
  });

  it('declares the agreement epsilon US3-S6 is measured against', () => {
    expect(UV_AGREEMENT_EPSILON).toBeGreaterThan(0);
    expect(UV_AGREEMENT_EPSILON).toBeLessThan(1e-3);
  });
});

describe('dominantAxis', () => {
  it('reads a face plane off its normal', () => {
    expect(dominantAxis(0, 0, -1)).toBe('z');
    expect(dominantAxis(0, 0, 1)).toBe('z');
    expect(dominantAxis(1, 0, 0)).toBe('x');
    expect(dominantAxis(-1, 0, 0)).toBe('x');
    expect(dominantAxis(0, 1, 0)).toBe('y');
    expect(dominantAxis(0, -1, 0)).toBe('y');
  });

  it('is deterministic on a degenerate normal rather than throwing mid-load', () => {
    expect(dominantAxis(0, 0, 0)).toBe('y');
  });
});

describe('computeTileUVs over a merged run', () => {
  it.each([2, 5, 20])('spans exactly N UV units across a run of N tiles', (n: number) => {
    const { positions, normals } = pack(southRun(n));
    const uvs = computeTileUVs(positions, normals);

    expect(uvs.length).toBe((positions.length / 3) * 2);
    const bounds = uvBounds(uvs);
    // US3-S5: N tiles, N repeats. One stretched brick would read as a span of 1.
    expect(bounds.maxU - bounds.minU).toBeCloseTo(n, 10);
    // And the wall's own height, which is two tiles, is two repeats.
    expect(bounds.maxV - bounds.minV).toBeCloseTo((CEILING_Y - FLOOR_Y) / UV_TILE_EDGE, 10);
  });

  it('places each quad on its own tile so the merge boundary is not a UV boundary', () => {
    const n = 20;
    const { positions, normals } = pack(southRun(n));
    const uvs = computeTileUVs(positions, normals);

    for (let q = 0; q < n; q += 1) {
      const quadUs = [0, 1, 2, 3].map((i) => uvAt(uvs, q * 4 + i)[0]);
      expect(Math.min(...quadUs)).toBeCloseTo(q, 10);
      expect(Math.max(...quadUs)).toBeCloseTo(q + 1, 10);
    }
  });

  it('agrees exactly at every shared edge inside the run', () => {
    const n = 20;
    const { positions, normals } = pack(southRun(n));
    const uvs = computeTileUVs(positions, normals);

    for (let q = 0; q + 1 < n; q += 1) {
      // Vertex 1 and 2 of quad q sit on the same world edge as vertex 0 and 3 of
      // quad q+1. Same world point, therefore same UV, within the declared epsilon.
      const pairs: [number, number][] = [
        [q * 4 + 1, (q + 1) * 4 + 0],
        [q * 4 + 2, (q + 1) * 4 + 3],
      ];
      for (const [a, b] of pairs) {
        const [ua, va] = uvAt(uvs, a);
        const [ub, vb] = uvAt(uvs, b);
        expect(Math.abs(ua - ub)).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
        expect(Math.abs(va - vb)).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
      }
    }
  });

  it('is unchanged by where the run starts, so tiling is continuous level-wide', () => {
    const near = pack(southRun(3, 0));
    const far = pack(southRun(3, 7));
    const here = computeTileUVs(near.positions, near.normals);
    const there = computeTileUVs(far.positions, far.normals);
    for (let v = 0; v < here.length / 2; v += 1) {
      // Seven tiles along is seven UV units along: the same texel of the same brick.
      expect(uvAt(there, v)[0] - uvAt(here, v)[0]).toBeCloseTo(7, 10);
      expect(uvAt(there, v)[1]).toBeCloseTo(uvAt(here, v)[1], 10);
    }
  });
});

describe('no face is stretched', () => {
  // Every quad's UV extent equals its world extent in tiles on both axes. A face
  // whose texture is stretched fails this whatever its span happens to be.
  const cases: { name: string; quads: Quad[]; du: number; dv: number }[] = [
    { name: 'a south wall face', quads: southRun(1), du: 1, dv: 2 },
    {
      name: 'a west wall face',
      quads: [
        {
          corners: [0, FLOOR_Y, 0, 0, FLOOR_Y, 1, 0, CEILING_Y, 1, 0, CEILING_Y, 0],
          normal: [-1, 0, 0],
        },
      ],
      du: 1,
      dv: 2,
    },
    {
      name: 'a floor tile',
      quads: [
        {
          corners: [3, FLOOR_Y, 4, 3, FLOOR_Y, 5, 4, FLOOR_Y, 5, 4, FLOOR_Y, 4],
          normal: [0, 1, 0],
        },
      ],
      du: 1,
      dv: 1,
    },
    {
      name: 'a ceiling tile',
      quads: [
        {
          corners: [3, CEILING_Y, 4, 4, CEILING_Y, 4, 4, CEILING_Y, 5, 3, CEILING_Y, 5],
          normal: [0, -1, 0],
        },
      ],
      du: 1,
      dv: 1,
    },
  ];

  it.each(cases)('$name spans its world extent in tiles', ({ quads, du, dv }) => {
    const { positions, normals } = pack(quads);
    const bounds = uvBounds(computeTileUVs(positions, normals));
    expect(bounds.maxU - bounds.minU).toBeCloseTo(du, 10);
    expect(bounds.maxV - bounds.minV).toBeCloseTo(dv, 10);
  });
});

describe('two faces meeting at a corner', () => {
  // The outer corner of a solid block at tile (4,4): its south face and its east
  // face share the vertical edge at x=5, z=5.
  const south: Quad = {
    corners: [4, FLOOR_Y, 5, 5, FLOOR_Y, 5, 5, CEILING_Y, 5, 4, CEILING_Y, 5],
    normal: [0, 0, 1],
  };
  const east: Quad = {
    corners: [5, FLOOR_Y, 5, 5, FLOOR_Y, 4, 5, CEILING_Y, 4, 5, CEILING_Y, 5],
    normal: [1, 0, 0],
  };

  it('agrees on height at the shared edge within the declared epsilon', () => {
    const { positions, normals } = pack([south, east]);
    const uvs = computeTileUVs(positions, normals);
    // South vertex 1 (5,0,5) and east vertex 0 (5,0,5) are the same world point.
    expect(Math.abs(uvAt(uvs, 1)[1] - uvAt(uvs, 4)[1])).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
    // And the top of that same edge: south vertex 2, east vertex 3.
    expect(Math.abs(uvAt(uvs, 2)[1] - uvAt(uvs, 7)[1])).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
  });

  it('meets on a whole-tile boundary, so the pattern continues rather than breaking', () => {
    const { positions, normals } = pack([south, east]);
    const uvs = computeTileUVs(positions, normals);
    for (const vertex of [1, 2, 4, 7]) {
      const u = uvAt(uvs, vertex)[0];
      expect(Math.abs(u - Math.round(u))).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
    }
  });
});

describe('over the faces 002 actually emits', () => {
  // A 6-tile corridor with a solid border: the south side of the top wall is one
  // merged run of six tiles, which is precisely US3-S5's premise.
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
  });

  it('rewrites every emitted vertex, floor and ceiling included', () => {
    const faces = emitFaces(grid);
    for (const data of [faces.floor, faces.ceiling, faces.walls['1']!]) {
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
  it('rejects a normal array that does not match the positions', () => {
    expect(() => computeTileUVs(new Float32Array(12), new Float32Array(9))).toThrow(
      /positions and normals/i,
    );
  });

  it('rejects a position array that is not whole vertices', () => {
    expect(() => computeTileUVs(new Float32Array(11), new Float32Array(11))).toThrow(
      /multiple of 3/i,
    );
  });
});
