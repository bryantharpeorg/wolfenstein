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
 * Skinning costs frames, and US3-S11 is the budget clause of the story's own
 * title. Generation and derivation happen on a worker (`generation.ts`), so the
 * expensive third of a second lands on no animation frame at all; what is left —
 * one upload, then the attach — is drained one step per frame, because the maps
 * arrive faster than a software renderer can take them.
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
  type MaterialMapReport,
  publishMaterialDiagnostics,
  recordFallback,
} from '../../materials/diagnostics';
import { generationStats } from '../../materials/generate';
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
import { type GeneratedMaps, type GenerationRun, startGeneration } from './generation';

/** What the harness reads back (US3-S8, US3-S9). The counts are paired: an
 * untextured zero is worth something only against the meshes walked. */
export interface MaterialsProbe {
  readonly untexturedMeshes: number;
  readonly worldMeshes: number;
  readonly albedoTextures: number;
  readonly textures: number;
  readonly pending: number;
  /** Whether the five materials were generated off the main thread (US3-S11). */
  readonly generatedOffThread: boolean;
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
const steps: SkinStep[] = [];

/** Materials not yet generated, so `pending` counts the work left rather than
 * only the work already delivered, and a dead worker knows what to finish. */
const ungenerated = new Set<MaterialName>();

/** The worker's own accumulated generation time (FR-004): `generationStats()`
 * on this thread stays at zero while the other thread does the generating. */
let offThreadGeneratedMs = 0;
let generation: GenerationRun = { offThread: false, stop() {} };

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
  for (const name of MATERIAL_NAMES) ungenerated.add(name);
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

/** What a finished material still costs a frame: one upload apiece — a WebGL
 * call only queues work, so the read-back keeps all fifteen mip chains off one
 * frame — then the attach, so nothing is drawn with a map not yet uploaded. */
function skinSteps(set: MaterialMapSet): SkinStep[] {
  const name = set.name;
  return [
    ...MAP_KINDS.map((kind) => (ctx: GameContext) => uploadMap(ctx, set, kind)),
    () => {
      const material = sharedMaterial(set);
      for (const mesh of waiting.get(name) ?? []) mesh.material = material;
      waiting.delete(name);
      if (name !== DEFAULT_MATERIAL) return;
      for (const mesh of props) lendMaps(mesh, material);
      props.length = 0;
    },
  ];
}

/** A material arriving from the worker: what it cost and what it degraded are
 * replayed onto this thread's diagnostics, then its frames are queued. */
function deliver(maps: GeneratedMaps): void {
  if (!ungenerated.delete(maps.name)) return;
  offThreadGeneratedMs = Math.max(offThreadGeneratedMs, maps.generatedMs);
  for (const fallback of maps.fallbacks) recordFallback(fallback);
  reports.push({ name: maps.name, hasNormal: maps.hasNormal, hasRoughness: maps.hasRoughness });
  steps.push(...skinSteps(maps));
}

/** No worker, or one that died: generate what is left on this thread, still one
 * material per frame so the cost is spread as far as a single thread allows. */
function generateHere(): void {
  for (const name of [...ungenerated]) {
    steps.push(() => {
      if (!ungenerated.delete(name)) return;
      const set = buildMaterialMaps(name);
      reports.push({ name, hasNormal: set.hasNormal, hasRoughness: set.hasRoughness });
      steps.push(...skinSteps(set));
    });
  }
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
    // Whichever thread generated: the other one's counter stays at zero (FR-004).
    generatedMs: Math.max(generationStats().generatedMs, offThreadGeneratedMs),
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
    // The maps still being generated are work left too, not only the frames queued.
    pending: steps.length + ungenerated.size,
    generatedOffThread: generation.offThread,
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
    // Started after the bindings so the worker generates while this thread is
    // still classifying, and before the first frame so no frame waits on it.
    generation = startGeneration(ungenerated.size, deliver, generateHere);
    if (!generation.offThread) generateHere();
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
