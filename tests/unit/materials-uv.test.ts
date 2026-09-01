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

const VERTICES_PER_QUAD = 4;

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
function allUvdFaces(grid: string[] = LEVEL_GRID): FaceData[] {
  const faces = emitFaces(grid);
  const all = [...Object.values(faces.walls), faces.floor, faces.ceiling];
  for (const data of all) computeTileUVs(data.positions, data.normals, data.uvs);
  return all;
}

type Axis = 'x' | 'y' | 'z';

interface Quad {
  /** World extent of the quad on each axis, in tiles. */
  readonly extent: Record<Axis, number>;
  /** Which world axis the quad's normal points along. */
  readonly normalAxis: Axis;
  readonly uSpan: number;
  readonly vSpan: number;
  readonly uMin: number;
  readonly vMin: number;
}

function readQuad(data: FaceData, quadIndex: number): Quad {
  const base = quadIndex * VERTICES_PER_QUAD;
  const min: Record<Axis, number> = { x: Infinity, y: Infinity, z: Infinity };
  const max: Record<Axis, number> = { x: -Infinity, y: -Infinity, z: -Infinity };
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;

  for (let i = 0; i < VERTICES_PER_QUAD; i += 1) {
    const p = (base + i) * 3;
    const coords: Record<Axis, number> = {
      x: data.positions[p]!,
      y: data.positions[p + 1]!,
      z: data.positions[p + 2]!,
    };
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      min[axis] = Math.min(min[axis], coords[axis]);
      max[axis] = Math.max(max[axis], coords[axis]);
    }
    const u = data.uvs[(base + i) * 2]!;
    const v = data.uvs[(base + i) * 2 + 1]!;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }

  const nx = data.normals[base * 3]!;
  const ny = data.normals[base * 3 + 1]!;
  const nz = data.normals[base * 3 + 2]!;
  const normalAxis: Axis =
    Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz)
      ? 'y'
      : Math.abs(nx) >= Math.abs(nz)
        ? 'x'
        : 'z';

  return {
    extent: {
      x: (max.x - min.x) / TILE_SIZE,
      y: (max.y - min.y) / TILE_SIZE,
      z: (max.z - min.z) / TILE_SIZE,
    },
    normalAxis,
    uSpan: uMax - uMin,
    vSpan: vMax - vMin,
    uMin,
    vMin,
  };
}

function quadCount(data: FaceData): number {
  return data.positions.length / 3 / VERTICES_PER_QUAD;
}

/** The world axes a face's U and V run along, given the axis its normal points
 * down: the two axes that are not the normal's, with the vertical one always
 * carried by V so a wall's texture is never laid on its side. */
function uvAxesFor(normalAxis: Axis): { u: Axis; v: Axis } {
  if (normalAxis === 'y') return { u: 'x', v: 'z' };
  return { u: normalAxis === 'x' ? 'z' : 'x', v: 'y' };
}

describe('tile-space UVs on merged geometry (US4-S1)', () => {
  it('spans exactly N UV units across a merged run of N tiles', () => {
    // A 10-tile corridor wall: rows of brick above and below an open run.
    const RUN = 10;
    const solid = '2'.repeat(RUN + 2);
    const open = `2${'0'.repeat(RUN)}2`;
    const faces = emitFaces([solid, open, solid]);
    const data = faces.walls['2'];
    if (data == null) throw new Error('expected brick faces');
    computeTileUVs(data.positions, data.normals, data.uvs);

    // The south-facing run is the merged wall the player sees down the corridor:
    // ten quads, tiles x = 1..11, emitted into one buffer as one draw call.
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    let quads = 0;
    for (let q = 0; q < quadCount(data); q += 1) {
      const base = q * VERTICES_PER_QUAD;
      if (data.normals[base * 3 + 2] !== 1) continue;
      quads += 1;
      for (let i = 0; i < VERTICES_PER_QUAD; i += 1) {
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
        const quad = readQuad(data, q);
        const axes = uvAxesFor(quad.normalAxis);
        // The claim of FR-009, made one face at a time: the texture is laid on
        // in world-tile space, so a face's UV span is its own size in tiles.
        expect(quad.uSpan).toBeCloseTo(quad.extent[axes.u], 6);
        expect(quad.vSpan).toBeCloseTo(quad.extent[axes.v], 6);
        // A face whose UV collapses on either axis is a stretched face: one
        // texel smeared across its whole width.
        expect(quad.uSpan).toBeGreaterThan(UV_EDGE_EPSILON);
        expect(quad.vSpan).toBeGreaterThan(UV_EDGE_EPSILON);
        inspected += 1;
      }
    }
    expect(inspected).toBeGreaterThan(100);
  });

  it('places every face on a whole-tile UV boundary, so the tiling is continuous', () => {
    for (const data of allUvdFaces()) {
      for (let q = 0; q < quadCount(data); q += 1) {
        const quad = readQuad(data, q);
        // 002 emits on the tile lattice, so a face's UV origin lands on a
        // repeat boundary: the seam between two merged quads is invisible.
        expect(Math.abs(quad.uMin - Math.round(quad.uMin))).toBeLessThan(UV_EDGE_EPSILON);
        expect(Math.abs(quad.vMin - Math.round(quad.vMin))).toBeLessThan(UV_EDGE_EPSILON);
      }
    }
  });

  it('does not leave every quad clamped to a single 0..1 tile', () => {
    const data = getBrickFaces();
    computeTileUVs(data.positions, data.normals, data.uvs);

    const outside = data.uvs.some(
      (value) => value > 1 + UV_EDGE_EPSILON || value < -UV_EDGE_EPSILON,
    );
    expect(outside).toBe(true);
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
    let shared = 0;
    let corners = 0;

    for (let v = 0; v < data.positions.length / 3; v += 1) {
      const p = v * 3;
      const key = [
        data.positions[p]!.toFixed(4),
        data.positions[p + 1]!.toFixed(4),
        data.positions[p + 2]!.toFixed(4),
      ].join(',');
      const axis = [
        data.normals[p]!.toFixed(3),
        data.normals[p + 1]!.toFixed(3),
        data.normals[p + 2]!.toFixed(3),
      ].join(',');
      const u = data.uvs[v * 2]!;
      const uv = data.uvs[v * 2 + 1]!;

      const before = seen.get(key);
      if (before == null) {
        seen.set(key, { u, v: uv, axis });
        continue;
      }
      shared += 1;

      if (before.axis === axis) {
        // Same plane: a merge boundary. Nothing may differ at all.
        if (Math.abs(before.u - u) > UV_EDGE_EPSILON || Math.abs(before.v - uv) > UV_EDGE_EPSILON) {
          mergeMismatches.push(`${key}: (${before.u}, ${before.v}) vs (${u}, ${uv})`);
        }
      } else {
        corners += 1;
        const du = Math.abs(before.u - u);
        const dv = Math.abs(before.v - uv);
        const wrapped = (d: number): number => Math.min(d % 1, 1 - (d % 1));
        if (wrapped(du) > UV_EDGE_EPSILON || wrapped(dv) > UV_EDGE_EPSILON) {
          cornerMismatches.push(`${key}: (${before.u}, ${before.v}) vs (${u}, ${uv})`);
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

describe('the horizontal planes', () => {
  it('gives the floor and ceiling one repeat per tile across the whole level', () => {
    const faces = emitFaces(LEVEL_GRID);
    computeTileUVs(faces.floor.positions, faces.floor.normals, faces.floor.uvs);
    computeTileUVs(faces.ceiling.positions, faces.ceiling.normals, faces.ceiling.uvs);

    // The floor and the ceiling cover the same open tiles, so their UV extents
    // match each other and both count tiles rather than fractions of one.
    const floorU = uvSpan(faces.floor.uvs, 'u');
    const floorV = uvSpan(faces.floor.uvs, 'v');
    expect(floorU).toBeCloseTo(uvSpan(faces.ceiling.uvs, 'u'), 6);
    expect(floorV).toBeCloseTo(uvSpan(faces.ceiling.uvs, 'v'), 6);
    expect(floorU).toBeGreaterThan(10);
    expect(floorV).toBeGreaterThan(10);
    expect(floorU).toBeCloseTo(Math.round(floorU), 6);
    expect(floorV).toBeCloseTo(Math.round(floorV), 6);
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
