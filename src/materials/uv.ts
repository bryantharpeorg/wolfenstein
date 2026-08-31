// World-tile-space UVs (FR-009): a vertex's UV is its own world position
// projected down the face's dominant axis, so a merged run of N tiles spans N
// UV units, a merge boundary is not a UV boundary, and a tile corner is a whole
// number of repeats. 002 writes each quad the unit square, which would stretch
// one brick across a twenty-tile corridor.

import { TILE_SIZE } from '../level';

/** World distance one repeat covers, and how many repeats that is. */
export const UV_TILE_EDGE = TILE_SIZE;
export const UV_REPEATS_PER_TILE = 1;

/** Float slack at a shared edge (US3-S6). The true difference is an integer. */
export const UV_AGREEMENT_EPSILON = 1e-4;

const AXIS_DOMINANCE = 0.5;

/**
 * UVs for every vertex, from parallel world-space `positions` and `normals`, so
 * the result writes back as the geometry's `uv` attribute. A horizontal face
 * takes U from X and V from Z; one across X takes U from Z and V from Y; one
 * across Z takes U from X and V from Y. Nothing is flipped — a flip would break
 * the corner agreement.
 */
export function computeTileUVs(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
): Float32Array {
  if (positions.length !== normals.length) {
    throw new Error(`computeTileUVs: ${positions.length} positions, ${normals.length} normals`);
  }
  const uvs = new Float32Array(Math.floor(positions.length / 3) * 2);
  const scale = UV_REPEATS_PER_TILE / UV_TILE_EDGE;

  for (let v = 0; v * 2 < uvs.length; v += 1) {
    const at = v * 3;
    const nx = Math.abs(normals[at]!);
    const ny = Math.abs(normals[at + 1]!);
    const nz = Math.abs(normals[at + 2]!);
    const horizontal = ny >= nx && ny >= nz && ny > AXIS_DOMINANCE;
    uvs[v * 2] = (!horizontal && nx >= nz ? positions[at + 2]! : positions[at]!) * scale;
    uvs[v * 2 + 1] = (horizontal ? positions[at + 2]! : positions[at + 1]!) * scale;
  }
  return uvs;
}

/** The UV rectangle a set covers — the span US3-S5 is stated over. */
export function uvSpan(uvs: ArrayLike<number>): { u: number; v: number } {
  let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    minU = Math.min(minU, uvs[i]!);
    maxU = Math.max(maxU, uvs[i]!);
    minV = Math.min(minV, uvs[i + 1]!);
    maxV = Math.max(maxV, uvs[i + 1]!);
  }
  return { u: maxU - minU, v: maxV - minV };
}

/** Whether two UVs sample the same texel under `RepeatWrapping` (US3-S6):
 * coplanar faces at a merge differ by zero, perpendicular ones by an integer. */
export function uvsAgree(a: number, b: number, epsilon: number = UV_AGREEMENT_EPSILON): boolean {
  const difference = (a - b) / UV_REPEATS_PER_TILE;
  return Math.abs(difference - Math.round(difference)) <= epsilon;
}
