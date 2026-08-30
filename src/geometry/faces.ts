// Pure face emitter over the level grid. No three.js, no DOM (FR-004). It turns
// the grid into culled vertex data: a vertical face is emitted only where a
// solid tile borders open space, never between two solid tiles, and floor and
// ceiling quads cover every open tile exactly once (FR-008, FR-009).

export interface FaceData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface EmittedFaces {
  walls: Record<string, FaceData>;
  floor: FaceData;
  ceiling: FaceData;
}

const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

// A solid tile is a wall (1..9), a door (D) or a secret (S). Doors and secrets
// render as closed walls in this spec; M3 owns their behaviour.
function isSolid(cell: string): boolean {
  return (cell >= '1' && cell <= '9') || cell === 'D' || cell === 'S';
}

// An open tile is empty floor (0) or the exit (E): the tiles the player can
// stand on, which therefore get floor and ceiling quads.
function isOpen(cell: string): boolean {
  return cell === '0' || cell === 'E';
}

function cellAt(grid: string[], x: number, z: number): string {
  const row = grid[z];
  if (row === undefined) return ' ';
  return row[x] ?? ' ';
}

function allocateFaceData(quadCount: number): FaceData {
  return {
    positions: new Float32Array(quadCount * VERTICES_PER_QUAD * 3),
    normals: new Float32Array(quadCount * VERTICES_PER_QUAD * 3),
    uvs: new Float32Array(quadCount * VERTICES_PER_QUAD * 2),
    indices: new Uint32Array(quadCount * INDICES_PER_QUAD),
  };
}

type Vec3 = readonly [number, number, number];

const QUAD_UVS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

// Writes one quad (4 vertices, 2 triangles) into the pre-sized arrays at the
// given quad index. `corners` is 12 numbers: 4 corners × 3 coordinates, wound
// counter-clockwise when viewed from the outside so three.js renders the face
// as front-facing (US2-S6).
function writeQuad(
  data: FaceData,
  quadIndex: number,
  corners: readonly number[],
  normal: Vec3,
): void {
  const baseVertex = quadIndex * VERTICES_PER_QUAD;
  const baseIndex = quadIndex * INDICES_PER_QUAD;
  for (let i = 0; i < 4; i += 1) {
    const vi = baseVertex + i;
    data.positions[vi * 3] = corners[i * 3]!;
    data.positions[vi * 3 + 1] = corners[i * 3 + 1]!;
    data.positions[vi * 3 + 2] = corners[i * 3 + 2]!;
    data.normals[vi * 3] = normal[0];
    data.normals[vi * 3 + 1] = normal[1];
    data.normals[vi * 3 + 2] = normal[2];
    data.uvs[vi * 2] = QUAD_UVS[i]![0];
    data.uvs[vi * 2 + 1] = QUAD_UVS[i]![1];
  }
  data.indices[baseIndex] = baseVertex;
  data.indices[baseIndex + 1] = baseVertex + 1;
  data.indices[baseIndex + 2] = baseVertex + 2;
  data.indices[baseIndex + 3] = baseVertex;
  data.indices[baseIndex + 4] = baseVertex + 2;
  data.indices[baseIndex + 5] = baseVertex + 3;
}

const NORTH: Vec3 = [0, 0, -1];
const SOUTH: Vec3 = [0, 0, 1];
const EAST: Vec3 = [1, 0, 0];
const WEST: Vec3 = [-1, 0, 0];
const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];

export function emitFaces(grid: string[]): EmittedFaces {
  // First pass: count visible faces per solid type and open tiles, so the
  // typed arrays can be pre-sized (T014: O(visible faces), no per-tile objects).
  const wallFaceCounts: Record<string, number> = {};
  let openTileCount = 0;
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z]!;
    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x]!;
      if (isSolid(cell)) {
        let faces = 0;
        if (isOpen(cellAt(grid, x, z - 1))) faces += 1;
        if (isOpen(cellAt(grid, x, z + 1))) faces += 1;
        if (isOpen(cellAt(grid, x - 1, z))) faces += 1;
        if (isOpen(cellAt(grid, x + 1, z))) faces += 1;
        if (faces > 0) wallFaceCounts[cell] = (wallFaceCounts[cell] ?? 0) + faces;
      } else if (isOpen(cell)) {
        openTileCount += 1;
      }
    }
  }

  const walls: Record<string, FaceData> = {};
  for (const type of Object.keys(wallFaceCounts)) {
    walls[type] = allocateFaceData(wallFaceCounts[type]!);
  }
  const floor = allocateFaceData(openTileCount);
  const ceiling = allocateFaceData(openTileCount);

  // Second pass: emit faces into the pre-sized arrays.
  const wallCursors: Record<string, number> = {};
  for (const type of Object.keys(walls)) wallCursors[type] = 0;
  let floorCursor = 0;
  let ceilingCursor = 0;

  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z]!;
    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x]!;
      if (isSolid(cell)) {
        const data = walls[cell]!;
        if (isOpen(cellAt(grid, x, z - 1))) {
          writeQuad(data, wallCursors[cell]!, [x + 1, 0, z, x, 0, z, x, 2, z, x + 1, 2, z], NORTH);
          wallCursors[cell]! += 1;
        }
        if (isOpen(cellAt(grid, x, z + 1))) {
          writeQuad(data, wallCursors[cell]!, [x, 0, z + 1, x + 1, 0, z + 1, x + 1, 2, z + 1, x, 2, z + 1], SOUTH);
          wallCursors[cell]! += 1;
        }
        if (isOpen(cellAt(grid, x - 1, z))) {
          writeQuad(data, wallCursors[cell]!, [x, 0, z, x, 0, z + 1, x, 2, z + 1, x, 2, z], WEST);
          wallCursors[cell]! += 1;
        }
        if (isOpen(cellAt(grid, x + 1, z))) {
          writeQuad(data, wallCursors[cell]!, [x + 1, 0, z + 1, x + 1, 0, z, x + 1, 2, z, x + 1, 2, z + 1], EAST);
          wallCursors[cell]! += 1;
        }
      } else if (isOpen(cell)) {
        writeQuad(floor, floorCursor, [x, 0, z, x, 0, z + 1, x + 1, 0, z + 1, x + 1, 0, z], UP);
        floorCursor += 1;
        writeQuad(ceiling, ceilingCursor, [x, 2, z, x + 1, 2, z, x + 1, 2, z + 1, x, 2, z + 1], DOWN);
        ceilingCursor += 1;
      }
    }
  }

  return { walls, floor, ceiling };
}
