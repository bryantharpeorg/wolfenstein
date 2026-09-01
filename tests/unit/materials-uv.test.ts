import { describe, it, expect } from 'vitest';
import { emitFaces, type FaceData } from '../../src/geometry/faces';
import { CEILING_Y, FLOOR_Y, LEVEL_GRID, TILE_SIZE } from '../../src/level';
import {
  UV_EDGE_EPSILON,
  UV_TILE_EDGE,
  computeTileUVs,
  uvSpan,
} from '../../src/materials/uv';

// FR-009 / US4-S1, US4-S2. Tile-space UVs make a merged N-tile run span exactly
// N UV units, keep adjacent faces of the same material agreeing at a shared
// edge, and never stretch one texture repeat across a whole face.

const QUAD = 4;
/** Height of a wall quad in tiles: two, so a wall carries two repeats of V. */
const WALL_HEIGHT_TILES = (CEILING_Y - FLOOR_Y) / TILE_SIZE;

function getBrickFaces(): FaceData {
  const faces = emitFaces(LEVEL_GRID);
  const data = faces.walls['2'];
  if (data == null) throw new Error('expected brick wall faces');
  return data;
}

/** Every FaceData the level emits, wall groups and the two horizontal planes,
 * each already re-UV'd in world-tile space. */
function allUvdFaces(): FaceData[] {
  const faces = emitFaces(LEVEL_GRID);
  const all = [...Object.values(faces.walls), faces.floor, faces.ceiling];
  for (const data of all) computeTileUVs(data.positions, data.normals, data.uvs);
  return all;
}

function quadCount(data: FaceData): number {
  return data.positions.length / 3 / QUAD;
}

type Pair = readonly [number, number];

/** One quad's world extent in tiles on the two axes its UVs run along, its UV
 * span, and its UV origin. The axes are the two that are not the normal's, with
 * the vertical one always carried by V so a wall is never laid on its side. */
function readQuad(data: FaceData, quad: number): { extent: Pair; span: Pair; origin: Pair } {
  const base = quad * QUAD;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const uvMin = [Infinity, Infinity];
  const uvMax = [-Infinity, -Infinity];

  for (let i = 0; i < QUAD; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      const c = data.positions[(base + i) * 3 + a]!;
      min[a] = Math.min(min[a]!, c);
      max[a] = Math.max(max[a]!, c);
    }
    for (let a = 0; a < 2; a += 1) {
      const c = data.uvs[(base + i) * 2 + a]!;
      uvMin[a] = Math.min(uvMin[a]!, c);
      uvMax[a] = Math.max(uvMax[a]!, c);
    }
  }

  const n = [0, 1, 2].map((a) => Math.abs(data.normals[base * 3 + a]!));
  const normalAxis = n[1]! >= n[0]! && n[1]! >= n[2]! ? 1 : n[0]! >= n[2]! ? 0 : 2;
  const axes = normalAxis === 1 ? [0, 2] : [normalAxis === 0 ? 2 : 0, 1];

  return {
    extent: [(max[axes[0]!]! - min[axes[0]!]!) / TILE_SIZE, (max[axes[1]!]! - min[axes[1]!]!) / TILE_SIZE],
    span: [uvMax[0]! - uvMin[0]!, uvMax[1]! - uvMin[1]!],
    origin: [uvMin[0]!, uvMin[1]!],
  };
}

describe('tile-space UVs on merged geometry (US4-S1)', () => {
  it('spans exactly N UV units across a merged run of N tiles', () => {
    // A 10-tile corridor wall. Its south-facing side is the merged run the
    // player sees: ten quads emitted into one buffer as one draw call.
    const RUN = 10;
    const solid = '2'.repeat(RUN + 2);
    const faces = emitFaces([solid, `2${'0'.repeat(RUN)}2`, solid]);
    const data = faces.walls['2'];
    if (data == null) throw new Error('expected brick faces');
    computeTileUVs(data.positions, data.normals, data.uvs);

    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    let quads = 0;
    for (let q = 0; q < quadCount(data); q += 1) {
      const base = q * QUAD;
      if (data.normals[base * 3 + 2] !== 1) continue;
      quads += 1;
      for (let i = 0; i < QUAD; i += 1) {
        uMin = Math.min(uMin, data.uvs[(base + i) * 2]!);
        uMax = Math.max(uMax, data.uvs[(base + i) * 2]!);
        vMin = Math.min(vMin, data.uvs[(base + i) * 2 + 1]!);
        vMax = Math.max(vMax, data.uvs[(base + i) * 2 + 1]!);
      }
    }

    expect(quads).toBe(RUN);
    // One texture repeat per world tile: N tiles of wall, N UV units, not one.
    expect(uMax - uMin).toBeCloseTo(RUN, 6);
    expect(vMax - vMin).toBeCloseTo(WALL_HEIGHT_TILES, 6);
  });

  it('gives every emitted face a UV span equal to its world extent in tiles', () => {
    let inspected = 0;
    for (const data of allUvdFaces()) {
      for (let q = 0; q < quadCount(data); q += 1) {
        const { extent, span, origin } = readQuad(data, q);
        // The claim of FR-009, made one face at a time: the texture is laid on
        // in world-tile space, so a face's UV span is its own size in tiles.
        expect(span[0]).toBeCloseTo(extent[0], 6);
        expect(span[1]).toBeCloseTo(extent[1], 6);
        // A face whose UV collapses on either axis is a stretched face: one
        // texel smeared across its whole width.
        expect(span[0]).toBeGreaterThan(UV_EDGE_EPSILON);
        expect(span[1]).toBeGreaterThan(UV_EDGE_EPSILON);
        // 002 emits on the tile lattice, so a face's UV origin lands on a
        // repeat boundary: the seam between two merged quads is invisible.
        expect(Math.abs(origin[0] - Math.round(origin[0]))).toBeLessThan(UV_EDGE_EPSILON);
        expect(Math.abs(origin[1] - Math.round(origin[1]))).toBeLessThan(UV_EDGE_EPSILON);
        inspected += 1;
      }
    }
    expect(inspected).toBeGreaterThan(100);
  });

  it('does not leave every quad clamped to a single 0..1 tile', () => {
    const data = getBrickFaces();
    computeTileUVs(data.positions, data.normals, data.uvs);

    const outside = data.uvs.some(
      (value) => value > 1 + UV_EDGE_EPSILON || value < -UV_EDGE_EPSILON,
    );
    expect(outside).toBe(true);
  });

  it('gives the floor and ceiling distinct non-stretched UVs', () => {
    const faces = emitFaces(LEVEL_GRID);

    computeTileUVs(faces.floor.positions, faces.floor.normals, faces.floor.uvs);
    computeTileUVs(faces.ceiling.positions, faces.ceiling.normals, faces.ceiling.uvs);

    expect(uvSpan(faces.floor.uvs, 'u')).toBeGreaterThan(UV_TILE_EDGE);
    expect(uvSpan(faces.floor.uvs, 'v')).toBeGreaterThan(UV_TILE_EDGE);
    expect(uvSpan(faces.ceiling.uvs, 'u')).toBeGreaterThan(UV_TILE_EDGE);
    expect(uvSpan(faces.ceiling.uvs, 'v')).toBeGreaterThan(UV_TILE_EDGE);
  });
});

describe('adjacent faces at a shared edge (US4-S2)', () => {
  it('agrees within the declared epsilon everywhere two faces meet', () => {
    const data = getBrickFaces();
    computeTileUVs(data.positions, data.normals, data.uvs);

    // Two quads of one material that share a world position share an edge. Down
    // a merged run both faces lie in the same plane and their UVs must be
    // identical; at a corner the two planes are at right angles, and what the
    // eye needs is that both land on the same point of the repeating texture —
    // agreement modulo one repeat, which is what RepeatWrapping samples.
    const seen = new Map<string, { u: number; v: number; axis: string }>();
    const mergeMismatches: string[] = [];
    const cornerMismatches: string[] = [];
    const wrapped = (d: number): number => Math.min(d % 1, 1 - (d % 1));
    let shared = 0;
    let corners = 0;

    for (let v = 0; v < data.positions.length / 3; v += 1) {
      const p = v * 3;
      const at = (src: Float32Array): string =>
        `${src[p]!.toFixed(4)},${src[p + 1]!.toFixed(4)},${src[p + 2]!.toFixed(4)}`;
      const key = at(data.positions);
      const axis = at(data.normals);
      const u = data.uvs[v * 2]!;
      const uv = data.uvs[v * 2 + 1]!;

      const before = seen.get(key);
      if (before == null) {
        seen.set(key, { u, v: uv, axis });
        continue;
      }
      shared += 1;
      const du = Math.abs(before.u - u);
      const dv = Math.abs(before.v - uv);
      const report = `${key}: (${before.u}, ${before.v}) vs (${u}, ${uv})`;

      if (before.axis === axis) {
        // Same plane: a merge boundary. Nothing may differ at all.
        if (du > UV_EDGE_EPSILON || dv > UV_EDGE_EPSILON) mergeMismatches.push(report);
      } else {
        corners += 1;
        if (wrapped(du) > UV_EDGE_EPSILON || wrapped(dv) > UV_EDGE_EPSILON) {
          cornerMismatches.push(report);
        }
      }
    }

    expect(shared).toBeGreaterThan(0);
    expect(corners).toBeGreaterThan(0);
    expect(mergeMismatches).toEqual([]);
    expect(cornerMismatches).toEqual([]);
  });

  it('declares an epsilon small enough to mean something', () => {
    expect(UV_EDGE_EPSILON).toBeGreaterThan(0);
    expect(UV_EDGE_EPSILON).toBeLessThan(1e-3);
    expect(UV_TILE_EDGE).toBe(TILE_SIZE);
  });
});

describe('the computeTileUVs contract', () => {
  it('allocates the UV array when the caller does not supply one', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = computeTileUVs(positions, normals);
    expect(uvs).toBeInstanceOf(Float32Array);
    expect(uvs.length).toBe(8);
    expect(uvSpan(uvs, 'u')).toBeCloseTo(1 / TILE_SIZE, 6);
    expect(uvSpan(uvs, 'v')).toBeCloseTo(2 / TILE_SIZE, 6);
  });

  it('offsets by the mesh origin so a placed block tiles with the world', () => {
    // A door leaf is a box at a tile centre, so its vertices are local. Given
    // the mesh's world position the UVs land on the same lattice as the wall
    // the leaf sits in, instead of on a lattice of their own.
    const positions = new Float32Array([-0.5, -1, 0, 0.5, -1, 0, 0.5, 1, 0, -0.5, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = computeTileUVs(positions, normals, undefined, [3.5, 1, 7]);
    expect(uvs[0]).toBeCloseTo(3 / TILE_SIZE, 6);
    expect(uvs[1]).toBeCloseTo(0 / TILE_SIZE, 6);
    expect(uvs[4]).toBeCloseTo(4 / TILE_SIZE, 6);
    expect(uvs[5]).toBeCloseTo(2 / TILE_SIZE, 6);
  });

  it('rejects mismatched attribute sizes', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const badUvs = new Float32Array(4);
    expect(() => computeTileUVs(positions, normals, badUvs)).toThrow(/mismatched attribute sizes/);
  });
});
