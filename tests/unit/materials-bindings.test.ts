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
import { materialDiagnostics, resetMaterialDiagnostics } from '../../src/materials/diagnostics';

// FR-008 / US3-S1, US3-S3, US3-S4: every wall type ID 002 declares resolves to
// one of US1's five materials, an ID with no entry to 002's declared default
// rather than to nothing, and doors, secrets, floor and ceiling each to a
// declared material of their own.

beforeEach(() => {
  resetMaterialDiagnostics();
});

describe('every wall type ID 002 declares', () => {
  it('is covered by the binding table, which names only declared materials', () => {
    expect(declaredWallTypes()).toEqual(Object.keys(WALL_MATERIALS).sort());
    for (const type of declaredWallTypes()) expect(Object.keys(WALL_TYPE_MATERIALS)).toContain(type);
    for (const name of Object.values(WALL_TYPE_MATERIALS)) expect(MATERIAL_NAMES).toContain(name);
  });

  it.each(Object.keys(WALL_MATERIALS))('maps %s to exactly one of the five materials', (type) => {
    const resolved = materialForWallType(type);
    expect(MATERIAL_NAMES).toContain(resolved.material);
    expect(resolved.fallback).toBe(false);
    // "Exactly one": the table holds a single name, not a list.
    expect(typeof WALL_TYPE_MATERIALS[type]).toBe('string');
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

  it('records one fallback per unmapped id, and none for a declared one', () => {
    for (const type of declaredWallTypes()) bindSurface({ kind: 'wall', type });
    expect(materialDiagnostics().fallbacks).toHaveLength(0);

    bindSurface({ kind: 'wall', type: '8' });
    bindSurface({ kind: 'wall', type: '8' }); // a second mesh of the same type
    const fallbacks = materialDiagnostics().fallbacks;
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.name).toBe(DEFAULT_MATERIAL);
    expect(fallbacks[0]!.map).toBe('binding');
    expect(fallbacks[0]!.reason).toContain('8');
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

  it('read as themselves before they are touched: each differs from the wall beside it', () => {
    const doors = Object.keys(DOOR_LOCKS).map((key) => key.split(',').map(Number) as [number, number]);
    const secrets: Array<[number, number]> = [];
    LEVEL_GRID.forEach((row, z) => {
      [...row].forEach((cell, x) => {
        if (cell === 'S') secrets.push([x, z]);
      });
    });
    expect(doors.length).toBeGreaterThan(0);
    expect(secrets.length).toBeGreaterThan(0);

    for (const [tiles, material] of [
      [doors, DOOR_MATERIAL],
      [secrets, SECRET_MATERIAL],
    ] as const) {
      for (const [x, z] of tiles) {
        const beside = adjacentWallMaterials(LEVEL_GRID, x, z);
        expect(beside.length).toBeGreaterThan(0);
        expect(beside).not.toContain(material);
      }
    }
  });
});

describe('floor, ceiling and anything unnamed', () => {
  it('each carry their own declared material, and neither samples a wall texture', () => {
    expect(MATERIAL_NAMES).toContain(FLOOR_MATERIAL);
    expect(MATERIAL_NAMES).toContain(CEILING_MATERIAL);
    expect(FLOOR_MATERIAL).not.toBe(CEILING_MATERIAL);
    expect(bindSurface({ kind: 'floor' }).material).toBe(FLOOR_MATERIAL);
    expect(bindSurface({ kind: 'ceiling' }).material).toBe(CEILING_MATERIAL);

    const wallNames: readonly MaterialName[] = wallMaterialNames();
    expect(wallNames.length).toBeGreaterThan(0);
    expect(wallNames).not.toContain(FLOOR_MATERIAL);
    expect(wallNames).not.toContain(CEILING_MATERIAL);
  });

  it('and a surface this spec does not name falls back rather than going untextured', () => {
    const bound = bindSurface({ kind: 'unknown' });
    expect(bound.material).toBe(DEFAULT_MATERIAL);
    expect(bound.fallback).toBe(true);
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
  });
});

// --- Recognising a surface from the geometry it is drawn as (FR-008) -------
//
// 002 and 004 own the meshes and this spec edits neither, so a mesh says what it
// is by where its vertices lie — decided here, without a renderer.

const WALL_TOP = 2;

/** One axis-aligned quad from flat corner triples, wound as 002 winds them. */
function quad(corners: readonly number[], normal: readonly [number, number, number]) {
  return {
    positions: new Float32Array(corners),
    normals: new Float32Array([0, 1, 2, 3].flatMap(() => [...normal])),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

const kindOf = (face: ReturnType<typeof quad>, offset?: { x: number; y: number; z: number }) =>
  classifySurface(face.positions, face.normals, face.indices, LEVEL_GRID, offset);

/** The west face of the tile at `(x, z)`: its plane is shared with the open tile
 *  in front, so only the normal says which owns the bricks. */
const westFace = (x: number, z: number) =>
  quad([x, 0, z, x, 0, z + 1, x, WALL_TOP, z + 1, x, WALL_TOP, z], [-1, 0, 0]);

/** A one-tile horizontal quad at height `y`, facing `normal`. */
const horizontal = (y: number, normal: readonly [number, number, number]) =>
  quad([10, y, 10, 10, y, 11, 11, y, 11, 11, y, 10], normal);

describe('classifySurface', () => {
  it('recognises a wall face by the tile behind it, not the tile in front', () => {
    expect(LEVEL_GRID[9]![21]).toBe('2');
    expect(kindOf(westFace(21, 9))).toEqual({ kind: 'wall', type: '2' });
  });

  it('recognises the floor and the ceiling by their normal and their height', () => {
    expect(kindOf(horizontal(FLOOR_Y, [0, 1, 0])).kind).toBe('floor');
    expect(kindOf(horizontal(CEILING_Y, [0, -1, 0])).kind).toBe('ceiling');
  });

  it('recognises a door and a secret by the tile every vertex stands on', () => {
    // 004's leaf is drawn in local space with the offset on the mesh; the
    // classification is made in world space.
    const [doorX, doorZ] = Object.keys(DOOR_LOCKS)[0]!.split(',').map(Number);
    const leaf = quad([-0.5, -1, 0, 0.5, -1, 0, 0.5, 1, 0, -0.5, 1, 0], [0, 0, -1]);
    expect(kindOf(leaf, { x: doorX! + 0.5, y: 1, z: doorZ! + 0.5 }).kind).toBe('door');

    expect(LEVEL_GRID[10]![42]).toBe('S');
    expect(kindOf(westFace(42, 10)).kind).toBe('secret');
  });

  it('calls a prop unknown rather than guessing a wall type for it', () => {
    // A facet on no axis and at no tile height: a key, not a surface.
    const tilted = quad(
      [10.5, 0.35, 10.5, 10.7, 0.35, 10.5, 10.6, 0.55, 10.6, 10.5, 0.55, 10.6],
      [0.577, 0.577, 0.577],
    );
    expect(kindOf(tilted).kind).toBe('unknown');
  });

  it('calls a mesh of mixed surfaces unknown rather than picking one of them', () => {
    const floor = horizontal(FLOOR_Y, [0, 1, 0]);
    const ceiling = horizontal(CEILING_Y, [0, -1, 0]);
    expect(
      classifySurface(
        new Float32Array([...floor.positions, ...ceiling.positions]),
        new Float32Array([...floor.normals, ...ceiling.normals]),
        new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
        LEVEL_GRID,
      ).kind,
    ).toBe('unknown');
  });

  it('classifies an unindexed buffer by triples, and an empty one not at all', () => {
    expect(classifySurface(new Float32Array(0), new Float32Array(0), null, LEVEL_GRID).kind).toBe(
      'unknown',
    );
    const face = westFace(21, 9);
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

  it('walks every merged group 002 emits, leaves none unknown, and binds them all', () => {
    const faces = emitFaces(LEVEL_GRID);
    const seen: Record<string, string> = {};
    for (const [type, data] of Object.entries(faces.walls)) {
      const surface = classifySurface(data.positions, data.normals, data.indices, LEVEL_GRID);
      seen[type] = surface.kind === 'wall' ? `wall:${surface.type}` : surface.kind;
      expect(MATERIAL_NAMES).toContain(bindSurface(surface).material);
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

    for (const [plane, kind] of [
      [faces.floor, 'floor'],
      [faces.ceiling, 'ceiling'],
    ] as const) {
      const surface = classifySurface(plane.positions, plane.normals, plane.indices, LEVEL_GRID);
      expect(surface.kind).toBe(kind);
      expect(MATERIAL_NAMES).toContain(bindSurface(surface).material);
    }
    // Nothing 002 emits needed the default to stand in for it.
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });
});
