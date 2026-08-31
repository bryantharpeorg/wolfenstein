/**
 * Where US1's buffers, US2's maps and US3's bindings meet 002's and 004's meshes
 * (FR-008, FR-009, FR-010). It edits no other system, and what a mesh is it works
 * out from that mesh's own vertices (`classifySurface`).
 *
 * A level surface gets tile-space UVs and the one shared material for its binding
 * — sharing is the draw-call argument. A lit prop the table does not name keeps
 * its own material, since that colour tells a silver key from a gold one, and is
 * lent the default's maps so it is lit like the level (FR-008). Unlit meshes are
 * left alone: 006's billboards and 007's HUD carry their own sprite sheets.
 *
 * Skinning takes one step per frame (US3-S11): five materials generated inside
 * `setup` is a third of a second no animation frame can be serviced in, which the
 * harness read as 4.6 fps against a floor of 5.
 */
import {
  BufferAttribute,
  type BufferGeometry,
  type Camera,
  InstancedMesh,
  type Material,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { LEVEL_GRID } from '../../level';
import { DEFAULT_MATERIAL, bindSurface, classifySurface } from '../../materials/bindings';
import {
  attachMaterialDiagnostics,
  publishMaterialDiagnostics,
  type MaterialMapReport,
} from '../../materials/diagnostics';
import { generateAlbedo, generationStats } from '../../materials/generate';
import { buildMaterialMaps, type MaterialMapSet } from '../../materials/maps';
import { MATERIAL_NAMES, type MaterialName } from '../../materials/table';
import {
  MAP_KINDS,
  type MapKind,
  mapTexture,
  sharedMaterial,
  textureCacheStats,
} from '../../materials/texture-adapter';
import { computeTileUVs } from '../../materials/uv';

/** What the harness reads back (US3-S8, US3-S9). The counts are paired: an
 * untextured zero is worth something only against the meshes walked. */
export interface MaterialsProbe {
  readonly untexturedMeshes: number;
  readonly worldMeshes: number;
  readonly albedoTextures: number;
  readonly textures: number;
  readonly pending: number;
  readonly byMaterial: Readonly<Record<string, number>>;
  /** Read off the uploaded textures, not the constant that asked for them. */
  readonly minAnisotropy: number;
  readonly allMipmapped: boolean;
  readonly allRepeatWrapped: boolean;
}

declare global {
  interface Window {
    /** Harness-only, as `__playerDrive` is: the scene walk is a render-loop fact. */
    __materialsProbe?: () => MaterialsProbe;
  }
}

/** After every system that adds a mesh in `setup`: 002's level (40), 004's doors
 * (45), keys (46), secrets (47), 007's pickups (74) and the HUD (90). */
const ORDER = 96;

/** Geometries already rewritten (004 shares one box between every push-wall),
 * surfaces and props waiting on a material, one report each (FR-015). */
const uvWritten = new WeakSet<BufferGeometry>();
const waiting = new Map<MaterialName, Mesh[]>();
const props: Mesh[] = [];
const reports: MaterialMapReport[] = [];

/** One frame's worth of skinning; the queue drains one step per frame. */
type SkinStep = (ctx: GameContext) => void;
let steps: SkinStep[] = [];

function isStandardMaterial(material: Material): material is MeshStandardMaterial {
  return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Every mesh in the world; the camera's children are overlays. */
function worldMeshes(scene: Object3D, camera: Camera): Mesh[] {
  const found: Mesh[] = [];
  scene.traverse((object) => {
    if ((object as Mesh).isMesh !== true) return;
    for (let node: Object3D | null = object; node != null; node = node.parent) {
      if (node === camera) return;
    }
    found.push(object as Mesh);
  });
  return found;
}

/** Tile-space UVs, written before the material is attached (FR-009, US3-S5):
 * 002's `0..1` quad UV becomes one brick over twenty tiles once merged. Local
 * coordinates — a door leaf slides, texture and all. */
function writeTileUVs(geometry: BufferGeometry): void {
  if (uvWritten.has(geometry)) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (position == null || normal == null) return;
  geometry.setAttribute('uv', new BufferAttribute(computeTileUVs(position.array, normal.array), 2));
  uvWritten.add(geometry);
}

/** Decides what every mesh is and will carry — one classification and attribute
 * apiece, and therefore all `setup` does; nothing here generates a texel. An
 * `InstancedMesh` is no level surface, so it takes the prop path. */
function planBindings(scene: Object3D, camera: Camera): void {
  for (const mesh of worldMeshes(scene, camera)) {
    // Skinning an unlit mesh would replace a guard with a brick wall.
    if (!materialsOf(mesh).some(isStandardMaterial)) continue;

    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const index = mesh.geometry.getIndex();
    const surface =
      (mesh as InstancedMesh).isInstancedMesh === true || position == null || normal == null
        ? ({ kind: 'unknown' } as const)
        : classifySurface(
            position.array,
            normal.array,
            index == null ? null : index.array,
            LEVEL_GRID,
            mesh.position,
          );

    const name = bindSurface(surface).material;
    if (surface.kind === 'unknown') {
      props.push(mesh);
      continue;
    }
    writeTileUVs(mesh.geometry);
    const list = waiting.get(name);
    if (list == null) waiting.set(name, [mesh]);
    else list.push(mesh);
  }
  // Every declared material is built, so `textureCount` lands on one set per
  // material whatever the shipped level happens to use.
  steps = MATERIAL_NAMES.flatMap((name) => materialSteps(name));
}

/** Uploads one map and waits for the renderer to have done it: a WebGL call only
 * queues work, so without the read-back all fifteen mip chains land on one
 * frame. */
function uploadMap(ctx: GameContext, set: MaterialMapSet, kind: MapKind): void {
  const renderer = ctx.renderer as unknown as {
    initTexture?: (texture: Texture) => void;
    getContext?: () => WebGL2RenderingContext;
  };
  try {
    if (typeof renderer.initTexture !== 'function') return;
    renderer.initTexture(mapTexture(set, kind));
    const gl = renderer.getContext?.();
    if (gl != null && typeof gl.readPixels === 'function') {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
  } catch {
    // A backend with neither hook uploads on first use, as before.
  }
}

/** One material in steps: generation, derivation, one per map upload, then the
 * meshes — so nothing is drawn with a map not yet uploaded. */
function materialSteps(name: MaterialName): SkinStep[] {
  let set: MaterialMapSet | null = null;
  return [
    // US1's memo means the derivation below re-reads this (FR-004).
    () => void generateAlbedo(name),
    () => {
      set = buildMaterialMaps(name);
      reports.push({ name, hasNormal: set.hasNormal, hasRoughness: set.hasRoughness });
    },
    ...MAP_KINDS.map((kind) => (ctx: GameContext) => {
      if (set != null) uploadMap(ctx, set, kind);
    }),
    () => {
      if (set == null) return;
      const material = sharedMaterial(set);
      for (const mesh of waiting.get(name) ?? []) mesh.material = material;
      waiting.delete(name);
      if (name !== DEFAULT_MATERIAL) return;
      for (const mesh of props) lendMaps(mesh, material);
      props.length = 0;
    },
  ];
}

/** Lends a prop the default's maps without taking its colour away (FR-008). */
function lendMaps(mesh: Mesh, fallback: MeshStandardMaterial): void {
  for (const material of materialsOf(mesh)) {
    if (!isStandardMaterial(material) || material.map != null) continue;
    material.map = fallback.map;
    material.normalMap = fallback.normalMap;
    material.roughnessMap = fallback.roughnessMap;
    material.needsUpdate = true;
  }
}

/** The walk US3-S2 and US3-S8 are read from, published through US2's
 * diagnostics (FR-015), on demand so the harness can re-ask after a resize. */
function publish(scene: Object3D, camera: Camera): MaterialsProbe {
  const meshes = worldMeshes(scene, camera);
  const albedo = new Set<string>();
  const byMaterial: Record<string, number> = {};
  let untextured = 0;

  for (const mesh of meshes) {
    for (const material of materialsOf(mesh)) {
      // A depth material has no `map` and is no surface anyone sees.
      if (!('map' in material)) continue;
      const map = (material as Material & { map: { uuid: string } | null }).map;
      if (map == null) {
        untextured += 1;
        continue;
      }
      // Only the five declared materials count towards US3-S8: 006's billboards
      // carry their own sprite sheet, and it is not one of this spec's map sets.
      if ((MATERIAL_NAMES as readonly string[]).includes(material.name)) albedo.add(map.uuid);
      const name = material.name === '' ? '(unnamed)' : material.name;
      byMaterial[name] = (byMaterial[name] ?? 0) + 1;
    }
  }

  const cache = textureCacheStats();
  publishMaterialDiagnostics({
    generatedMs: generationStats().generatedMs,
    textureCount: cache.textures,
    bytes: cache.bytes,
    untexturedMeshes: untextured,
    materials: [...reports],
  });

  return {
    untexturedMeshes: untextured,
    worldMeshes: meshes.length,
    albedoTextures: albedo.size,
    textures: cache.textures,
    pending: steps.length,
    byMaterial,
    minAnisotropy: cache.minAnisotropy,
    allMipmapped: cache.allMipmapped,
    allRepeatWrapped: cache.allRepeatWrapped,
  };
}

defineSystem({
  name: 'materials',
  order: ORDER,

  setup(ctx: GameContext) {
    planBindings(ctx.scene, ctx.camera);
    attachMaterialDiagnostics(ctx.diag);
    publish(ctx.scene, ctx.camera);
    window.__materialsProbe = () => publish(ctx.scene, ctx.camera);
  },

  /** One step per frame until the level is skinned, then a shift on an empty
   * array forever. US1's memo and the adapter's cache make a second request for
   * a built material a lookup, so nothing is regenerated (FR-004). */
  update(ctx) {
    const step = steps.shift();
    if (step == null) return;
    step(ctx);
    publish(ctx.scene, ctx.camera);
  },

  /** Regenerates nothing and re-attaches nothing (FR-011, US3-S9): a viewport
   * change moves no texel. Declared, not omitted, because it is the claim. */
  resize() {},
});
