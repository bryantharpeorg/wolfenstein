/**
 * The materials system: the one place US1's generated buffers, US2's derived maps
 * and US3's bindings meet the meshes 002 and 004 put in the scene (FR-008,
 * FR-009, FR-010).
 *
 * It edits no other system. 001's glob discovery finds this file, and everything
 * it needs to know about a mesh it works out from that mesh's own vertices
 * against the same grid 002 built them from — see `classifySurface`. The order is
 * above every system that adds a mesh in `setup`, so the walk sees the finished
 * scene once rather than chasing it.
 *
 * Two binding rules, and the difference between them matters:
 *
 *   * A **level surface** — a wall of a declared type, a door, a secret, the
 *     floor, the ceiling — has its UVs rewritten in world-tile space and is then
 *     handed the one shared material for its binding. Sharing is the whole
 *     draw-call argument: five materials, five map sets, however many meshes.
 *   * A **lit prop** this spec's table does not name — 004's keys, 007's pickup
 *     boxes — keeps its own material, because that material's colour is what
 *     tells a silver key from a gold one, and is lent the default material's maps
 *     so it is lit like the level instead of shading flat. The substitution is
 *     published as a fallback rather than passed over in silence (FR-008).
 *
 * Unlit meshes are left alone entirely: the enemy billboards and the HUD carry
 * sprite sheets 006 and 007 generate, and are not surfaces this spec skins.
 *
 * **Why the skinning is spread over frames.** Generating and deriving all five
 * materials at the declared resolution is about a third of a second of
 * arithmetic — see `src/materials/constants.ts`. Spent inside
 * `setup`, it is a third of a second in which the main thread cannot service an
 * animation frame — so the interval between the page's first and second frames
 * *is* that stall, and the frame rate the smoke harness samples right after load
 * is the load time rather than the frame time (US3-S11, and the reason the
 * merge-queue build measured 4.6 fps against a floor of 5). The work is the same
 * work and none of it is skipped: it is cut into steps and one step is taken per
 * frame, so no single frame owes more than one material's generation or one map's
 * upload, and the level finishes skinned inside the first half-second of
 * animation. `untexturedMeshes` counts down to zero as it goes, which is what the
 * smoke check waits on.
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
import {
  DEFAULT_MATERIAL,
  bindSurface,
  classifySurface,
  type Surface,
} from '../../materials/bindings';
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

/** What the harness reads back after a load, and after a resize (US3-S8, US3-S9). */
export interface MaterialsProbe {
  /** Meshes in the world whose material has an albedo slot and nothing in it. */
  readonly untexturedMeshes: number;
  /** Meshes the walk considered — a zero above means nothing unless this is not. */
  readonly worldMeshes: number;
  /** Distinct albedo textures across those meshes: one per material, not per mesh. */
  readonly albedoTextures: number;
  /** Distinct material objects across those meshes. */
  readonly materials: number;
  /** Distinct `DataTexture` objects the adapter has uploaded, all kinds. */
  readonly textures: number;
  /** Skinning steps still queued; zero once the level is fully skinned. */
  readonly pending: number;
  /** How many meshes carry each named material, so a missing surface is visible. */
  readonly byMaterial: Readonly<Record<string, number>>;
}

declare global {
  interface Window {
    /** Harness-only, as `__playerDrive` is: the scene walk is a render-loop fact. */
    __materialsProbe?: () => MaterialsProbe;
  }
}

/** After every system that adds a mesh in `setup` — 002's level (40), 004's doors
 * (45), keys (46) and secrets (47), 007's pickups (74) and the HUD (90). */
const ORDER = 96;

/** Geometries whose UVs have already been rewritten. 004 shares one box between
 * every push-wall block, so the same buffer can arrive twice. */
const uvWritten = new WeakSet<BufferGeometry>();

/** Level surfaces waiting on a material that has not been built yet. */
const waiting = new Map<MaterialName, Mesh[]>();
/** Props waiting on the default material's maps (FR-008's fallback path). */
const props: Mesh[] = [];
/** One entry per built material, for `__diag.materials.materials` (FR-015). */
const reports: MaterialMapReport[] = [];

/** One frame's worth of skinning. The queue is drained one step per frame. */
type SkinStep = (ctx: GameContext) => void;
let steps: SkinStep[] = [];

function isStandardMaterial(material: Material): material is MeshStandardMaterial {
  return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}

/** A material with an albedo slot, whether or not anything fills it. Both the lit
 * standard material and the unlit basic one have `map`; a depth or shadow
 * material does not, and is not a surface anyone could see a texture on. */
function hasAlbedoSlot(material: Material): material is Material & { map: unknown } {
  return 'map' in material;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Whether the camera is an ancestor: the HUD and the weapon viewmodel ride there,
 * and an overlay quad is not a surface of the level. */
function isOverlay(object: Object3D, camera: Camera): boolean {
  for (let node: Object3D | null = object; node != null; node = node.parent) {
    if (node === camera) return true;
  }
  return false;
}

/** Every mesh in the world, overlays excluded, in one stable traversal. */
function worldMeshes(scene: Object3D, camera: Camera): Mesh[] {
  const found: Mesh[] = [];
  scene.traverse((object) => {
    if ((object as Mesh).isMesh === true && !isOverlay(object, camera)) found.push(object as Mesh);
  });
  return found;
}

/**
 * What a mesh is. An `InstancedMesh` is never a level surface — 002 merges, it
 * does not instance — so it goes straight to the prop path rather than having its
 * one prototype box classified against whatever tile the origin happens to be.
 */
function surfaceOf(mesh: Mesh): Surface {
  if ((mesh as InstancedMesh).isInstancedMesh === true) return { kind: 'unknown' };
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  if (position == null || normal == null) return { kind: 'unknown' };
  const index = mesh.geometry.getIndex();
  return classifySurface(
    position.array,
    normal.array,
    index == null ? null : index.array,
    LEVEL_GRID,
    mesh.position,
  );
}

/**
 * Rewrites a geometry's UV attribute in world-tile space, before the material is
 * attached (FR-009, US3-S5). 002 emits a `0..1` quad UV per face, which a merge
 * turns into one brick stretched across twenty tiles; this replaces it with the
 * position-derived parameterisation, so the run reads as twenty bricks.
 *
 * The geometry's own coordinates are used, not world ones: a door leaf is drawn in
 * local space and slides, and its texture has to travel with it.
 */
function writeTileUVs(geometry: BufferGeometry): void {
  if (uvWritten.has(geometry)) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (position == null || normal == null) return;
  geometry.setAttribute('uv', new BufferAttribute(computeTileUVs(position.array, normal.array), 2));
  uvWritten.add(geometry);
}

/** Lends a prop the default material's maps without taking its colour away. */
function lendMaps(mesh: Mesh, fallback: MeshStandardMaterial): void {
  for (const material of materialsOf(mesh)) {
    if (!isStandardMaterial(material) || material.map != null) continue;
    material.map = fallback.map;
    material.normalMap = fallback.normalMap;
    material.roughnessMap = fallback.roughnessMap;
    material.needsUpdate = true;
  }
}

/**
 * Decides what every mesh in the scene is and what it will carry, and rewrites the
 * UVs of the ones this spec skins. Cheap — one classification and one attribute
 * per mesh — and therefore all `setup` does; nothing here generates a texel.
 */
function planBindings(scene: Object3D, camera: Camera): void {
  for (const mesh of worldMeshes(scene, camera)) {
    // Unlit meshes carry their own generated sprite sheets; skinning them would
    // replace a guard with a brick wall.
    if (!materialsOf(mesh).some(isStandardMaterial)) continue;

    const surface = surfaceOf(mesh);
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
  // Every declared material is built, in declaration order, so `textureCount`
  // lands on one set per material whatever the shipped level happens to use.
  steps = MATERIAL_NAMES.flatMap((name) => materialSteps(name));
}

/**
 * Uploads one finished map and waits for the renderer to have done it. Both
 * halves matter. A WebGL call only queues work — the rasteriser runs it later, on
 * its own thread — so without the read-back a megabyte of texel upload and its
 * mip chain land on whichever frame first draws a mesh that samples them, all
 * fifteen at once. Reading a pixel back blocks until the queue has drained, which
 * puts each map's upload in the frame that asked for it and nowhere else.
 */
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
    // A backend with neither hook simply uploads on first use, as before.
  }
}

/**
 * One material's skinning, cut into steps no one of which is a whole material.
 * Generation is the expensive half and gets a step to itself; each map's upload
 * gets another; the meshes are handed the finished material last, so nothing is
 * ever drawn with a map that has not been uploaded yet.
 */
function materialSteps(name: MaterialName): SkinStep[] {
  let set: MaterialMapSet | null = null;
  return [
    // US1's memo means the derivation step below re-reads this rather than
    // regenerating it (FR-004).
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
      if (name === DEFAULT_MATERIAL) {
        for (const mesh of props) lendMaps(mesh, material);
        props.length = 0;
      }
    },
  ];
}

/** The scene walk US3-S2 and US3-S8 are read from, run on demand so the harness
 * can ask again from a different camera position and after a resize. */
function probe(scene: Object3D, camera: Camera): MaterialsProbe {
  const meshes = worldMeshes(scene, camera);
  const albedo = new Set<string>();
  const materials = new Set<string>();
  const byMaterial: Record<string, number> = {};
  let untextured = 0;

  for (const mesh of meshes) {
    for (const material of materialsOf(mesh)) {
      if (!hasAlbedoSlot(material)) continue;
      materials.add(material.uuid);
      const map = material.map as { uuid: string } | null;
      if (map == null) {
        untextured += 1;
        continue;
      }
      albedo.add(map.uuid);
      const name = material.name === '' ? '(unnamed)' : material.name;
      byMaterial[name] = (byMaterial[name] ?? 0) + 1;
    }
  }

  return {
    untexturedMeshes: untextured,
    worldMeshes: meshes.length,
    albedoTextures: albedo.size,
    materials: materials.size,
    textures: textureCacheStats().textures,
    pending: steps.length,
    byMaterial,
  };
}

/** Publishes what the walk and the cache actually hold (FR-008, FR-010, US3-S2). */
function publish(scene: Object3D, camera: Camera): MaterialsProbe {
  const reading = probe(scene, camera);
  const cache = textureCacheStats();
  publishMaterialDiagnostics({
    generatedMs: generationStats().generatedMs,
    textureCount: cache.textures,
    bytes: cache.bytes,
    untexturedMeshes: reading.untexturedMeshes,
    materials: [...reports],
  });
  return reading;
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

  /** One skinning step per frame until the level is skinned, then a single shift
   * on an empty array forever after. Nothing is regenerated: US1's memo and the
   * adapter's cache make a second request for a built material a lookup (FR-004). */
  update(ctx) {
    const step = steps.shift();
    if (step == null) return;
    step(ctx);
    publish(ctx.scene, ctx.camera);
  },

  /**
   * Regenerates nothing and re-attaches nothing (FR-011, US3-S9). A viewport
   * change resizes the drawing buffer and the projection; it does not change a
   * texel, and rebuilding here would turn every window drag into fifteen
   * megabytes of noise. `generatedMs` and the uploaded texture count are
   * unchanged across a resize, and the smoke check reads both back to prove it.
   * The hook is declared rather than omitted because that is the assertion.
   */
  resize() {},
});
