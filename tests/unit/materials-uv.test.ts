import { describe, it, expect } from 'vitest';
import { emitFaces } from '../../src/geometry/faces';
import { LEVEL_GRID } from '../../src/level';
import {
  UV_AGREEMENT_EPSILON,
  UV_REPEATS_PER_TILE,
  UV_TILE_EDGE,
  computeTileUVs,
  uvAt,
  uvsAgreeAtEdge,
} from '../../src/materials/uv';

// FR-009 / US3-S5, US3-S6: UVs in world-tile space at one repeat per tile edge,
// so a merged run of N tiles spans N UV units instead of one stretched texture,
// and two faces meeting at a corner sample the same texel where they share an
// edge. Every assertion is over the pure emitter's output — no renderer.

interface Group {
  positions: Float32Array;
  normals: Float32Array;
}

/** `length` wall tiles with open floor to the south and a wall row behind, so
 *  the emitter merges `length` faces into one group. */
const runGrid = (length: number): string[] => [
  '1'.repeat(length),
  '0'.repeat(length),
  '1'.repeat(length),
];

const vertices = (group: Group) => group.positions.length / 3;
const allOf = (group: Group) => [...Array(vertices(group)).keys()];

function spanOf(uvs: Float32Array, chosen: readonly number[]) {
  const us = chosen.map((vertex) => uvAt(uvs, vertex)[0]);
  const vs = chosen.map((vertex) => uvAt(uvs, vertex)[1]);
  return { u: Math.max(...us) - Math.min(...us), v: Math.max(...vs) - Math.min(...vs) };
}

/** Every quad spans one repeat across its tile edge and `vTiles` up it: the
 *  "no face is stretched" half of US3-S5. */
function expectOneRepeatPerQuad(group: Group, vTiles: number): void {
  const uvs = computeTileUVs(group.positions, group.normals);
  const quads = vertices(group) / 4;
  expect(quads).toBeGreaterThan(0);
  for (let quad = 0; quad < quads; quad += 1) {
    const span = spanOf(uvs, [0, 1, 2, 3].map((corner) => quad * 4 + corner));
    expect(span.u).toBeCloseTo(UV_REPEATS_PER_TILE, 6);
    expect(span.v).toBeCloseTo(vTiles * UV_REPEATS_PER_TILE, 6);
  }
}

/** Vertices at one position whose faces point different ways: the corners two
 *  faces of the same material share (US3-S6). */
function cornerPairs(group: Group): Array<readonly [number, number, string]> {
  const byPosition = new Map<string, number[]>();
  for (let vertex = 0; vertex < vertices(group); vertex += 1) {
    const key = [0, 1, 2].map((axis) => group.positions[vertex * 3 + axis]!.toFixed(4)).join(',');
    const list = byPosition.get(key);
    if (list == null) byPosition.set(key, [vertex]);
    else list.push(vertex);
  }

  const pairs: Array<readonly [number, number, string]> = [];
  for (const [key, group_] of byPosition) {
    for (let i = 0; i < group_.length; i += 1) {
      for (let j = i + 1; j < group_.length; j += 1) {
        const [a, b] = [group_[i]!, group_[j]!];
        const sameNormal = [0, 1, 2].every(
          (axis) => Math.abs(group.normals[a * 3 + axis]! - group.normals[b * 3 + axis]!) < 1e-6,
        );
        if (!sameNormal) pairs.push([a, b, key]);
      }
    }
  }
  return pairs;
}

describe('a merged run of N tiles', () => {
  it('declares one repeat per world tile edge, and an epsilon to agree within', () => {
    expect(UV_REPEATS_PER_TILE).toBe(1);
    expect(UV_TILE_EDGE).toBeGreaterThan(0);
    expect(UV_AGREEMENT_EPSILON).toBeGreaterThan(0);
    expect(UV_AGREEMENT_EPSILON).toBeLessThan(0.01);
  });

  it.each([2, 5, 20])('spans exactly %i UV units on its long axis', (length: number) => {
    const wall = emitFaces(runGrid(length)).walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);

    // The south-facing run: `length` merged faces in one group.
    const south = allOf(wall).filter((vertex) => wall.normals[vertex * 3 + 2]! > 0.5);
    expect(south).toHaveLength(length * 4);
    expect(spanOf(uvs, south).u).toBeCloseTo(length * UV_REPEATS_PER_TILE, 6);

    // Two tiles tall, so V spans two repeats, and every U is its own world X in
    // tile units — twenty bricks, not one stretched one.
    expect(spanOf(uvs, allOf(wall)).v).toBeCloseTo(2 * UV_REPEATS_PER_TILE, 6);
    for (const vertex of south) {
      const [u, v] = uvAt(uvs, vertex);
      const perUnit = UV_REPEATS_PER_TILE / UV_TILE_EDGE;
      expect(u).toBeCloseTo(wall.positions[vertex * 3]! * perUnit, 6);
      expect(v).toBeCloseTo(wall.positions[vertex * 3 + 1]! * perUnit, 6);
    }
  });

  it('stretches no face of its own, and tiles the floor beneath it once per tile', () => {
    expectOneRepeatPerQuad(emitFaces(runGrid(6)).walls['1']!, 2);
    const floor = emitFaces(runGrid(8)).floor;
    const span = spanOf(computeTileUVs(floor.positions, floor.normals), allOf(floor));
    expect(span.u).toBeCloseTo(8 * UV_REPEATS_PER_TILE, 6);
    expect(span.v).toBeCloseTo(1 * UV_REPEATS_PER_TILE, 6);
  });
});

describe('two adjacent faces of the same material at a shared edge', () => {
  // An L-shaped block, so a west-facing and a north-facing face of the same wall
  // type meet at one vertical corner edge.
  const CORNER_GRID = ['00000', '01110', '01000', '01000', '00000'];

  it('agree at the corner they share, within the declared epsilon', () => {
    const wall = emitFaces(CORNER_GRID).walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);
    const corners = cornerPairs(wall);
    expect(corners.length).toBeGreaterThan(0);
    for (const [a, b] of corners) expect(uvsAgreeAtEdge(uvAt(uvs, a), uvAt(uvs, b))).toBe(true);
  });

  it('and a pair that disagrees by more than the epsilon is rejected', () => {
    expect(uvsAgreeAtEdge([1, 0.5], [2, 0.5])).toBe(true);
    expect(uvsAgreeAtEdge([1, 0.5], [2, 0.9])).toBe(false);
    expect(uvsAgreeAtEdge([1.25, 0.5], [2, 0.5])).toBe(false);
    expect(uvsAgreeAtEdge([1, 0.5], [2 + UV_AGREEMENT_EPSILON / 2, 0.5])).toBe(true);
  });

  it('computeTileUVs returns two floats per vertex, or refuses mismatched input', () => {
    const wall = emitFaces(runGrid(3)).walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);
    expect(uvs).toBeInstanceOf(Float32Array);
    expect(uvs.length).toBe(vertices(wall) * 2);
    expect(() => computeTileUVs(new Float32Array(9), new Float32Array(6))).toThrow();
  });
});

// The same claims against the level that ships rather than a three-row fixture.

describe('the shipped level', () => {
  const faces = emitFaces(LEVEL_GRID);

  it('spans N UV units across a merged run of N of its own tiles', () => {
    const wall = faces.walls['1']!;
    const uvs = computeTileUVs(wall.positions, wall.normals);

    // The north border's south face up to its first break: the run 002's emitter
    // merges into one group.
    const run: number[] = [];
    for (let x = 0; x < LEVEL_GRID[0]!.length; x += 1) {
      if (LEVEL_GRID[0]![x] === '1' && LEVEL_GRID[1]![x] === '0') run.push(x);
      else if (run.length > 0) break;
    }
    expect(run.length).toBeGreaterThan(10);

    const [from, to] = [run[0]!, run[run.length - 1]! + 1];
    const inRun = allOf(wall).filter(
      (vertex) =>
        wall.normals[vertex * 3 + 2]! >= 0.5 &&
        wall.positions[vertex * 3 + 2]! === 1 &&
        wall.positions[vertex * 3]! >= from &&
        wall.positions[vertex * 3]! <= to,
    );
    expect(inRun).toHaveLength(run.length * 4);
    expect(spanOf(uvs, inRun).u).toBeCloseTo(run.length * UV_REPEATS_PER_TILE, 6);
  });

  it.each(Object.keys(faces.walls))(
    'stretches no face of wall group %s: one repeat per tile edge, everywhere',
    (type: string) => expectOneRepeatPerQuad(faces.walls[type]!, 2),
  );

  it('tiles the floor and the ceiling once per tile in both axes', () => {
    for (const plane of [faces.floor, faces.ceiling]) expectOneRepeatPerQuad(plane, 1);
  });

  it('agrees at every corner in the level, within the declared epsilon', () => {
    // Doors and secrets are isolated, so every corner is in a wall group; they
    // are counted so the assertion cannot pass by finding none.
    let corners = 0;
    const disagreements: string[] = [];

    for (const [type, wall] of Object.entries(faces.walls)) {
      const uvs = computeTileUVs(wall.positions, wall.normals);
      for (const [a, b, key] of cornerPairs(wall)) {
        corners += 1;
        if (!uvsAgreeAtEdge(uvAt(uvs, a), uvAt(uvs, b))) {
          disagreements.push(`wall ${type} at ${key}: ${uvAt(uvs, a)} vs ${uvAt(uvs, b)}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
    expect(corners).toBeGreaterThan(0);
  });
});
