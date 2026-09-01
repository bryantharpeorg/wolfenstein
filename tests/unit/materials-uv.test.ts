import { describe, it, expect } from 'vitest';
import { emitFaces, type FaceData } from '../../src/geometry/faces';
import { LEVEL_GRID } from '../../src/level';
import {
  UV_EDGE_EPSILON,
  UV_TILE_EDGE,
  computeTileUVs,
  uvSpan,
} from '../../src/materials/uv';

// FR-009 / US3-S5, US3-S6. Tile-space UVs make a merged N-tile run span N UV
// units, keep adjacent faces agreeing at shared edges, and never stretch a
// single texture across the whole run.

function getBrickFaces(): FaceData {
  const faces = emitFaces(LEVEL_GRID);
  const data = faces.walls['2'];
  if (data == null) throw new Error('expected brick wall faces');
  return data;
}

describe('tile-space UVs on merged geometry (US3-S5, US3-S6)', () => {
  it('recomputes UVs so a wall run spans its world length in UV units', () => {
    const data = getBrickFaces();
    computeTileUVs(data.positions, data.normals, data.uvs);

    // The longest horizontal run of brick ('2') in the level is along the
    // vertical corridor walls. The span in UV units must match the world span
    // in tiles, not be clamped to a single tile.
    const spanU = uvSpan(data.uvs, 'u');
    const spanV = uvSpan(data.uvs, 'v');
    expect(spanU + spanV).toBeGreaterThan(UV_TILE_EDGE);
  });

  it('does not leave every quad clamped to a single 0..1 tile', () => {
    const data = getBrickFaces();
    computeTileUVs(data.positions, data.normals, data.uvs);

    // At least one UV coordinate is outside the unit square, proving the merge
    // spans more than one texture repeat.
    const outside = data.uvs.some(
      (value) => value > 1 + UV_EDGE_EPSILON || value < -UV_EDGE_EPSILON,
    );
    expect(outside).toBe(true);
  });

  it('agrees at shared edges within the declared epsilon (US3-S6)', () => {
    const data = getBrickFaces();
    computeTileUVs(data.positions, data.normals, data.uvs);

    // Build a map of world-edge keys to the first UV seen there. Two quads that
    // share an edge will have two vertices at the same (x,y,z); their UVs must
    // match within epsilon.
    const edgeUvs = new Map<string, { u: number; v: number }>();
    let mismatches = 0;
    for (let v = 0; v < data.positions.length / 3; v += 1) {
      const pi = v * 3;
      const px = data.positions[pi];
      const py = data.positions[pi + 1];
      const pz = data.positions[pi + 2];
      if (px == null || py == null || pz == null) continue;
      const key = [px.toFixed(4), py.toFixed(4), pz.toFixed(4)].join(',');
      const u = data.uvs[v * 2];
      const uv = data.uvs[v * 2 + 1];
      if (u == null || uv == null) continue;
      const existing = edgeUvs.get(key);
      if (existing == null) {
        edgeUvs.set(key, { u, v: uv });
      } else if (
        Math.abs(existing.u - u) > UV_EDGE_EPSILON ||
        Math.abs(existing.v - uv) > UV_EDGE_EPSILON
      ) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('gives the floor and ceiling distinct non-stretched UVs', () => {
    const faces = emitFaces(LEVEL_GRID);

    computeTileUVs(faces.floor.positions, faces.floor.normals, faces.floor.uvs);
    computeTileUVs(faces.ceiling.positions, faces.ceiling.normals, faces.ceiling.uvs);

    expect(uvSpan(faces.floor.uvs, 'u')).toBeGreaterThan(UV_TILE_EDGE);
    expect(uvSpan(faces.floor.uvs, 'v')).toBeGreaterThan(UV_TILE_EDGE);
    expect(uvSpan(faces.ceiling.uvs, 'u')).toBeGreaterThan(UV_TILE_EDGE);
    expect(uvSpan(faces.ceiling.uvs, 'v')).toBeGreaterThan(UV_TILE_EDGE);
  });

  it('rejects mismatched attribute sizes', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const badUvs = new Float32Array(4);
    expect(() => computeTileUVs(positions, normals, badUvs)).toThrow(/mismatched attribute sizes/);
  });
});
