import { describe, it, expect, beforeEach } from 'vitest';
import {
  CEILING_Y,
  DEFAULT_WALL_MATERIAL,
  DOOR_LOCKS,
  FLOOR_Y,
  LEVEL_GRID,
  WALL_MATERIALS,
} from '../../src/level';
import { emitFaces } from '../../src/geometry/faces';
import { MATERIAL_NAMES } from '../../src/materials/table';
import type { MaterialName } from '../../src/materials/table';
import {
  CEILING_MATERIAL,
  DEFAULT_MATERIAL,
  DOOR_MATERIAL,
  FLOOR_MATERIAL,
  SECRET_MATERIAL,
  WALL_TYPE_MATERIALS,
  adjacentWallMaterials,
  bindSurface,
  classifySurface,
  declaredWallTypes,
  materialForWallType,
  wallMaterialNames,
} from '../../src/materials/bindings';
import {
  materialDiagnostics,
  resetMaterialDiagnostics,
} from '../../src/materials/diagnostics';

// FR-008 / US3-S1, US3-S3, US3-S4: every wall type ID 002 declares resolves to
// exactly one of US1's five materials; an ID with no entry resolves to 002's
// declared default rather than to nothing; and doors, secrets, floor and ceiling
// each carry a declared material of their own.

beforeEach(() => {
  resetMaterialDiagnostics();
});

describe('every wall type ID 002 declares', () => {
  it('is covered by the binding table', () => {
    expect(declaredWallTypes()).toEqual(Object.keys(WALL_MATERIALS).sort());
    for (const type of declaredWallTypes()) {
      expect(Object.keys(WALL_TYPE_MATERIALS)).toContain(type);
    }
  });

  it.each(Object.keys(WALL_MATERIALS))('maps %s to exactly one of the five materials', (type) => {
    const resolved = materialForWallType(type);
    expect(MATERIAL_NAMES).toContain(resolved.material);
    expect(resolved.fallback).toBe(false);
    // "Exactly one": the table holds a single name, not a list.
    expect(typeof WALL_TYPE_MATERIALS[type]).toBe('string');
  });

  it('names only materials the table declares', () => {
    for (const name of Object.values(WALL_TYPE_MATERIALS)) {
      expect(MATERIAL_NAMES).toContain(name);
    }
  });
});

describe('a wall type ID with no entry', () => {
  it("resolves to 002's declared default material rather than to nothing", () => {
    const resolved = materialForWallType('7');
    expect(resolved.material).toBe(DEFAULT_MATERIAL);
    expect(MATERIAL_NAMES).toContain(resolved.material);
    expect(resolved.fallback).toBe(true);
    // 002 declares the default by name; this binding stands in for that entry.
    expect(DEFAULT_WALL_MATERIAL.name).toBe('default');
  });

  it('records the substitution as a fallback rather than failing silently', () => {
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
    bindSurface({ kind: 'wall', type: '8' });
    const fallbacks = materialDiagnostics().fallbacks;
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.name).toBe(DEFAULT_MATERIAL);
    expect(fallbacks[0]!.map).toBe('binding');
    expect(fallbacks[0]!.reason).toContain('8');
  });

  it('records one entry per unmapped id, not one per mesh', () => {
    bindSurface({ kind: 'wall', type: '8' });
    bindSurface({ kind: 'wall', type: '8' });
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
  });

  it('records nothing for a declared id', () => {
    for (const type of declaredWallTypes()) bindSurface({ kind: 'wall', type });
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });
});

describe('doors and secrets', () => {
  it('each carry a declared material from the same table', () => {
    expect(MATERIAL_NAMES).toContain(DOOR_MATERIAL);
    expect(MATERIAL_NAMES).toContain(SECRET_MATERIAL);
    expect(bindSurface({ kind: 'door' }).material).toBe(DOOR_MATERIAL);
    expect(bindSurface({ kind: 'secret' }).material).toBe(SECRET_MATERIAL);
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });

  it('read as a door before they are touched: every door differs from the wall beside it', () => {
    const doorTiles = Object.keys(DOOR_LOCKS).map((key) => {
      const [x, z] = key.split(',').map(Number);
      return { x: x!, z: z! };
    });
    expect(doorTiles.length).toBeGreaterThan(0);
    for (const tile of doorTiles) {
      const beside = adjacentWallMaterials(LEVEL_GRID, tile.x, tile.z);
      expect(beside.length).toBeGreaterThan(0);
      expect(beside).not.toContain(DOOR_MATERIAL);
    }
  });

  it('every secret differs from the wall it is embedded in', () => {
    const secrets: Array<{ x: number; z: number }> = [];
    LEVEL_GRID.forEach((row, z) => {
      [...row].forEach((cell, x) => {
        if (cell === 'S') secrets.push({ x, z });
      });
    });
    expect(secrets.length).toBeGreaterThan(0);
    for (const tile of secrets) {
      const beside = adjacentWallMaterials(LEVEL_GRID, tile.x, tile.z);
      expect(beside.length).toBeGreaterThan(0);
      expect(beside).not.toContain(SECRET_MATERIAL);
    }
  });
});

describe('floor and ceiling', () => {
  it('each carry their own declared material', () => {
    expect(MATERIAL_NAMES).toContain(FLOOR_MATERIAL);
    expect(MATERIAL_NAMES).toContain(CEILING_MATERIAL);
    expect(FLOOR_MATERIAL).not.toBe(CEILING_MATERIAL);
    expect(bindSurface({ kind: 'floor' }).material).toBe(FLOOR_MATERIAL);
    expect(bindSurface({ kind: 'ceiling' }).material).toBe(CEILING_MATERIAL);
  });

  it('neither samples a wall texture', () => {
    const wallNames: readonly MaterialName[] = wallMaterialNames();
    expect(wallNames.length).toBeGreaterThan(0);
    expect(wallNames).not.toContain(FLOOR_MATERIAL);
    expect(wallNames).not.toContain(CEILING_MATERIAL);
  });
});

describe('a surface this spec does not name', () => {
  it('falls back to the default material rather than rendering untextured', () => {
    const bound = bindSurface({ kind: 'unknown' });
    expect(bound.material).toBe(DEFAULT_MATERIAL);
    expect(bound.fallback).toBe(true);
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
  });
});

// --- Recognising a surface from the geometry it is drawn as (FR-008) -------
//
// The systems that own the meshes are 002's and 004's, and this spec edits
// neither, so a mesh has to say what it is by where its vertices lie. That
// question is decided here, without a renderer, so the answer is testable.

const WALL_HEIGHT_TILES = 2;

/** One axis-aligned quad as `{positions, normals}`, wound as 002 winds them. */
function quad(
  corners: readonly (readonly [number, number, number])[],
  normal: readonly [number, number, number],
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(corners.flatMap((corner) => [...corner]));
  const normals = new Float32Array(corners.flatMap(() => [...normal]));
  return { positions, normals, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
}

describe('classifySurface', () => {
  it('recognises a wall face by the tile behind it, not the tile in front', () => {
    // The west face of the tile at (21, 9): a '2' in the shipped grid, with open
    // floor at (20, 9). The face plane is shared by both tiles; only the normal
    // says which of them the bricks belong to.
    expect(LEVEL_GRID[9]![21]).toBe('2');
    const face = quad(
      [
        [21, 0, 9],
        [21, 0, 10],
        [21, WALL_HEIGHT_TILES, 10],
        [21, WALL_HEIGHT_TILES, 9],
      ],
      [-1, 0, 0],
    );
    expect(classifySurface(face.positions, face.normals, face.indices, LEVEL_GRID)).toEqual({
      kind: 'wall',
      type: '2',
    });
  });

  it('recognises the floor and the ceiling by their normal and their height', () => {
    const floor = quad(
      [
        [10, FLOOR_Y, 10],
        [10, FLOOR_Y, 11],
        [11, FLOOR_Y, 11],
        [11, FLOOR_Y, 10],
      ],
      [0, 1, 0],
    );
    const ceiling = quad(
      [
        [10, CEILING_Y, 10],
        [11, CEILING_Y, 10],
        [11, CEILING_Y, 11],
        [10, CEILING_Y, 11],
      ],
      [0, -1, 0],
    );
    expect(classifySurface(floor.positions, floor.normals, floor.indices, LEVEL_GRID).kind).toBe(
      'floor',
    );
    expect(
      classifySurface(ceiling.positions, ceiling.normals, ceiling.indices, LEVEL_GRID).kind,
    ).toBe('ceiling');
  });

  it('recognises a door and a secret by the tile every vertex stands on', () => {
    // 004 slides a leaf and a block, so their geometry is local and the mesh
    // carries the offset; the classification is made in world space.
    const doorTile = Object.keys(DOOR_LOCKS)[0]!.split(',').map(Number);
    const leaf = quad(
      [
        [-0.5, -1, 0],
        [0.5, -1, 0],
        [0.5, 1, 0],
        [-0.5, 1, 0],
      ],
      [0, 0, -1],
    );
    const offset = { x: doorTile[0]! + 0.5, y: 1, z: doorTile[1]! + 0.5 };
    expect(classifySurface(leaf.positions, leaf.normals, leaf.indices, LEVEL_GRID, offset).kind).toBe(
      'door',
    );

    const secretFace = quad(
      [
        [42, 0, 10],
        [42, 0, 11],
        [42, WALL_HEIGHT_TILES, 11],
        [42, WALL_HEIGHT_TILES, 10],
      ],
      [-1, 0, 0],
    );
    expect(LEVEL_GRID[10]![42]).toBe('S');
    expect(
      classifySurface(secretFace.positions, secretFace.normals, secretFace.indices, LEVEL_GRID).kind,
    ).toBe('secret');
  });

  it('calls a prop unknown rather than guessing a wall type for it', () => {
    // An octahedron's faces are on no axis and at no tile height: a key, not a
    // surface. It falls to the default material through bindSurface().
    const tilted = quad(
      [
        [10.5, 0.35, 10.5],
        [10.7, 0.35, 10.5],
        [10.6, 0.55, 10.6],
        [10.5, 0.55, 10.6],
      ],
      [0.577, 0.577, 0.577],
    );
    expect(
      classifySurface(tilted.positions, tilted.normals, tilted.indices, LEVEL_GRID).kind,
    ).toBe('unknown');
  });

  it('calls a mesh of mixed surfaces unknown rather than picking one of them', () => {
    const floor = quad(
      [
        [10, FLOOR_Y, 10],
        [10, FLOOR_Y, 11],
        [11, FLOOR_Y, 11],
        [11, FLOOR_Y, 10],
      ],
      [0, 1, 0],
    );
    const ceiling = quad(
      [
        [10, CEILING_Y, 10],
        [11, CEILING_Y, 10],
        [11, CEILING_Y, 11],
        [10, CEILING_Y, 11],
      ],
      [0, -1, 0],
    );
    const positions = new Float32Array([...floor.positions, ...ceiling.positions]);
    const normals = new Float32Array([...floor.normals, ...ceiling.normals]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    expect(classifySurface(positions, normals, indices, LEVEL_GRID).kind).toBe('unknown');
  });

  it('classifies an unindexed buffer by consecutive triples', () => {
    const face = quad(
      [
        [21, 0, 9],
        [21, 0, 10],
        [21, WALL_HEIGHT_TILES, 10],
        [21, WALL_HEIGHT_TILES, 9],
      ],
      [-1, 0, 0],
    );
    const positions = new Float32Array([
      ...face.positions.subarray(0, 9),
      ...face.positions.subarray(0, 3),
      ...face.positions.subarray(6, 12),
    ]);
    const normals = new Float32Array(18).fill(0);
    for (let vertex = 0; vertex < 6; vertex += 1) normals[vertex * 3] = -1;
    expect(classifySurface(positions, normals, null, LEVEL_GRID)).toEqual({
      kind: 'wall',
      type: '2',
    });
  });

  it('is unknown for an empty buffer', () => {
    expect(classifySurface(new Float32Array(0), new Float32Array(0), null, LEVEL_GRID).kind).toBe(
      'unknown',
    );
  });

  it('walks every merged group 002 emits and leaves none unknown', () => {
    const faces = emitFaces(LEVEL_GRID);
    const seen: Record<string, string> = {};
    for (const [type, data] of Object.entries(faces.walls)) {
      const surface = classifySurface(data.positions, data.normals, data.indices, LEVEL_GRID);
      seen[type] = surface.kind === 'wall' ? `wall:${surface.type}` : surface.kind;
    }
    expect(seen).toEqual({
      '1': 'wall:1',
      '2': 'wall:2',
      '3': 'wall:3',
      '4': 'wall:4',
      '5': 'wall:5',
      D: 'door',
      S: 'secret',
    });
    expect(
      classifySurface(faces.floor.positions, faces.floor.normals, faces.floor.indices, LEVEL_GRID)
        .kind,
    ).toBe('floor');
    expect(
      classifySurface(
        faces.ceiling.positions,
        faces.ceiling.normals,
        faces.ceiling.indices,
        LEVEL_GRID,
      ).kind,
    ).toBe('ceiling');
  });

  it('binds every one of those groups to a declared material with no fallback', () => {
    const faces = emitFaces(LEVEL_GRID);
    for (const data of Object.values(faces.walls)) {
      const bound = bindSurface(classifySurface(data.positions, data.normals, data.indices, LEVEL_GRID));
      expect(MATERIAL_NAMES).toContain(bound.material);
    }
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });
});
