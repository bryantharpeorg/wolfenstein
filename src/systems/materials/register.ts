/**
 * The materials system: attaches US1/US2's procedural map sets to the merged
 * geometry from 002 and the door/secret meshes from 004. Runs after the level
 * system so the geometry it re-UVs and skins already exists in the scene.
 */
import { Mesh, MeshStandardMaterial } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { WALL_MATERIALS } from '../../level';
import {
  attachMaterialDiagnostics,
  materialDiagnostics,
  publishMaterialDiagnostics,
} from '../../materials/diagnostics';
import { buildAllMaterialMaps, type MaterialMapSet } from '../../materials/maps';
import { type MaterialName } from '../../materials/table';
import {
  adaptMaterial,
  adaptedMaterials,
  hasAlbedoMap,
  resetMaterialCache,
} from '../../materials/texture-adapter';
import { computeTileUVs } from '../../materials/uv';
import {
  resolveCeilingMaterial,
  resolveDoorMaterial,
  resolveFloorMaterial,
  resolveSecretMaterial,
  resolveWallMaterial,
} from '../../materials/bindings';
import { getDoorField } from '../doors/register';
import { getSecretField } from '../secrets/register';

/** The materials system must run after 002's level system (order 40) has built
 * and added the merged geometry. */
export const MATERIALS_SYSTEM_ORDER = 41;

let setupDone = false;
let mapSets: Record<MaterialName, MaterialMapSet> | null = null;

function isWallMesh(child: unknown): child is Mesh {
  return child instanceof Mesh && child.position.lengthSq() === 0;
}

/** Re-UVs every merged BufferGeometry in place, then swaps its material for the
 * shared procedural material bound to that surface (T027). */
function applyMaterialToMesh(mesh: Mesh, materialName: MaterialName): void {
  const geometry = mesh.geometry;
  const positionAttr = geometry.getAttribute('position');
  const normalAttr = geometry.getAttribute('normal');
  const uvAttr = geometry.getAttribute('uv');

  if (positionAttr != null && normalAttr != null && uvAttr != null && mapSets != null) {
    computeTileUVs(
      positionAttr.array as Float32Array,
      normalAttr.array as Float32Array,
      uvAttr.array as Float32Array,
    );
    uvAttr.needsUpdate = true;
  }

  const adapted = mapSets == null ? null : adaptMaterial(mapSets[materialName]);
  if (adapted != null) {
    mesh.material = adapted.material;
  }
}

/** Walks the scene and counts meshes whose material has no albedo map. */
function countUntexturedMeshes(scene: GameContext['scene']): number {
  let untextured = 0;
  for (const child of scene.children) {
    if (!(child instanceof Mesh)) continue;
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        if (!hasAlbedoMap(material)) untextured += 1;
      }
    } else if (!hasAlbedoMap(child.material)) {
      untextured += 1;
    }
  }
  return untextured;
}

/** Inverse of the wall colour 002 used, so we can recover the wall type ID from
 * a mesh's flat-colour material. */
function buildColorToWallType(): Record<number, string> {
  const map: Record<number, string> = {};
  for (const [id, entry] of Object.entries(WALL_MATERIALS)) {
    map[entry.color] = id;
  }
  return map;
}

/** Applies materials to 002's merged wall-type meshes, floor and ceiling. */
function skinLevelGeometry(scene: GameContext['scene']): void {
  const colorToType = buildColorToWallType();

  for (const child of scene.children) {
    if (!isWallMesh(child)) continue;

    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const color = material instanceof MeshStandardMaterial ? material.color.getHex() : null;
    const typeId = color != null ? colorToType[color] : null;
    const materialName = typeId != null ? resolveWallMaterial(typeId) : 'stone';

    applyMaterialToMesh(child, materialName);
  }

  // Floor and ceiling are single meshes in the scene at the origin.
  for (const child of scene.children) {
    if (!(child instanceof Mesh) || child.position.lengthSq() !== 0) continue;
    const positions = child.geometry.getAttribute('position');
    if (positions == null) continue;
    const y = (positions.array as Float32Array)[1] ?? 0;
    if (y === 0) {
      applyMaterialToMesh(child, resolveFloorMaterial());
    } else if (y === 2) {
      applyMaterialToMesh(child, resolveCeilingMaterial());
    }
  }
}

/** Applies materials to 004's door leaves, secret blocks and their shells. */
function skinDynamicMeshes(scene: GameContext['scene']): void {
  const doorField = getDoorField();
  const secretField = getSecretField();

  for (const child of scene.children) {
    if (!(child instanceof Mesh)) continue;

    // Door leaf: a BoxGeometry positioned away from the origin.
    if (doorField != null && child.geometry.type === 'BoxGeometry' && child.position.y > 0.5) {
      applyMaterialToMesh(child, resolveDoorMaterial());
      continue;
    }

    // Secret block: a BoxGeometry at the origin but with non-zero position.
    if (
      secretField != null &&
      child.geometry.type === 'BoxGeometry' &&
      child.position.lengthSq() > 0
    ) {
      applyMaterialToMesh(child, resolveSecretMaterial());
      continue;
    }
  }
}

defineSystem({
  name: 'materials',
  order: MATERIALS_SYSTEM_ORDER,
  setup(ctx) {
    if (setupDone) return;
    setupDone = true;

    resetMaterialCache();
    attachMaterialDiagnostics(ctx.diag);

    mapSets = buildAllMaterialMaps();

    skinLevelGeometry(ctx.scene);
    skinDynamicMeshes(ctx.scene);

    const untexturedMeshes = countUntexturedMeshes(ctx.scene);
    publishMaterialDiagnostics({
      untexturedMeshes,
      textureCount: adaptedMaterials().length * 3,
      bytes: Object.values(mapSets).reduce(
        (total, set) => total + set.albedo.length + set.normal.length + set.roughness.length,
        0,
      ),
      generatedMs: materialDiagnostics().generatedMs,
    });
  },
  resize() {
    // FR-011: no texture regeneration, no re-attachment. The viewport change
    // leaves the material cache and generation time untouched.
  },
});
