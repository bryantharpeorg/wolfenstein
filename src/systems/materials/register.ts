// The materials system: tile-space UVs onto the merged geometry, one shared
// material per name onto the meshes, and the derivation that produces them kept
// off the animation frame (T027, T029, T040 — FR-009, FR-011, US4-S1..S6).
//
// Three things are load-bearing here and none of them is the wiring.
//
//   * UVs are written from `materials/uv.ts` *before* any material is attached,
//     so the first frame that shows a texture already tiles per world tile: a
//     twenty-tile run is twenty bricks, never one stretched one.
//   * The material comes from `texture-adapter.ts`'s per-name cache, so meshes
//     sharing a material share its maps. The uploaded texture count follows the
//     number of materials, not the number of meshes.
//   * Derivation runs on a worker. Building five materials is arithmetic the
//     page would otherwise do inside a frame it owes the render loop; here it
//     happens on a thread that owes it nothing, and the finished buffers are
//     transferred rather than copied. Where a worker cannot be had, the same
//     work is cut into one material per frame — the cost moves, the floor does
//     not (US4-S6).
//
// `resize()` is deliberately empty of work. Textures are page-lifetime
// resources keyed by material name; a viewport change touches neither, which is
// what makes `generatedMs` and the uploaded set constant across one (US4-S4).

import { BufferAttribute, Mesh } from 'three';
import type { BufferGeometry, Material } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_MESH_NAME, FLOOR_MESH_NAME, wallMeshName } from '../../geometry/build';
import { computeTileUVs, countStretchedQuads, uvSpan } from '../../materials/uv';
import {
  cachedMaterialNames,
  resolveAnisotropy,
  sharedMaterial,
  TEXTURE_ANISOTROPY,
} from '../../materials/texture-adapter';
import { buildMaterialMaps } from '../../materials/maps';
import { generationStats } from '../../materials/generate';
import { MATERIAL_NAMES } from '../../materials/table';
import type { MaterialName } from '../../materials/table';
import {
  attachMaterialDiagnostics,
  materialDiagnostics,
  publishMaterialDiagnostics,
} from '../../materials/diagnostics';
import { toUpload, type DerivedMaterials, type MaterialUpload } from './upload';

/**
 * Which material each merged surface wears. Provisional and local on purpose:
 * 005's US3 owns the binding table (`src/materials/bindings.ts`, FR-008) and
 * supersedes this map when it lands. What this story needs from it is only that
 * every one of the five materials is in use and that several meshes share one,
 * so "one map set per material, not per mesh" is a claim with teeth.
 */
const SURFACE_MATERIALS: Readonly<Record<string, MaterialName>> = {
  [wallMeshName('1')]: 'stone',
  [wallMeshName('2')]: 'brick',
  [wallMeshName('3')]: 'steel',
  [wallMeshName('4')]: 'wood',
  [wallMeshName('5')]: 'blood-stone',
  [wallMeshName('D')]: 'wood',
  [wallMeshName('S')]: 'stone',
  [FLOOR_MESH_NAME]: 'stone',
  [CEILING_MESH_NAME]: 'blood-stone',
};

/** What the harness reads. Not a `__diag` field: it is a probe of live renderer
 *  objects, which is exactly what `__diag` is not for. */
export interface MaterialsProbe {
  applied: boolean;
  /** True when derivation ran on a worker rather than on the page's frames. */
  offFrame: boolean;
  /** How many times the maps have been derived. One, for the page's lifetime. */
  builds: number;
  resizes: number;
  generatedMs: number;
  /** Level meshes this system bound a generated material to. */
  meshes: number;
  /** Distinct material names in use, sorted. */
  materialNames: string[];
  /** Distinct `MeshStandardMaterial` objects across those meshes. */
  materialInstances: number;
  /** Distinct texture UUIDs across those materials, sorted. */
  textures: string[];
  mapsPerMaterial: Record<string, number>;
  mipmapped: boolean;
  repeatWrapped: boolean;
  anisotropy: number;
  maxAnisotropy: number;
  /** Faces whose UV span disagrees with their world extent in tiles. Zero. */
  stretchedFaces: number;
  /** The longest run of repeats on any bound surface, in tiles. */
  longestRunRepeats: number;
}

declare global {
  interface Window {
    __materialsProbe?: () => MaterialsProbe;
  }
}

const targets: Mesh[] = [];
let builds = 0;
let resizes = 0;
let applied = false;
let offFrame = false;
let anisotropy = TEXTURE_ANISOTROPY;
let maxAnisotropy = TEXTURE_ANISOTROPY;
let stretchedFaces = 0;
let longestRunRepeats = 0;
/** Materials still to derive on the fallback path, one per frame. */
let pending: MaterialName[] = [];

function attribute(geometry: BufferGeometry, name: string): Float32Array | null {
  const found = geometry.getAttribute(name);
  return found?.array instanceof Float32Array ? found.array : null;
}

/** T027: world-tile UVs onto the merged geometry, before anything is attached. */
function writeTileUVs(mesh: Mesh): void {
  const geometry = mesh.geometry;
  const positions = attribute(geometry, 'position');
  const normals = attribute(geometry, 'normal');
  if (positions == null || normals == null) return;

  const uvs = computeTileUVs(positions, normals);
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  stretchedFaces += countStretchedQuads(positions, normals, uvs);
  longestRunRepeats = Math.max(longestRunRepeats, uvSpan(uvs).u);
}

function readMaxAnisotropy(ctx: GameContext): number {
  const capabilities = (
    ctx.renderer as { capabilities?: { getMaxAnisotropy?: () => number } }
  ).capabilities;
  const reported = capabilities?.getMaxAnisotropy?.();
  return typeof reported === 'number' && reported >= 1 ? reported : TEXTURE_ANISOTROPY;
}

/** Attaches one material's shared instance to every mesh bound to its name. */
function attach(upload: MaterialUpload): void {
  const material = sharedMaterial(upload, maxAnisotropy);
  for (const mesh of targets) {
    if (SURFACE_MATERIALS[mesh.name] !== upload.name) continue;
    const previous = mesh.material as Material;
    mesh.material = material;
    if (previous !== material) previous.dispose();
  }
}

function publish(derived: DerivedMaterials): void {
  for (const upload of derived.uploads) attach(upload);
  const bound = targets.filter((mesh) => (mesh.material as Material).name !== '').length;
  publishMaterialDiagnostics({
    generatedMs: derived.generatedMs,
    textureCount: derived.textureCount,
    bytes: derived.bytes,
    materials: [...derived.materials],
    fallbacks: [...derived.fallbacks],
    untexturedMeshes: targets.length - bound,
  });
  applied = true;
}

/** T040's primary path: the whole derivation on a thread that owes no frames. */
function deriveOnWorker(): boolean {
  if (typeof Worker === 'undefined') return false;
  try {
    const worker = new Worker(new URL('./maps.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DerivedMaterials>) => {
      builds += 1;
      offFrame = true;
      publish(event.data);
      worker.terminate();
    };
    worker.onerror = () => {
      worker.terminate();
      pending = [...MATERIAL_NAMES];
    };
    worker.postMessage('derive');
    return true;
  } catch {
    return false;
  }
}

/** T040's fallback: the same work, cut into one material per frame. */
function deriveOneStep(): void {
  const name = pending.shift();
  if (name == null) return;
  const upload = toUpload(buildMaterialMaps(name));
  attach(upload);
  if (pending.length > 0) return;

  builds += 1;
  const stats = generationStats();
  const bound = targets.filter((mesh) => (mesh.material as Material).name !== '').length;
  publishMaterialDiagnostics({
    generatedMs: stats.generatedMs,
    untexturedMeshes: targets.length - bound,
  });
  applied = true;
}

function probe(): MaterialsProbe {
  const materials = new Map<string, Material>();
  const textures = new Set<string>();
  const mapsPerMaterial: Record<string, number> = {};
  let mipmapped = true;
  let repeatWrapped = true;

  for (const mesh of targets) {
    const material = mesh.material as Material & {
      map?: { uuid: string; generateMipmaps: boolean; wrapS: number; anisotropy: number } | null;
      normalMap?: { uuid: string } | null;
      roughnessMap?: { uuid: string } | null;
    };
    if (material.name === '') continue;
    materials.set(material.uuid, material);
    const maps = [material.map, material.normalMap, material.roughnessMap];
    let count = 0;
    for (const map of maps) {
      if (map == null) continue;
      count += 1;
      textures.add(map.uuid);
      const sampler = map as { generateMipmaps?: boolean; wrapS?: number };
      if (sampler.generateMipmaps !== true) mipmapped = false;
      // 1000 is three's RepeatWrapping; compared numerically so the probe does
      // not need the enum, and a change away from repeat fails the harness.
      if (sampler.wrapS !== 1000) repeatWrapped = false;
    }
    mapsPerMaterial[material.name] = count;
  }

  return {
    applied,
    offFrame,
    builds,
    resizes,
    // Read from the published record, not from this thread's generator: on the
    // worker path the page never generated anything, which is the point.
    generatedMs: materialDiagnostics().generatedMs,
    meshes: targets.length,
    materialNames: cachedMaterialNames(),
    materialInstances: materials.size,
    textures: [...textures].sort(),
    mapsPerMaterial,
    mipmapped,
    repeatWrapped,
    anisotropy,
    maxAnisotropy,
    stretchedFaces,
    longestRunRepeats,
  };
}

defineSystem({
  name: 'materials',
  order: 48,
  setup(ctx) {
    maxAnisotropy = readMaxAnisotropy(ctx);
    anisotropy = resolveAnisotropy(maxAnisotropy);

    ctx.scene.traverse((object) => {
      if (object instanceof Mesh && SURFACE_MATERIALS[object.name] != null) targets.push(object);
    });
    for (const mesh of targets) writeTileUVs(mesh);

    attachMaterialDiagnostics(ctx.diag);
    publishMaterialDiagnostics({ untexturedMeshes: targets.length });
    window.__materialsProbe = probe;

    if (!deriveOnWorker()) pending = [...MATERIAL_NAMES];
  },
  update() {
    if (pending.length > 0) deriveOneStep();
  },
  // T029 / US4-S4: a viewport change regenerates nothing and re-attaches
  // nothing. Counting the resizes is the whole body, so the harness can prove
  // one happened and that the texture set did not move.
  resize() {
    resizes += 1;
  },
});

/** Test seam only. */
export function resetMaterialsSystemForTest(): void {
  targets.length = 0;
  builds = 0;
  resizes = 0;
  applied = false;
  offFrame = false;
  pending = [];
  stretchedFaces = 0;
  longestRunRepeats = 0;
}
