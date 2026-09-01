/**
 * The materials system: attaches US1/US2's procedural map sets to the merged
 * geometry from 002 and the door/secret meshes from 004. Runs after the level,
 * door and secret systems so every surface it skins already exists in the scene.
 *
 * Classification happens in one pass *before* any material is swapped, because
 * the discriminator for 002's meshes is the flat colour 002 gave them — and the
 * first swap destroys it. Nothing here guesses from a single vertex.
 */
import { Mesh, MeshStandardMaterial, type Material } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_Y, FLOOR_Y, TILE_SIZE, WALL_MATERIALS } from '../../level';
import {
  attachMaterialDiagnostics,
  publishMaterialDiagnostics,
} from '../../materials/diagnostics';
import { MAPS_PER_MATERIAL } from '../../materials/maps';
import { type MaterialName, MATERIAL_NAMES } from '../../materials/table';
import {
  adaptMaterial,
  adaptedMaterials,
  hasAlbedoMap,
  resetMaterialCache,
  upgradeMaterialMaps,
} from '../../materials/texture-adapter';
import { computeTileUVs } from '../../materials/uv';
import {
  rampBytes,
  rampGeneratedMs,
  rampMaps,
  rampPending,
  rampReports,
  startRamp,
  stepRamp,
} from './derivation-ramp';
import { installMaterialsProbe } from './probe';
import {
  resolveCeilingMaterial,
  resolveDefaultWallMaterial,
  resolveDoorMaterial,
  resolveFloorMaterial,
  resolveSecretMaterial,
  resolveWallMaterial,
} from '../../materials/bindings';
import { getDoorField } from '../doors/register';
import { getSecretField } from '../secrets/register';

/** The materials system must run after 002's level system (order 40) and after
 * 004's doors (45) and secrets, so every mesh it skins is already in the scene. */
export const MATERIALS_SYSTEM_ORDER = 60;

/** Vertex coordinates are built from exact tile multiples, so an exact compare
 * would do; the epsilon only guards against float drift in 002's builder. */
const Y_EPSILON = 1e-4;

let setupDone = false;

function firstMaterial(mesh: Mesh): Material | null {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material ?? null;
}

/** The flat colour 002/004 gave a mesh, before this system replaces it. */
function originalColor(mesh: Mesh): number | null {
  const material = firstMaterial(mesh);
  return material instanceof MeshStandardMaterial ? material.color.getHex() : null;
}

/** True when every vertex of the geometry sits on the plane `y`. A wall spans
 * FLOOR_Y..CEILING_Y and so is never mistaken for the floor or the ceiling —
 * the bug a first-vertex test walks straight into. */
function allVerticesOnPlane(mesh: Mesh, y: number): boolean {
  const positions = mesh.geometry.getAttribute('position');
  if (positions == null || positions.count === 0) return false;
  const array = positions.array as ArrayLike<number>;
  for (let i = 1; i < array.length; i += 3) {
    if (Math.abs((array[i] as number) - y) > Y_EPSILON) return false;
  }
  return true;
}

/** Which surface a mesh is, or `null` for anything that is not part of the
 * level 002 and 004 built. Identification is positive on purpose: the scene
 * also holds 006's enemy sprites, 007's pickups and its weapon viewmodel, and
 * a brick-textured shotgun is a worse failure than an unskinned one. */
type Surface =
  | { kind: 'floor' }
  | { kind: 'ceiling' }
  | { kind: 'door' }
  | { kind: 'secret'; tileX: number; tileZ: number }
  | { kind: 'wall'; typeId: string | null };

/** 002 merges its walls, floor and ceiling in world space, so every one of its
 * meshes is a plain `BufferGeometry` sitting at the scene origin, added straight
 * to the scene. 004's recess shells are built the same way. */
function isMergedLevelGeometry(mesh: Mesh, scene: GameContext['scene']): boolean {
  return (
    mesh.parent === scene &&
    mesh.geometry.type === 'BufferGeometry' &&
    mesh.position.lengthSq() === 0 &&
    verticesWithinLevelHeight(mesh)
  );
}

/** Whether every vertex lies between the floor and the ceiling — true of the
 * level's own surfaces and not of a sprite or a held weapon. */
function verticesWithinLevelHeight(mesh: Mesh): boolean {
  const positions = mesh.geometry.getAttribute('position');
  if (positions == null || positions.count === 0) return false;
  const array = positions.array as ArrayLike<number>;
  for (let i = 1; i < array.length; i += 3) {
    const y = array[i] as number;
    if (y < FLOOR_Y - Y_EPSILON || y > CEILING_Y + Y_EPSILON) return false;
  }
  return true;
}

function classify(
  mesh: Mesh,
  scene: GameContext['scene'],
  doorTiles: ReadonlySet<string>,
  secretTiles: ReadonlySet<string>,
  colorToType: Record<number, string>,
): Surface | null {
  // 004's placed blocks: a door leaf and a secret block are both BoxGeometry at
  // the centre of their own tile, and the two tile sets are disjoint.
  if (mesh.parent === scene && mesh.geometry.type === 'BoxGeometry') {
    const tileX = Math.floor(mesh.position.x / TILE_SIZE);
    const tileZ = Math.floor(mesh.position.z / TILE_SIZE);
    const tile = `${tileX},${tileZ}`;
    if (doorTiles.has(tile)) return { kind: 'door' };
    if (secretTiles.has(tile)) return { kind: 'secret', tileX, tileZ };
    return null;
  }

  if (!isMergedLevelGeometry(mesh, scene)) return null;

  if (allVerticesOnPlane(mesh, FLOOR_Y)) return { kind: 'floor' };
  if (allVerticesOnPlane(mesh, CEILING_Y)) return { kind: 'ceiling' };

  // What is left is wall-like: 002's merged per-type groups, and the doorway
  // and secret recesses 004 emitted behind them. A colour with no wall type —
  // the recesses — takes 002's declared default.
  const color = originalColor(mesh);
  const typeId = color == null ? null : (colorToType[color] ?? null);
  return { kind: 'wall', typeId };
}

function materialNameFor(surface: Surface): MaterialName {
  switch (surface.kind) {
    case 'floor':
      return resolveFloorMaterial();
    case 'ceiling':
      return resolveCeilingMaterial();
    case 'door':
      return resolveDoorMaterial();
    case 'secret':
      return resolveSecretMaterial(surface.tileX, surface.tileZ);
    case 'wall':
      return surface.typeId == null
        ? resolveDefaultWallMaterial()
        : resolveWallMaterial(surface.typeId);
  }
}

/**
 * Writes the mesh's UV attribute in world-tile space, then swaps its material
 * for the shared procedural material bound to that surface (FR-009).
 *
 * The UVs go on *before* the material, and from the mesh's world position
 * rather than its local vertices: 002's merged runs are already in world space,
 * while 004's door leaves are boxes built around their own origin. Passing the
 * mesh position puts both on one tile lattice, so a leaf tiles with the wall it
 * sits in instead of carrying a lattice of its own.
 */
function applyMaterialToMesh(mesh: Mesh, materialName: MaterialName): void {
  const maps = rampMaps();
  if (maps == null) return;

  const geometry = mesh.geometry;
  const positionAttr = geometry.getAttribute('position');
  const normalAttr = geometry.getAttribute('normal');
  const uvAttr = geometry.getAttribute('uv');

  if (positionAttr != null && normalAttr != null && uvAttr != null) {
    computeTileUVs(
      positionAttr.array as Float32Array,
      normalAttr.array as Float32Array,
      uvAttr.array as Float32Array,
      [mesh.position.x, mesh.position.y, mesh.position.z],
    );
    uvAttr.needsUpdate = true;
  }

  mesh.material = adaptMaterial(maps[materialName]).material;
}

/** Every mesh in the scene, however deeply nested — US3-S2 says the scene is
 * walked, not that its top level is. */
function everyMesh(scene: GameContext['scene']): Mesh[] {
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

/** Inverse of the wall colour 002 used, so a mesh's flat colour names its type. */
function buildColorToWallType(): Record<number, string> {
  const map: Record<number, string> = {};
  for (const [id, entry] of Object.entries(WALL_MATERIALS)) {
    map[entry.color] = id;
  }
  return map;
}

/** A mesh and the level surface it was identified as. */
interface SurfaceMesh {
  readonly mesh: Mesh;
  readonly surface: Surface;
}

/** Classifies every mesh against the colours 002 and 004 gave it, then applies.
 * One pass would read colours it had already overwritten. Returns the level
 * surfaces it identified, so the caller can count them without reclassifying. */
function skinScene(scene: GameContext['scene']): SurfaceMesh[] {
  const doorTiles = new Set(
    (getDoorField()?.doors ?? []).map((door) => `${door.x},${door.z}`),
  );
  const secretTiles = new Set(
    (getSecretField()?.secrets ?? []).map((secret) => `${secret.x},${secret.z}`),
  );
  const colorToType = buildColorToWallType();

  const surfaces: SurfaceMesh[] = [];
  for (const mesh of everyMesh(scene)) {
    const surface = classify(mesh, scene, doorTiles, secretTiles, colorToType);
    if (surface != null) surfaces.push({ mesh, surface });
  }

  for (const { mesh, surface } of surfaces) {
    applyMaterialToMesh(mesh, materialNameFor(surface));
  }
  return surfaces;
}

/**
 * Level surfaces reaching the frame with no albedo map (US3-S2).
 *
 * The walk is over the whole scene, but the count is of meshes this spec is
 * responsible for skinning — classified independently of whether the skinning
 * worked, so a wall type that failed to bind is still counted. Counting only
 * the meshes that *were* skinned would report zero no matter what broke.
 *
 * 006's enemy sprites, 007's pickups and its weapon viewmodel are not level
 * surfaces and are not 005's to texture; see DECISIONS.md.
 */
function countUntexturedMeshes(surfaces: readonly SurfaceMesh[]): number {
  let untextured = 0;
  for (const { mesh } of surfaces) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!hasAlbedoMap(material)) untextured += 1;
    }
  }
  return untextured;
}

/** The whole cost side of `__diag.materials`, republished after every step of
 * the ramp so the page reports what it is actually holding right now. */
function publishCost(untexturedMeshes: number): void {
  publishMaterialDiagnostics({
    untexturedMeshes,
    textureCount: adaptedMaterials().length * MAPS_PER_MATERIAL,
    bytes: rampBytes(),
    generatedMs: rampGeneratedMs(),
    materials: rampReports(),
    pendingMaterials: rampPending(),
  });
}

let untextured = 0;

defineSystem({
  name: 'materials',
  order: MATERIALS_SYSTEM_ORDER,
  setup(ctx) {
    if (setupDone) return;
    setupDone = true;

    resetMaterialCache();
    attachMaterialDiagnostics(ctx.diag);

    // The preview pass, cheap enough to run before the loop starts. Every
    // material is adapted whether or not a mesh asks for it, so the uploaded
    // count is one set per material rather than per material in use (US4-S3).
    const maps = startRamp();
    for (const name of MATERIAL_NAMES) adaptMaterial(maps[name]);

    const surfaces = skinScene(ctx.scene);
    untextured = countUntexturedMeshes(surfaces);
    publishCost(untextured);
    installMaterialsProbe(surfaces.map((entry) => entry.mesh));
  },
  update() {
    // The frame's share of the derivation, and no more: one stage of one
    // material, never a whole material and never the set. A finished set is
    // installed on the *shared* material, so every mesh already bound to it
    // sharpens at once — no second scene walk, no re-bind (US4-S3, US4-S6).
    if (rampPending() === 0) return;

    const finished = stepRamp();
    if (finished != null) upgradeMaterialMaps(finished);
    publishCost(untextured);
  },
  resize() {
    // FR-011 / US4-S4: no texture regeneration, no re-attachment, no re-UV. A
    // viewport change is the camera's business; the material cache and the
    // generation clock are untouched, which is what the smoke harness reads
    // back as an unchanged `generatedMs` and texture count.
  },
});
