import { describe, it, expect } from 'vitest';
import { emitFaces } from '../../src/geometry/faces';
import {
  UV_AGREEMENT_EPSILON,
  UV_REPEATS_PER_TILE,
  UV_TILE_EDGE,
  computeTileUVs,
  uvAt,
  uvBounds,
  uvsAgreeAtEdge,
} from '../../src/materials/uv';

// FR-009 / US3-S5, US3-S6: UVs are computed in world-tile space at one repeat per
// tile edge, so a merged run of N tiles spans N UV units instead of one stretched
// texture, and two faces meeting at a corner sample the same texel at the edge
// they share. Every assertion here is over the pure emitter's output — no
// renderer, no page.

/** A run of `length` wall tiles with open floor to the south, then a wall row
 *  behind it, so the emitter merges `length` faces into one group. */
function runGrid(length: number): string[] {
  return ['1'.repeat(length), '0'.repeat(length), '1'.repeat(length)];
}

/** The vertices whose face normal points along `axis` with the given sign. */
function selectVertices(
  positions: Float32Array,
  normals: Float32Array,
  predicate: (n: readonly [number, number, number]) => boolean,
): number[] {
  const chosen: number[] = [];
  for (let vertex = 0; vertex * 3 < positions.length; vertex += 1) {
    const n: readonly [number, number, number] = [
      normals[vertex * 3]!,
      normals[vertex * 3 + 1]!,
      normals[vertex * 3 + 2]!,
    ];
    if (predicate(n)) chosen.push(vertex);
  }
  return chosen;
}

function boundsOf(uvs: Float32Array, vertices: readonly number[]) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const vertex of vertices) {
    const [u, v] = uvAt(uvs, vertex);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, maxU, minV, maxV };
}

describe('the declared tile-UV constants', () => {
  it('repeats once per world tile edge', () => {
    expect(UV_REPEATS_PER_TILE).toBe(1);
    expect(UV_TILE_EDGE).toBeGreaterThan(0);
  });

  it('declares the epsilon two faces must agree within at a shared edge', () => {
    expect(UV_AGREEMENT_EPSILON).toBeGreaterThan(0);
    expect(UV_AGREEMENT_EPSILON).toBeLessThan(0.01);
  });
});

describe('a merged run of N tiles', () => {
  it.each([2, 5, 20])('spans exactly %i UV units on its long axis', (length: number) => {
    const faces = emitFaces(runGrid(length));
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);

    // The south-facing run: `length` merged faces, one per tile, in one group.
    const south = selectVertices(wall.positions, wall.normals, (n) => n[2] > 0.5);
    expect(south).toHaveLength(length * 4);

    const span = boundsOf(uvs, south);
    expect(span.maxU - span.minU).toBeCloseTo(length * UV_REPEATS_PER_TILE, 6);
  });

  it('spans the wall height in V, not the whole texture', () => {
    const faces = emitFaces(runGrid(20));
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);
    const bounds = uvBounds(uvs);
    // The level's walls are two tiles tall, so V spans two repeats.
    expect(bounds.maxV - bounds.minV).toBeCloseTo(2 * UV_REPEATS_PER_TILE, 6);
  });

  it('gives every single face exactly one repeat across its tile', () => {
    const faces = emitFaces(runGrid(6));
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);

    const quads = wall.positions.length / 3 / 4;
    expect(quads).toBeGreaterThan(0);
    for (let quad = 0; quad < quads; quad += 1) {
      const vertices = [0, 1, 2, 3].map((corner) => quad * 4 + corner);
      const bounds = boundsOf(uvs, vertices);
      expect(bounds.maxU - bounds.minU).toBeCloseTo(UV_REPEATS_PER_TILE, 6);
      expect(bounds.maxV - bounds.minV).toBeCloseTo(2 * UV_REPEATS_PER_TILE, 6);
    }
  });

  it('is continuous across the merge boundary: no face is stretched', () => {
    const length = 20;
    const faces = emitFaces(runGrid(length));
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);

    // Every south-facing vertex's U equals its own world X in tile units — which
    // is what makes the run read as `length` bricks rather than one.
    const south = selectVertices(wall.positions, wall.normals, (n) => n[2] > 0.5);
    for (const vertex of south) {
      const [u, v] = uvAt(uvs, vertex);
      expect(u).toBeCloseTo((wall.positions[vertex * 3]! / UV_TILE_EDGE) * UV_REPEATS_PER_TILE, 6);
      expect(v).toBeCloseTo(
        (wall.positions[vertex * 3 + 1]! / UV_TILE_EDGE) * UV_REPEATS_PER_TILE,
        6,
      );
    }
  });
});

describe('the floor and ceiling planes', () => {
  it('tile once per world tile in both axes', () => {
    const faces = emitFaces(runGrid(8));
    const uvs = computeTileUVs(faces.floor.positions, faces.floor.normals);
    const bounds = uvBounds(uvs);
    expect(bounds.maxU - bounds.minU).toBeCloseTo(8 * UV_REPEATS_PER_TILE, 6);
    expect(bounds.maxV - bounds.minV).toBeCloseTo(1 * UV_REPEATS_PER_TILE, 6);
  });
});

describe('two adjacent faces of the same material at a shared edge', () => {
  // An L-shaped block, so a west-facing and a north-facing face of the same wall
  // type meet at one vertical corner edge.
  const CORNER_GRID = ['00000', '01110', '01000', '01000', '00000'];

  it('agree at the corner they share, within the declared epsilon', () => {
    const faces = emitFaces(CORNER_GRID);
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);

    // Collect every vertex by its world position, then find positions shared by
    // two faces with different normals: those are the corners.
    const byPosition = new Map<string, number[]>();
    for (let vertex = 0; vertex * 3 < wall.positions.length; vertex += 1) {
      const key = [0, 1, 2]
        .map((axis) => wall.positions[vertex * 3 + axis]!.toFixed(4))
        .join(',');
      const list = byPosition.get(key);
      if (list == null) byPosition.set(key, [vertex]);
      else list.push(vertex);
    }

    let corners = 0;
    for (const vertices of byPosition.values()) {
      for (const a of vertices) {
        for (const b of vertices) {
          if (a >= b) continue;
          const sameNormal = [0, 1, 2].every(
            (axis) =>
              Math.abs(wall.normals[a * 3 + axis]! - wall.normals[b * 3 + axis]!) < 1e-6,
          );
          if (sameNormal) continue;
          corners += 1;
          expect(uvsAgreeAtEdge(uvAt(uvs, a), uvAt(uvs, b))).toBe(true);
        }
      }
    }
    expect(corners).toBeGreaterThan(0);
  });

  it('rejects a pair whose UVs disagree by more than the epsilon', () => {
    expect(uvsAgreeAtEdge([1, 0.5], [2, 0.5])).toBe(true);
    expect(uvsAgreeAtEdge([1, 0.5], [2, 0.9])).toBe(false);
    expect(uvsAgreeAtEdge([1.25, 0.5], [2, 0.5])).toBe(false);
    expect(uvsAgreeAtEdge([1, 0.5], [2 + UV_AGREEMENT_EPSILON / 2, 0.5])).toBe(true);
  });
});

describe('computeTileUVs itself', () => {
  it('returns two floats per vertex', () => {
    const faces = emitFaces(runGrid(3));
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);
    expect(uvs).toBeInstanceOf(Float32Array);
    expect(uvs.length).toBe((wall.positions.length / 3) * 2);
  });

  it('rejects a normal array that does not match the positions', () => {
    expect(() => computeTileUVs(new Float32Array(9), new Float32Array(6))).toThrow();
  });
});
