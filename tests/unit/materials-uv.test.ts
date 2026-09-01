import { describe, it, expect } from 'vitest';
import { emitFaces, type FaceData } from '../../src/geometry/faces';
import { LEVEL_GRID, TILE_SIZE } from '../../src/level';
import {
  computeTileUVs,
  repeatDistance,
  TILE_EDGE_UNITS,
  uvSpan,
  uvsAgree,
  UV_AGREEMENT_EPSILON,
} from '../../src/materials/uv';

// FR-009 / US4-S1 / US4-S2. The claim under test is geometric, not aesthetic: a
// UV is a world position divided by the tile edge, so a merged run of N tiles
// spans N UV units, a merge boundary is not a UV boundary, and two faces that
// meet at a corner land on the same point of the repeat.

/** One quad's four vertices as `[u, v]` pairs. */
function quadUVs(uvs: Float32Array, quad: number): [number, number][] {
  return [0, 1, 2, 3].map((corner) => {
    const vertex = quad * 4 + corner;
    return [uvs[vertex * 2]!, uvs[vertex * 2 + 1]!] as [number, number];
  });
}

/** One quad's four vertices as `[x, y, z]` triples. */
function quadPositions(positions: Float32Array, quad: number): [number, number, number][] {
  return [0, 1, 2, 3].map((corner) => {
    const vertex = quad * 4 + corner;
    return [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!] as [
      number,
      number,
      number,
    ];
  });
}

function extent(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** The two world axes a face's UVs must measure, from its normal. */
function projectedAxes(normal: [number, number, number]): [0 | 1 | 2, 0 | 1 | 2] {
  const [nx, ny, nz] = normal.map(Math.abs) as [number, number, number];
  if (ny >= nx && ny >= nz) return [0, 2];
  if (nx >= nz) return [2, 1];
  return [0, 1];
}

function quadCount(data: FaceData): number {
  return data.positions.length / 12;
}

function everyFaceData(grid: string[]): FaceData[] {
  const faces = emitFaces(grid);
  return [...Object.values(faces.walls), faces.floor, faces.ceiling];
}

// A twenty-tile run of one wall type, bordered north and south by open floor,
// so the emitter produces one merged geometry of twenty co-planar quads.
const RUN_TILES = 20;
const RUN_GRID = [
  '1'.repeat(RUN_TILES + 2),
  `1${'0'.repeat(RUN_TILES)}1`,
  '1'.repeat(RUN_TILES + 2),
];

describe('the declared tiling constants', () => {
  it('repeats once per world tile edge', () => {
    expect(TILE_EDGE_UNITS).toBe(TILE_SIZE);
    expect(UV_AGREEMENT_EPSILON).toBeGreaterThan(0);
    expect(UV_AGREEMENT_EPSILON).toBeLessThan(1e-2);
  });

  it('measures agreement around the repeat, not along the number line', () => {
    expect(repeatDistance(0.25, 0.25)).toBeCloseTo(0, 10);
    expect(repeatDistance(3, 21)).toBeCloseTo(0, 10);
    expect(repeatDistance(0.1, 0.6)).toBeCloseTo(0.5, 10);
  });
});

describe('a merged run of N tiles (US4-S1)', () => {
  const faces = emitFaces(RUN_GRID);
  const wall = faces.walls['1']!;
  const uvs = computeTileUVs(wall.positions, wall.normals);

  it('emits one UV pair per vertex', () => {
    expect(uvs.length).toBe((wall.positions.length / 3) * 2);
  });

  it('spans exactly N UV units across the run, and no more', () => {
    // The north-facing wall of the run's south row: twenty quads, one merged
    // geometry, one continuous strip of brick.
    const runU: number[] = [];
    const runV: number[] = [];
    let quads = 0;
    for (let quad = 0; quad < quadCount(wall); quad += 1) {
      const normal = [wall.normals[quad * 12]!, wall.normals[quad * 12 + 1]!, wall.normals[quad * 12 + 2]!];
      const z = wall.positions[quad * 12 + 2]!;
      if (normal[2] !== -1 || z !== 2) continue;
      quads += 1;
      for (const [u, v] of quadUVs(uvs, quad)) {
        runU.push(u);
        runV.push(v);
      }
    }
    expect(quads).toBe(RUN_TILES);
    expect(extent(runU)).toBeCloseTo(RUN_TILES, 6);
    // Two tiles tall: the wall is two world units and the repeat is per tile.
    expect(extent(runV)).toBeCloseTo(2, 6);
  });

  it('does not break the repeat at a merge boundary', () => {
    // Two neighbouring quads of the run share a vertical edge. Their UVs there
    // are equal outright, not merely congruent: the merge is invisible.
    const byX = new Map<number, [number, number][]>();
    for (let quad = 0; quad < quadCount(wall); quad += 1) {
      const normal = wall.normals[quad * 12 + 2]!;
      const z = wall.positions[quad * 12 + 2]!;
      if (normal !== -1 || z !== 2) continue;
      const positions = quadPositions(wall.positions, quad);
      const uv = quadUVs(uvs, quad);
      positions.forEach(([x, y], corner) => {
        if (y !== 0) return;
        const key = x;
        const existing = byX.get(key) ?? [];
        existing.push(uv[corner]!);
        byX.set(key, existing);
      });
    }
    const shared = [...byX.entries()].filter(([, list]) => list.length > 1);
    expect(shared.length).toBe(RUN_TILES - 1);
    for (const [x, [first, second]] of shared) {
      expect(first![0]).toBeCloseTo(second![0], 10);
      expect(first![0]).toBeCloseTo(x / TILE_EDGE_UNITS, 10);
      expect(uvsAgree(first!, second!)).toBe(true);
    }
  });
});

describe('two faces meeting at a corner (US4-S2)', () => {
  // A convex corner of one material: the north-south wall at x = 1 and the
  // east-west wall at z = 1 meet along the vertical edge (1, *, 1).
  const CORNER_GRID = ['111', '100', '100'];
  const wall = emitFaces(CORNER_GRID).walls['1']!;
  const uvs = computeTileUVs(wall.positions, wall.normals);

  it('agrees at the shared edge within the declared epsilon', () => {
    const atCorner: { normal: number[]; uv: [number, number] }[] = [];
    for (let quad = 0; quad < quadCount(wall); quad += 1) {
      const normal = [wall.normals[quad * 12]!, wall.normals[quad * 12 + 1]!, wall.normals[quad * 12 + 2]!];
      const positions = quadPositions(wall.positions, quad);
      const uv = quadUVs(uvs, quad);
      positions.forEach(([x, y, z], corner) => {
        if (x === 1 && z === 1 && y === 0) atCorner.push({ normal, uv: uv[corner]! });
      });
    }
    // One vertex from the east-facing quad, one from the south-facing quad.
    const facings = new Set(atCorner.map((entry) => entry.normal.join(',')));
    expect(facings.size).toBeGreaterThanOrEqual(2);
    for (const a of atCorner) {
      for (const b of atCorner) {
        expect(uvsAgree(a.uv, b.uv)).toBe(true);
        expect(repeatDistance(a.uv[0], b.uv[0])).toBeLessThanOrEqual(UV_AGREEMENT_EPSILON);
        expect(a.uv[1]).toBeCloseTo(b.uv[1], 10);
      }
    }
  });
});

describe('every face of the built level (FR-009)', () => {
  it('carries a UV span equal to its world extent in tiles', () => {
    let checked = 0;
    for (const data of everyFaceData(LEVEL_GRID)) {
      const uvs = computeTileUVs(data.positions, data.normals);
      for (let quad = 0; quad < quadCount(data); quad += 1) {
        const normal = [data.normals[quad * 12]!, data.normals[quad * 12 + 1]!, data.normals[quad * 12 + 2]!] as [number, number, number];
        const [uAxis, vAxis] = projectedAxes(normal);
        const positions = quadPositions(data.positions, quad);
        const uv = quadUVs(uvs, quad);
        const worldU = extent(positions.map((p) => p[uAxis]));
        const worldV = extent(positions.map((p) => p[vAxis]));
        expect(extent(uv.map((pair) => pair[0]))).toBeCloseTo(worldU / TILE_EDGE_UNITS, 6);
        expect(extent(uv.map((pair) => pair[1]))).toBeCloseTo(worldV / TILE_EDGE_UNITS, 6);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('spans the floor once per tile across the whole level, not once in total', () => {
    const floor = emitFaces(LEVEL_GRID).floor;
    const uvs = computeTileUVs(floor.positions, floor.normals);
    const span = uvSpan(uvs);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let vertex = 0; vertex < floor.positions.length / 3; vertex += 1) {
      xs.push(floor.positions[vertex * 3]!);
      zs.push(floor.positions[vertex * 3 + 2]!);
    }
    expect(span.u).toBeCloseTo(extent(xs) / TILE_EDGE_UNITS, 6);
    expect(span.v).toBeCloseTo(extent(zs) / TILE_EDGE_UNITS, 6);
    expect(span.u).toBeGreaterThan(1);
  });
});

describe('computeTileUVs as a function', () => {
  it('rejects mismatched or malformed inputs rather than emitting silent garbage', () => {
    expect(() => computeTileUVs(new Float32Array(6), new Float32Array(3))).toThrow();
    expect(() => computeTileUVs(new Float32Array(4), new Float32Array(4))).toThrow();
    expect(() => computeTileUVs(new Float32Array(3), new Float32Array(3), 0)).toThrow();
  });

  it('depends on world position alone, so a re-merge cannot move a texel', () => {
    const positions = new Float32Array([4, 0, 7, 5, 0, 7, 5, 2, 7, 4, 2, 7]);
    const normals = new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
    const once = computeTileUVs(positions, normals);
    const again = computeTileUVs(positions.slice(0, 6), normals.slice(0, 6));
    expect([...once.slice(0, 4)]).toEqual([...again]);
    expect([...once]).toEqual([4, 0, 5, 0, 5, 2, 4, 2]);
  });

  it('scales with the declared tile edge rather than a literal', () => {
    const positions = new Float32Array([0, 0, 0, 2, 0, 0]);
    const normals = new Float32Array([0, 0, -1, 0, 0, -1]);
    expect([...computeTileUVs(positions, normals, 2)]).toEqual([0, 0, 1, 0]);
  });
});
