// World-tile-space UVs (FR-009). Each world-tile edge is one texture repeat, so
// a merged run of N tiles spans N UV units on its long axis and adjacent faces
// of the same material agree at their shared edge within the declared epsilon.
//
// The projection axis is chosen per vertex from that vertex's own normal, not
// once for the whole buffer. 002 merges every face of one wall type into a
// single BufferGeometry, and that buffer holds faces running along X *and*
// faces running along Z; a single axis chosen from the first quad collapses
// every face of the other orientation to a constant U — one texel smeared
// across the whole wall, which is exactly the stretch FR-009 forbids.

import { TILE_SIZE } from '../level';

/** One texture repeat per world-tile edge (FR-009). */
export const UV_TILE_EDGE = TILE_SIZE;

/** Maximum allowed UV mismatch at a shared edge, in UV units. Tight enough that
 * only float drift fits under it: a real disagreement is a fraction of a tile,
 * four orders of magnitude larger. */
export const UV_EDGE_EPSILON = 1e-4;

/** World-space offset added before projection, for geometry whose vertices are
 * local to a placed mesh rather than already in world space. */
export type WorldOffset = readonly [x: number, y: number, z: number];

const NO_OFFSET: WorldOffset = [0, 0, 0];

/**
 * Recomputes the `uv` attribute for every vertex so that one texture repeat
 * spans one world-tile edge (FR-009, US4-S1, US4-S2).
 *
 * `positions` and `normals` are the geometry attributes. `uvs` is written in
 * place when supplied — the merged level buffers already own one — and
 * allocated when it is not. `offset` is added to each position first, so a door
 * leaf built as a box around its own origin lands on the same tile lattice as
 * the wall it sits in.
 *
 * Pure: nothing outside `uvs` is touched, and the same inputs always give the
 * same output.
 */
export function computeTileUVs(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array = new Float32Array((positions.length / 3) * 2),
  offset: WorldOffset = NO_OFFSET,
): Float32Array {
  if (positions.length !== normals.length || uvs.length !== (positions.length / 3) * 2) {
    throw new Error(
      `computeTileUVs: mismatched attribute sizes (positions=${positions.length}, normals=${normals.length}, uvs=${uvs.length})`,
    );
  }

  const vertexCount = positions.length / 3;
  for (let v = 0; v < vertexCount; v += 1) {
    const i = v * 3;
    const x = (positions[i] ?? 0) + offset[0];
    const y = (positions[i + 1] ?? 0) + offset[1];
    const z = (positions[i + 2] ?? 0) + offset[2];

    const nx = Math.abs(normals[i] ?? 0);
    const ny = Math.abs(normals[i + 1] ?? 0);
    const nz = Math.abs(normals[i + 2] ?? 0);

    let u: number;
    let w: number;
    if (ny >= nx && ny >= nz) {
      // Floor and ceiling: the plane is horizontal, so both UV axes are.
      u = x;
      w = z;
    } else if (nx >= nz) {
      // A face whose normal runs along X spans Z horizontally and Y vertically.
      u = z;
      w = y;
    } else {
      // A face whose normal runs along Z spans X horizontally and Y vertically.
      u = x;
      w = y;
    }

    uvs[v * 2] = u / UV_TILE_EDGE;
    uvs[v * 2 + 1] = w / UV_TILE_EDGE;
  }

  return uvs;
}

/**
 * Convenience helper: the UV span of a merged run is the absolute difference
 * between the min and max UV on the axis that changes. This is the value unit
 * tests assert equals N tiles (US4-S1).
 */
export function uvSpan(uvs: Float32Array, axis: 'u' | 'v' = 'u'): number {
  let min = Infinity;
  let max = -Infinity;
  const offset = axis === 'u' ? 0 : 1;
  for (let i = offset; i < uvs.length; i += 2) {
    const value = uvs[i];
    if (value == null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}
