// World-tile-space UVs (FR-009). Each world-tile edge is one texture repeat, so
// a merged run of N tiles spans N UV units on its long axis and adjacent faces
// of the same material agree at their shared edge within the declared epsilon.

import { TILE_SIZE } from '../level';

/** One texture repeat per world-tile edge (FR-009). */
export const UV_TILE_EDGE = TILE_SIZE;

/** Maximum allowed UV mismatch at a shared edge, in UV units. */
export const UV_EDGE_EPSILON = 1e-4;

/** Up/Down face normals for ceiling and floor. */
const UP = 1;
const DOWN = -1;

/** For vertical faces, the world axis along which the quad runs determines
 * which UV component comes from which world coordinate. */
function verticalUvs(positions: Float32Array, out: Float32Array): void {
  // Two corners in XZ determine the axis. We project every vertex onto the
  // dominant horizontal axis and use world Y for the vertical UV.
  const x0 = positions[0] ?? 0;
  const x1 = positions[3] ?? 0;
  const z0 = positions[2] ?? 0;
  const z1 = positions[5] ?? 0;
  const spanX = Math.abs(x1 - x0);
  const spanZ = Math.abs(z1 - z0);
  const useZ = spanZ >= spanX;

  for (let v = 0; v < positions.length / 3; v += 1) {
    const i = v * 3;
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    out[v * 2] = useZ ? z / UV_TILE_EDGE : x / UV_TILE_EDGE;
    out[v * 2 + 1] = y / UV_TILE_EDGE;
  }
}

/** For horizontal faces (floor/ceiling), UVs come directly from XZ in world
 * tile space. */
function horizontalUvs(positions: Float32Array, out: Float32Array): void {
  for (let v = 0; v < positions.length / 3; v += 1) {
    const i = v * 3;
    out[v * 2] = (positions[i] ?? 0) / UV_TILE_EDGE;
    out[v * 2 + 1] = (positions[i + 2] ?? 0) / UV_TILE_EDGE;
  }
}

/**
 * Recomputes the `uv` attribute for every vertex in a merged `BufferGeometry`
 * so that one texture repeat spans one world tile edge. `positions` and
 * `normals` are the geometry attributes; `uvs` is written in place and must be
 * the same length as `positions.length / 3 * 2` (FR-009, US3-S5, US3-S6).
 */
export function computeTileUVs(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
): void {
  if (positions.length !== normals.length || uvs.length !== (positions.length / 3) * 2) {
    throw new Error(
      `computeTileUVs: mismatched attribute sizes (positions=${positions.length}, normals=${normals.length}, uvs=${uvs.length})`,
    );
  }

  // All vertices of a merged face group share a normal axis. Use the first
  // vertex to decide whether this geometry is horizontal or vertical.
  const ny = normals[1] ?? 0;
  if (ny === UP || ny === DOWN || Math.abs(ny) > 0.9) {
    horizontalUvs(positions, uvs);
  } else {
    verticalUvs(positions, uvs);
  }
}

/**
 * Convenience helper: the UV span of a merged run is the absolute difference
 * between the min and max UV on the axis that changes. This is the value unit
 * tests assert equals N tiles (US3-S5).
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
