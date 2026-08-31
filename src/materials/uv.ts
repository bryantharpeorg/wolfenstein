// World-tile-space UVs (FR-009). A vertex's UV is read off its world position,
// not off its index within a quad: 002 merges a run of N tiles into one geometry
// and a per-quad 0..1 UV would stretch one brick across all N. Reading the
// position makes the merge boundary invisible — two quads sharing a world edge
// share its UV. Pure arithmetic; the system hands in world-space numbers.

import { TILE_SIZE } from '../level';

/** One texture repeat per world tile edge (FR-009, US3-S5). */
export const UV_TILE_EDGE = TILE_SIZE;

/** How far apart two UVs may be at a shared world edge and still agree (FR-009,
 *  US3-S6). Float32 through a matrix multiply is exact to about a part in 10^7:
 *  a rounding tolerance, not a slack budget for a real seam. */
export const UV_AGREEMENT_EPSILON = 1e-5;

/** The axis a face's plane is perpendicular to. */
export type SurfaceAxis = 'x' | 'y' | 'z';

/** The axis a face faces along. Ties and a degenerate zero normal resolve to
 *  'y': a malformed geometry keeps rendering rather than aborting the build. */
export function dominantAxis(nx: number, ny: number, nz: number): SurfaceAxis {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return 'y';
  return ax >= az ? 'x' : 'z';
}

/** UVs for every vertex, in tiles: a horizontal face by (x, z), one standing on
 *  x by (z, y), one standing on z by (x, y). Height tiles on the same edge as
 *  width, so a two-tile wall shows two repeats and nothing stretches (US3-S5). */
export function computeTileUVs(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  tileEdge: number = UV_TILE_EDGE,
): Float32Array {
  if (positions.length % 3 !== 0) {
    throw new Error(`positions length ${positions.length} is not a multiple of 3`);
  }
  if (positions.length !== normals.length) {
    throw new Error(`positions and normals disagree: ${positions.length} against ${normals.length}`);
  }
  if (!(tileEdge > 0)) throw new Error(`tile edge must be positive, got ${tileEdge}`);

  const vertexCount = positions.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v += 1) {
    const at = v * 3;
    const x = positions[at]!;
    const y = positions[at + 1]!;
    const z = positions[at + 2]!;
    const axis = dominantAxis(normals[at]!, normals[at + 1]!, normals[at + 2]!);
    const u = axis === 'x' ? z : x;
    const w = axis === 'y' ? z : y;
    uvs[v * 2] = u / tileEdge;
    uvs[v * 2 + 1] = w / tileEdge;
  }
  return uvs;
}

export interface UvBounds {
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

/** The extent a UV set covers, in repeats; empty input spans nothing. */
export function uvBounds(uvs: ArrayLike<number>): UvBounds {
  if (uvs.length === 0) return { minU: 0, maxU: 0, minV: 0, maxV: 0 };
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    minU = Math.min(minU, uvs[i]!);
    maxU = Math.max(maxU, uvs[i]!);
    minV = Math.min(minV, uvs[i + 1]!);
    maxV = Math.max(maxV, uvs[i + 1]!);
  }
  return { minU, maxU, minV, maxV };
}
