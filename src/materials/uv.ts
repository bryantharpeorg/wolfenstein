// World-tile-space UVs (FR-009). A vertex's UV is read off its world position
// rather than off its index within a quad, which is the whole point: 002 merges
// a wall run of N tiles into one geometry, and a per-quad 0..1 UV would stretch
// one brick across all N of them. Reading the position instead makes the merge
// boundary invisible — two quads that share a world edge share its UV exactly,
// and two faces meeting at a corner meet on a whole-tile boundary.
//
// Pure arithmetic over position and normal arrays. No three.js, no DOM: the
// system module transforms a geometry into world space and hands the numbers in.

import { TILE_SIZE } from '../level';

/** One texture repeat per world tile edge (FR-009, US3-S5). */
export const UV_TILE_EDGE = TILE_SIZE;

/**
 * How far apart two UVs may be at a shared world edge and still count as
 * agreeing (FR-009, US3-S6). World positions arrive as float32, so a coordinate
 * that survived a matrix multiply is exact only to about a part in 10^7; this is
 * a float32 rounding tolerance, not a slack budget for a real seam.
 */
export const UV_AGREEMENT_EPSILON = 1e-5;

/** The world axis a face's plane is perpendicular to. */
export type SurfaceAxis = 'x' | 'y' | 'z';

/**
 * The axis a face faces along, from its normal. Ties, and a degenerate zero
 * normal, resolve to 'y': a deterministic answer keeps a malformed geometry
 * rendering with tiled floor UVs rather than aborting the level build.
 */
export function dominantAxis(nx: number, ny: number, nz: number): SurfaceAxis {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return 'y';
  return ax >= az ? 'x' : 'z';
}

/**
 * UVs for every vertex, in tiles. A horizontal face is tiled by (x, z); a face
 * standing on the x axis by (z, y); one standing on the z axis by (x, y). Height
 * is tiled on the same edge as width, so a two-tile-tall wall shows two repeats
 * and no face is stretched (US3-S5).
 */
export function computeTileUVs(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  tileEdge: number = UV_TILE_EDGE,
): Float32Array {
  if (positions.length % 3 !== 0) {
    throw new Error(`positions length ${positions.length} is not a multiple of 3`);
  }
  if (positions.length !== normals.length) {
    throw new Error(
      `positions and normals disagree: ${positions.length} against ${normals.length}`,
    );
  }
  if (!(tileEdge > 0)) {
    throw new Error(`tile edge must be positive, got ${tileEdge}`);
  }

  const vertexCount = positions.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v += 1) {
    const at = v * 3;
    const x = positions[at]!;
    const y = positions[at + 1]!;
    const z = positions[at + 2]!;
    let u: number;
    let w: number;
    switch (dominantAxis(normals[at]!, normals[at + 1]!, normals[at + 2]!)) {
      case 'y':
        u = x;
        w = z;
        break;
      case 'x':
        u = z;
        w = y;
        break;
      default:
        u = x;
        w = y;
        break;
    }
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

/** The extent a UV set covers, in repeats. Empty input spans nothing. */
export function uvBounds(uvs: ArrayLike<number>): UvBounds {
  if (uvs.length === 0) return { minU: 0, maxU: 0, minV: 0, maxV: 0 };
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const u = uvs[i]!;
    const v = uvs[i + 1]!;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { minU, maxU, minV, maxV };
}
