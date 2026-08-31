// UVs in world-tile space (FR-009). One texture repeat per world tile edge, so a
// merged run of twenty tiles spans twenty UV units and reads as twenty bricks
// rather than one brick stretched across a corridor.
//
// The rule is deliberately a function of position alone, never of a vertex's
// index inside its quad: 002 merges every face of a wall type into one buffer, so
// a per-quad `0..1` parameterisation is exactly what a merge destroys. Deriving U
// and V from the world coordinates the face already has means a merge boundary is
// not a UV boundary — the seam between two merged faces is arithmetic that
// happens to land on an integer, and integers are where a repeating texture wraps
// to the same texel.
//
// Projection is by the face's dominant normal axis, which is all this level needs:
// every surface 002 and 004 emit is axis-aligned.
//
//   normal ±X  ->  U = z, V = y
//   normal ±Z  ->  U = x, V = y
//   normal ±Y  ->  U = x, V = z
//
// Pure: no three.js, no DOM. Positions may be a `BufferAttribute`'s array.

import { TILE_SIZE } from '../level';

/**
 * The world edge one texture repeat covers. Named here because FR-009 is stated
 * about the tile edge, and taken from 002's declaration so the two cannot drift.
 */
export const UV_TILE_EDGE = TILE_SIZE;

/** Repeats per tile edge. One: FR-009's "one texture repeat per world tile". */
export const UV_REPEATS_PER_TILE = 1;

/**
 * How far two faces' UVs may differ at an edge they share and still be called
 * agreeing (FR-009, US3-S6). A shared edge always lands on a tile boundary, so
 * agreement is agreement *modulo one repeat*: both faces sample the same texel of
 * a wrapping texture. The bound is float32 rounding on tile coordinates of this
 * level's size, not an artistic tolerance.
 */
export const UV_AGREEMENT_EPSILON = 1e-4;

export interface UvBounds {
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

const COMPONENTS_PER_POSITION = 3;
const COMPONENTS_PER_UV = 2;

/** One vertex's UV pair. */
export function uvAt(uvs: ArrayLike<number>, vertex: number): readonly [number, number] {
  return [uvs[vertex * COMPONENTS_PER_UV]!, uvs[vertex * COMPONENTS_PER_UV + 1]!];
}

/** The span a UV set covers, which for a merged run of N tiles is N (US3-S5). */
export function uvBounds(uvs: ArrayLike<number>): UvBounds {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let vertex = 0; vertex * COMPONENTS_PER_UV < uvs.length; vertex += 1) {
    const [u, v] = uvAt(uvs, vertex);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { minU, maxU, minV, maxV };
}

/** Distance between two coordinates on a texture that wraps every repeat — 0.999
 * and 0.001 are neighbours, not opposites. */
function wrappedDistance(a: number, b: number): number {
  const period = UV_REPEATS_PER_TILE;
  const difference = Math.abs(a - b) % period;
  return Math.min(difference, period - difference);
}

/**
 * Whether two faces sample the same texel where they meet (FR-009, US3-S6). Two
 * faces of one material meeting at a corner carry different U parameterisations —
 * one runs along X, the other along Z — but a corner is a tile boundary, so both
 * land on a whole repeat and the texture does not break across it.
 */
export function uvsAgreeAtEdge(
  a: readonly [number, number],
  b: readonly [number, number],
  epsilon: number = UV_AGREEMENT_EPSILON,
): boolean {
  return wrappedDistance(a[0], b[0]) <= epsilon && wrappedDistance(a[1], b[1]) <= epsilon;
}

/** Which axis a face looks along: 0 for X, 1 for Y, 2 for Z. */
function dominantAxis(nx: number, ny: number, nz: number): 0 | 1 | 2 {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return 1;
  return ax >= az ? 0 : 2;
}

/**
 * World-tile-space UVs for every vertex of `positions`, projected by the matching
 * vertex normal (FR-009, US3-S5, US3-S6). `positions` are the coordinates the
 * geometry is actually drawn in — world space for 002's merged buffers, and the
 * mesh's own local space for a door leaf that slides, so the texture travels with
 * the leaf instead of scrolling across it.
 */
export function computeTileUVs(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
): Float32Array {
  if (positions.length % COMPONENTS_PER_POSITION !== 0) {
    throw new Error(`positions length ${positions.length} is not a multiple of 3`);
  }
  if (normals.length !== positions.length) {
    throw new Error(
      `normals length ${normals.length} does not match positions length ${positions.length}`,
    );
  }

  const vertices = positions.length / COMPONENTS_PER_POSITION;
  const uvs = new Float32Array(vertices * COMPONENTS_PER_UV);
  const scale = UV_REPEATS_PER_TILE / UV_TILE_EDGE;

  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const p = vertex * COMPONENTS_PER_POSITION;
    const x = positions[p]!;
    const y = positions[p + 1]!;
    const z = positions[p + 2]!;
    const axis = dominantAxis(normals[p]!, normals[p + 1]!, normals[p + 2]!);

    const u = axis === 0 ? z : x;
    const v = axis === 1 ? z : y;

    uvs[vertex * COMPONENTS_PER_UV] = u * scale;
    uvs[vertex * COMPONENTS_PER_UV + 1] = v * scale;
  }

  return uvs;
}
