import { describe, it, expect } from 'vitest';
import { emitFaces, type FaceData } from '../../src/geometry/faces';
import { LEVEL_GRID } from '../../src/level';

// A face is a quad: 4 vertices, 2 triangles, 6 indices. The emitter writes one
// quad per visible face, so the number of quads is `indices.length / 6` and the
// number of vertices is `positions.length / 3`.

function countQuads(data: FaceData): number {
  return data.indices.length / 6;
}

function countVertices(data: FaceData): number {
  return data.positions.length / 3;
}

function countWallQuads(walls: Record<string, FaceData>): number {
  return Object.values(walls).reduce((sum, data) => sum + countQuads(data), 0);
}

function countWallVertices(walls: Record<string, FaceData>): number {
  return Object.values(walls).reduce((sum, data) => sum + countVertices(data), 0);
}

describe('emitFaces', () => {
  it('emits exactly 12 vertical faces for a solid 3x3 block in open space', () => {
    const grid = ['00000', '01110', '01110', '01110', '00000'];
    const faces = emitFaces(grid);
    // 3 faces per side × 4 sides = 12 perimeter faces, zero interior faces.
    expect(countWallQuads(faces.walls)).toBe(12);
  });

  it('emits zero faces between two adjacent solid tiles', () => {
    // The 3x3 block has 12 interior adjacencies; each would produce two faces
    // if not culled. The perimeter-only count of 12 proves none were emitted.
    const grid = ['00000', '01110', '01110', '01110', '00000'];
    const faces = emitFaces(grid);
    expect(countWallQuads(faces.walls)).toBe(12);
  });

  it('contributes zero vertices for a wall tile with four solid neighbours', () => {
    // The center tile (2,2) is enclosed. 12 perimeter faces × 4 vertices = 48;
    // if the enclosed tile were emitted the count would be 64.
    const grid = ['00000', '01110', '01110', '01110', '00000'];
    const faces = emitFaces(grid);
    expect(countWallVertices(faces.walls)).toBe(48);
  });

  it('emits one floor and one ceiling quad per open tile, with no duplicates', () => {
    const grid = ['00000', '01110', '01110', '01110', '00000'];
    const faces = emitFaces(grid);
    // 16 open tiles, each covered exactly once.
    expect(countQuads(faces.floor)).toBe(16);
    expect(countQuads(faces.ceiling)).toBe(16);
  });

  it('emits the hand-computed perimeter-only wall-face count for the shipped grid', () => {
    const faces = emitFaces(LEVEL_GRID);
    // Hand-computed: 240 border + 118 brick + 116 metal + 116 wood + 116 panel
    // + 10 door + 4 secret = 720 visible vertical faces.
    expect(countWallQuads(faces.walls)).toBe(720);
  });

  it('emits one floor and one ceiling quad per open tile for the shipped grid', () => {
    const faces = emitFaces(LEVEL_GRID);
    // 3605 open tiles ('0' and 'E'), each covered exactly once.
    expect(countQuads(faces.floor)).toBe(3605);
    expect(countQuads(faces.ceiling)).toBe(3605);
  });

  it('groups wall faces by wall type ID, one entry per distinct type', () => {
    const faces = emitFaces(LEVEL_GRID);
    const types = Object.keys(faces.walls).sort();
    expect(types).toEqual(['1', '2', '3', '4', '5', 'D', 'S']);
  });
});
