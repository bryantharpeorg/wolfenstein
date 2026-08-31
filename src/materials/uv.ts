// UVs in world-tile space, one repeat per tile edge (FR-009): a function of
// position alone and never of a vertex's index inside its quad, because 002
// merges every face of a wall type into one buffer and a per-quad `0..1`
// parameterisation is exactly what a merge destroys. Derived from the coordinates
// the face already has, a merge boundary is not a UV boundary — the seam lands on
// an integer, where a repeating texture wraps to the same texel. Projection is by
// dominant normal axis (±X -> z,y; ±Z -> x,y; ±Y -> x,z). Pure.

import { TILE_SIZE } from '../level';

/** The edge one repeat covers, from 002 so FR-009's tile and the tile drawn
 * cannot drift. */
export const UV_TILE_EDGE = TILE_SIZE;
export const UV_REPEATS_PER_TILE = 1;

/** How far two faces' UVs may differ at a shared edge and still agree, modulo
 * one repeat (FR-009, US3-S6): float32 rounding, not artistic tolerance. */
export const UV_AGREEMENT_EPSILON = 1e-4;

const PER_POSITION = 3;
const PER_UV = 2;

export function uvAt(uvs: ArrayLike<number>, vertex: number): readonly [number, number] {
  return [uvs[vertex * PER_UV]!, uvs[vertex * PER_UV + 1]!];
}

/** On a texture that wraps, 0.999 and 0.001 are neighbours. */
function wrappedDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % UV_REPEATS_PER_TILE;
  return Math.min(difference, UV_REPEATS_PER_TILE - difference);
}

/** Whether two faces sample the same texel where they meet (FR-009, US3-S6):
 * faces at a corner run U along different axes, but a corner is a tile boundary,
 * so both land on a whole repeat. */
export function uvsAgreeAtEdge(
  a: readonly [number, number],
  b: readonly [number, number],
  epsilon: number = UV_AGREEMENT_EPSILON,
): boolean {
  return wrappedDistance(a[0], b[0]) <= epsilon && wrappedDistance(a[1], b[1]) <= epsilon;
}

function dominantAxis(nx: number, ny: number, nz: number): 0 | 1 | 2 {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return 1;
  return ax >= az ? 0 : 2;
}

/** World-tile-space UVs, projected by the matching vertex normal (FR-009,
 * US3-S5). `positions` are the coordinates the geometry is drawn in: world for
 * 002's buffers, local for a door leaf that slides. */
export function computeTileUVs(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
): Float32Array {
  if (positions.length % PER_POSITION !== 0) {
    throw new Error(`positions length ${positions.length} is not a multiple of 3`);
  }
  if (normals.length !== positions.length) {
    throw new Error(
      `normals length ${normals.length} does not match positions length ${positions.length}`,
    );
  }

  const vertices = positions.length / PER_POSITION;
  const uvs = new Float32Array(vertices * PER_UV);
  const scale = UV_REPEATS_PER_TILE / UV_TILE_EDGE;

  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const p = vertex * PER_POSITION;
    const axis = dominantAxis(normals[p]!, normals[p + 1]!, normals[p + 2]!);
    uvs[vertex * PER_UV] = (axis === 0 ? positions[p + 2]! : positions[p]!) * scale;
    uvs[vertex * PER_UV + 1] = (axis === 1 ? positions[p + 2]! : positions[p + 1]!) * scale;
  }

  return uvs;
}
