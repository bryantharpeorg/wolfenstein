// Where the buffers `src/materials/` generated meet the geometry 002 and 004
// put in the scene (FR-008..FR-011). It runs after every system that adds a
// mesh and edits none of their files: an unlabelled merged group is named by
// the pure `classifySurface`, leaving the render-loop half here — world-tile
// UVs, the shared material, and the count of meshes with no albedo map.
import {
  BufferAttribute,
  Matrix3,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { TEXTURE_SIZE } from '../../materials/constants';
import { PROP_MATERIAL, classifySurface, materialForSurface } from '../../materials/bindings';
import { attachMaterialDiagnostics, publishMaterialDiagnostics } from '../../materials/diagnostics';
import { generationStats } from '../../materials/generate';
import { buildAllMaterialMaps, textureBytes } from '../../materials/maps';
import { sharedMaterial } from '../../materials/texture-adapter';
import { computeTileUVs } from '../../materials/uv';

/** After 002's level (40) and 004's doors (45), keys (46) and secrets (47). */
const SYSTEM_ORDER = 60;

const materialsOf = (mesh: Mesh): Material[] =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

const isStandard = (material: Material): material is MeshStandardMaterial =>
  'map' in material && 'normalMap' in material && 'roughnessMap' in material;

function meshesIn(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

/** Positions and normals in world space, vertex order preserved. */
function worldVertices(mesh: Mesh): { positions: Float32Array; normals: Float32Array } | null {
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  if (position == null || normal == null) return null;

  const positions = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    point.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    point.toArray(normals, i * 3);
  }
  return { positions, normals };
}

/** A mesh that is no level surface — a key pickup, say — takes the prop
 * material's maps and keeps its own colour as a tint. Those are the textures
 * every steel wall samples, so no sixth set is uploaded. */
function tintWithPropMaps(mesh: Mesh): void {
  const prop = sharedMaterial(PROP_MATERIAL).material;
  for (const material of materialsOf(mesh)) {
    if (!isStandard(material) || material.map != null) continue;
    Object.assign(material, {
      map: prop.map,
      normalMap: prop.normalMap,
      roughnessMap: prop.roughnessMap,
      needsUpdate: true,
    });
  }
}

/** Meshes whose material carries no albedo map — zero is FR-008's condition. */
const countUntextured = (root: Object3D): number =>
  meshesIn(root).filter((mesh) =>
    materialsOf(mesh).some((material) => !isStandard(material) || material.map == null),
  ).length;

/** Distinct textures bound in the scene, read off the scene and not the cache,
 * so a second upload shows even if the cache thought it shared (US3-S8). */
function sceneTextures(root: Object3D): Texture[] {
  const seen = new Map<string, Texture>();
  for (const mesh of meshesIn(root)) {
    for (const material of materialsOf(mesh)) {
      if (!isStandard(material)) continue;
      for (const map of [material.map, material.normalMap, material.roughnessMap]) {
        if (map != null) seen.set(map.uuid, map);
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.uuid.localeCompare(b.uuid));
}

defineSystem({
  name: 'materials',
  order: SYSTEM_ORDER,
  setup(ctx: GameContext) {
    const sets = buildAllMaterialMaps();
    // UVs and classification are world-space; matrices are stale until asked.
    ctx.scene.updateMatrixWorld(true);

    const replaced = new Set<Material>();
    for (const mesh of meshesIn(ctx.scene)) {
      const world = worldVertices(mesh);
      if (world == null) continue;

      // UVs first, so a 20-tile run reads as twenty bricks rather than one
      // stretched brick, whatever material lands on it next.
      mesh.geometry.setAttribute(
        'uv',
        new BufferAttribute(computeTileUVs(world.positions, world.normals), 2),
      );

      const index = mesh.geometry.getIndex();
      const surface = classifySurface(world.positions, world.normals, index?.array ?? null);
      if (surface == null) {
        tintWithPropMaps(mesh);
        continue;
      }
      const name = materialForSurface(surface);
      for (const material of materialsOf(mesh)) replaced.add(material);
      mesh.material = sharedMaterial(name, TEXTURE_SIZE, sets[name]).material;
    }

    // The flat colours 002 and 004 shipped are nobody's material now.
    for (const material of replaced) material.dispose();

    // Harness-only (US3-S9, US3-S10): sampler state and texture identity as the
    // renderer holds them — a regenerated map is a new uuid, which the smoke
    // check reads either side of a viewport change.
    (window as unknown as Record<string, unknown>).__materialsProbe = () =>
      sceneTextures(ctx.scene).map((texture) => ({
        id: texture.uuid,
        channel: texture.name,
        mipmapped: texture.generateMipmaps,
        anisotropy: texture.anisotropy,
        repeats: texture.wrapS === RepeatWrapping && texture.wrapT === RepeatWrapping,
        srgb: texture.colorSpace === SRGBColorSpace,
      }));

    const textureCount = sceneTextures(ctx.scene).length;
    publishMaterialDiagnostics({
      generatedMs: generationStats().generatedMs,
      textureCount,
      bytes: textureBytes(TEXTURE_SIZE, textureCount),
      untexturedMeshes: countUntextured(ctx.scene),
    });
    attachMaterialDiagnostics(ctx.diag);
  },

  // Deliberately empty and deliberately present (US3-S9): a viewport change is
  // a projection change, so nothing is regenerated or re-attached and the
  // texture count reads the same after a resize.
  resize() {},
});
