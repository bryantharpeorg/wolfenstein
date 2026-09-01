// World-tile-space UVs (FR-009, US4-S1, US4-S2).
//
// The rule is one line long: a vertex's UV is its world position, on the two
// axes its face does not point along, divided by the tile edge. Everything the
// story asks for falls out of that.
//
//   * A merged run of N tiles spans N UV units, because the run's ends are N
//     world units apart and nothing here knows how many quads lie between them.
//     One face or twenty, the numbers are the same — so a merge boundary is
//     never a UV boundary and a 20-tile wall reads as twenty bricks.
//   * Two faces that meet at a corner land on the same point of the repeat,
//     because tile corners are at integer world coordinates and the repeat is
//     one world tile: whichever axis each face measures, both read a whole
//     number of repeats there.
//
// Deliberately *not* done: mirroring U on back-facing quads. It would tidy the
// handedness of a single face and break both properties above, since the UV
// would then depend on which face you asked rather than on where you stood.

import { TILE_SIZE } from '../level';

/** World units per texture repeat: one tile edge, which is the whole point. */
export const TILE_EDGE_UNITS = TILE_SIZE;

/** How far apart two UVs may sit, around the repeat, and still be "the same
 *  texel" — the declared epsilon of US4-S2. Generous next to float error at
 *  level scale, and far tighter than one texel of the declared map size, which
 *  is the scale at which a mismatch becomes a visible seam. */
export const UV_AGREEMENT_EPSILON = 1e-4;

/** The extent a UV set covers on each axis, in repeats. */
export interface UVSpan {
  readonly u: number;
  readonly v: number;
}

/**
 * Distance between two UV coordinates *around* the repeat. Texture wrapping
 * makes u and u+1 the same texel, so agreement is a question about the unit
 * circle, not about the number line.
 */
export function repeatDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 1;
  return Math.min(raw, 1 - raw);
}

/** Whether two vertices sample the same texel, within the declared epsilon. */
export function uvsAgree(
  a: readonly [number, number],
  b: readonly [number, number],
  epsilon: number = UV_AGREEMENT_EPSILON,
): boolean {
  return repeatDistance(a[0], b[0]) <= epsilon && repeatDistance(a[1], b[1]) <= epsilon;
}

/** The span of a UV buffer, for asserting a run covers as many repeats as it
 *  covers tiles rather than being stretched across one. */
export function uvSpan(uvs: Float32Array): UVSpan {
  if (uvs.length === 0) return { u: 0, v: 0 };
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let vertex = 0; vertex < uvs.length / 2; vertex += 1) {
    const u = uvs[vertex * 2]!;
    const v = uvs[vertex * 2 + 1]!;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  return { u: uMax - uMin, v: vMax - vMin };
}

/**
 * UVs for a merged geometry, in world-tile space at one repeat per tile edge.
 *
 * Pure: positions and normals in, a new UV buffer out. No three.js, no DOM, so
 * the tiling rule is decided by `npm run test` rather than by looking at it.
 */
export function computeTileUVs(
  positions: Float32Array,
  normals: Float32Array,
  tileEdge: number = TILE_EDGE_UNITS,
): Float32Array {
  if (positions.length % 3 !== 0) {
    throw new Error(`positions length ${positions.length} is not a whole number of vertices`);
  }
  if (normals.length !== positions.length) {
    throw new Error(
      `normals length ${normals.length} does not match positions length ${positions.length}`,
    );
  }
  if (!(tileEdge > 0)) {
    throw new Error(`tile edge must be positive, got ${tileEdge}`);
  }

  const vertices = positions.length / 3;
  const uvs = new Float32Array(vertices * 2);
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const x = positions[vertex * 3]!;
    const y = positions[vertex * 3 + 1]!;
    const z = positions[vertex * 3 + 2]!;
    const nx = Math.abs(normals[vertex * 3]!);
    const ny = Math.abs(normals[vertex * 3 + 1]!);
    const nz = Math.abs(normals[vertex * 3 + 2]!);

    // Project along the face's dominant axis: floors and ceilings measure the
    // ground plane, walls measure their own run and their height.
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }

    uvs[vertex * 2] = u / tileEdge;
    uvs[vertex * 2 + 1] = v / tileEdge;
  }
  return uvs;
}

/** Vertices per emitted quad, matching `src/geometry/faces.ts`'s layout. */
const VERTICES_PER_QUAD = 4;

/**
 * How many quads carry a UV span that disagrees with their world extent in
 * tiles — that is, how many faces are stretched or squashed (US4-S1).
 *
 * Pure, and therefore shared: the unit test asserts it over the built level,
 * and the running page reports it through the materials probe, so the claim is
 * made once and checked in both places rather than restated in the harness.
 */
export function countStretchedQuads(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  tileEdge: number = TILE_EDGE_UNITS,
  epsilon: number = UV_AGREEMENT_EPSILON,
): number {
  const vertices = positions.length / 3;
  if (uvs.length !== vertices * 2 || vertices % VERTICES_PER_QUAD !== 0) {
    throw new Error(`UV buffer of ${uvs.length} does not describe ${vertices} quad vertices`);
  }

  let stretched = 0;
  for (let quad = 0; quad < vertices / VERTICES_PER_QUAD; quad += 1) {
    const first = quad * VERTICES_PER_QUAD;
    const nx = Math.abs(normals[first * 3]!);
    const ny = Math.abs(normals[first * 3 + 1]!);
    const nz = Math.abs(normals[first * 3 + 2]!);
    const uAxis = ny >= nx && ny >= nz ? 0 : nx >= nz ? 2 : 0;
    const vAxis = ny >= nx && ny >= nz ? 2 : 1;

    let worldU = 0;
    let worldV = 0;
    let spanU = 0;
    let spanV = 0;
    for (let a = 0; a < VERTICES_PER_QUAD; a += 1) {
      for (let b = a + 1; b < VERTICES_PER_QUAD; b += 1) {
        const pa = (first + a) * 3;
        const pb = (first + b) * 3;
        worldU = Math.max(worldU, Math.abs(positions[pa + uAxis]! - positions[pb + uAxis]!));
        worldV = Math.max(worldV, Math.abs(positions[pa + vAxis]! - positions[pb + vAxis]!));
        spanU = Math.max(spanU, Math.abs(uvs[(first + a) * 2]! - uvs[(first + b) * 2]!));
        spanV = Math.max(spanV, Math.abs(uvs[(first + a) * 2 + 1]! - uvs[(first + b) * 2 + 1]!));
      }
    }
    if (Math.abs(spanU - worldU / tileEdge) > epsilon || Math.abs(spanV - worldV / tileEdge) > epsilon) {
      stretched += 1;
    }
  }
  return stretched;
}
