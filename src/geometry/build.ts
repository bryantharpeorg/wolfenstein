// Geometry builder: turns the emitted faces into three.js meshes. This is the
// only new three.js file in US2 (FR-007). It runs `validateLevel()` first and
// throws a typed failure on a malformed map (US1-S6), then merges the emitted
// faces into one `BufferGeometry` per wall type plus one floor and one ceiling.

import { BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import { validateLevel, type ValidationReport, type ValidateLevelOptions } from '../level-validate';
import { LEVEL_GRID, WALL_MATERIALS, DEFAULT_WALL_MATERIAL } from '../level';
import { emitFaces, type FaceData } from './faces';

// A typed build failure carrying the validator's report, so the caller (US2's
// level system) can render the named errors into the document body instead of a
// partial level, rather than surfacing a bare stack trace.
export class LevelBuildError extends Error {
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    super(
      `cannot build level geometry: ${report.errors.length} validation error(s) — ` +
        report.errors.map((e) => e.message).join('; '),
    );
    this.name = 'LevelBuildError';
    this.report = report;
  }
}

export interface LevelGeometry {
  walls: Mesh[];
  floor: Mesh;
  ceiling: Mesh;
  /** Wall type IDs that had no material entry and fell back to the default. */
  fallbackTypes: string[];
}

// Flat colours for the floor and ceiling; M4 attaches procedural textures to
// these same meshes without changing the draw-call budget.
const FLOOR_COLOR = 0x5a5a5a;
const CEILING_COLOR = 0x7a7a7a;

function buildBufferGeometry(data: FaceData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  return geometry;
}

/** Mesh names, so a surface's classification survives onto the scene graph. */
export const FLOOR_MESH_NAME = 'floor';
export const CEILING_MESH_NAME = 'ceiling';
export function wallMeshName(type: string): string {
  return `wall:${type}`;
}

function isWallType(type: string): boolean {
  return type >= '1' && type <= '9';
}

export function buildLevelGeometry(
  grid: string[] = LEVEL_GRID,
  options: ValidateLevelOptions = {},
): LevelGeometry {
  const report = validateLevel(grid, options);
  if (!report.valid) {
    throw new LevelBuildError(report);
  }

  const faces = emitFaces(grid);

  const walls: Mesh[] = [];
  const fallbackTypes: string[] = [];
  for (const type of Object.keys(faces.walls)) {
    const entry = WALL_MATERIALS[type];
    const material = entry ?? DEFAULT_WALL_MATERIAL;
    if (entry === undefined && isWallType(type)) {
      fallbackTypes.push(type);
    }
    const geometry = buildBufferGeometry(faces.walls[type]!);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: material.color }));
    // The surface's classification, carried on the mesh (005 US4). A later
    // system that skins these meshes needs to know which is which, and reading
    // it off the object beats re-deriving it from vertex data.
    mesh.name = wallMeshName(type);
    walls.push(mesh);
  }

  const floor = new Mesh(
    buildBufferGeometry(faces.floor),
    new MeshStandardMaterial({ color: FLOOR_COLOR }),
  );
  floor.name = FLOOR_MESH_NAME;
  const ceiling = new Mesh(
    buildBufferGeometry(faces.ceiling),
    new MeshStandardMaterial({ color: CEILING_COLOR }),
  );
  ceiling.name = CEILING_MESH_NAME;

  return { walls, floor, ceiling, fallbackTypes };
}
