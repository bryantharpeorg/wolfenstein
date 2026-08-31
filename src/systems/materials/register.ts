// The materials system (FR-008 to FR-011): 002's merged geometry, skinned
// without spending the draw-call budget it won. Order 48 is above the level
// (40), the doors (45) and the secrets (47), so every surface exists to be
// bound; 001's glob discovery finds this file, so no shared file is edited.

import { Box3, BufferAttribute, InstancedMesh, Mesh, Vector3 } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_MESH_NAME, FLOOR_MESH_NAME, WALL_MESH_PREFIX } from '../../geometry/build';
import { DOOR_LEAF_MESH_PREFIX, DOOR_SHELL_MESH_NAME } from '../doors/register';
import { SECRET_BLOCK_MESH_PREFIX, SECRET_SHELL_MESH_NAME } from '../secrets/register';
import { LEVEL_GRID, TILE_SIZE } from '../../level';
import {
  BINDING_FALLBACK_MATERIAL,
  bindingSummary,
  materialForSecretCell,
  materialForSurface,
  materialForWallType,
} from '../../materials/bindings';
import { attachMaterialDiagnostics, publishMaterialDiagnostics } from '../../materials/diagnostics';
import { textureBytes } from '../../materials/maps';
import { TEXTURE_SIZE } from '../../materials/constants';
import { generationStats } from '../../materials/generate';
import type { MaterialName } from '../../materials/table';
import { builtTextures, sharedMaterials, textureSurvey } from '../../materials/texture-adapter';
import { computeTileUVs, uvBounds } from '../../materials/uv';

// Built as this module loads, not inside `setup`, or the second frame's delta
// swallows the load and the harness reads a rate no frame ran at (FR-004,
// US3-S11). Generation needs no renderer, so it waits for none.
const MATERIALS = sharedMaterials();

/** Surfaces walked, those with no albedo map — zero, or a bug (US3-S2) — and
 *  materials against albedo maps, equal only when maps are shared (US3-S8). */
export interface SceneSurvey {
  readonly surfaces: number;
  readonly untexturedMeshes: number;
  readonly untextured: string[];
  readonly distinctMaterials: number;
  readonly distinctAlbedoMaps: number;
}

const bound: { mesh: Mesh; surface: string; material: MaterialName }[] = [];
let published = false;

declare global {
  interface Window {
    /** The harness probe (007's `window.__hud.drawn()` again): what was bound,
     *  and the UV extent it carries, cannot be read off a drawn frame. */
    __materials?: {
      survey(): SceneSurvey;
      bindings(): { surface: string; material: string }[];
      textures(): ReturnType<typeof textureSurvey>;
      /** What each bound surface's UVs span, in repeats (US3-S5). */
      spans(): { surface: string; material: MaterialName; uSpan: number; vSpan: number }[];
    };
  }
}

/** Which material a named mesh wears, or null if the name is not a surface. */
function materialNameFor(name: string): MaterialName | null {
  if (name === FLOOR_MESH_NAME) return materialForSurface('floor');
  if (name === CEILING_MESH_NAME) return materialForSurface('ceiling');
  if (name === DOOR_SHELL_MESH_NAME || name.startsWith(DOOR_LEAF_MESH_PREFIX)) {
    return materialForSurface('door');
  }
  if (name === SECRET_SHELL_MESH_NAME) return firstSecretMaterial();
  if (name.startsWith(SECRET_BLOCK_MESH_PREFIX)) return secretMaterialFromName(name);
  if (name.startsWith(WALL_MESH_PREFIX)) {
    const type = name.slice(WALL_MESH_PREFIX.length);
    // 002 merges `D` and `S` tiles into wall groups 004 hides behind its leaves
    // and blocks; bound anyway, so an un-hidden group is never untextured.
    if (type === 'D') return materialForSurface('door');
    if (type === 'S') return firstSecretMaterial();
    return materialForWallType(type);
  }
  return null;
}

/** `secret-block-12,42` -> the material of the run that push-wall hides in; the
 *  merged `S` group and the shared recess shell span every secret, so they wear
 *  the first one's. */
function secretMaterialFromName(name: string): MaterialName {
  const [x, z] = name.slice(SECRET_BLOCK_MESH_PREFIX.length).split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return firstSecretMaterial();
  return materialForSecretCell(LEVEL_GRID, x!, z!);
}

/** The first push-wall's material: what the merged `S` group and the shared
 *  recess shell wear, both spanning every secret at once. */
function firstSecretMaterial(): MaterialName {
  for (let z = 0; z < LEVEL_GRID.length; z += 1) {
    const row = LEVEL_GRID[z]!;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === 'S') return materialForSecretCell(LEVEL_GRID, x, z);
    }
  }
  return BINDING_FALLBACK_MATERIAL;
}

const written = new Set<BufferGeometry>();
const worldPoint = new Vector3();

/** A geometry's UVs, rewritten in world-tile space (FR-009, US3-S5). Positions
 *  go through the world matrix first — a door leaf's box is centred on its own
 *  origin — so a leaf's bricks line up with the wall it sits in; a geometry two
 *  meshes share is cloned, so neither overwrites the other's UVs. */
function writeTileUVs(mesh: Mesh): void {
  let geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (position == null || normal == null) return;
  if (written.has(geometry)) {
    geometry = geometry.clone();
    mesh.geometry = geometry;
  }
  written.add(geometry);

  mesh.updateWorldMatrix(true, false);
  const count = position.count;
  const worldPositions = new Float32Array(count * 3);
  const worldNormals = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    worldPoint.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    worldPositions.set([worldPoint.x, worldPoint.y, worldPoint.z], i * 3);
    // The rotation half only: rotating a direction is enough to pick a plane out.
    worldPoint.fromBufferAttribute(normal, i).transformDirection(mesh.matrixWorld);
    worldNormals.set([worldPoint.x, worldPoint.y, worldPoint.z], i * 3);
  }
  geometry.setAttribute('uv', new BufferAttribute(computeTileUVs(worldPositions, worldNormals), 2));
}

function bindSurfaces(ctx: GameContext): void {
  ctx.scene.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    const name = materialNameFor(object.name);
    if (name == null) return;
    // T027: UVs first, so no frame samples a shared texture through 002's
    // per-quad 0..1 coordinates.
    writeTileUVs(object);
    const previous = object.material;
    object.material = MATERIALS[name];
    // Frees the flat colour this replaces; a shared one is disposed twice.
    if (previous !== object.material) for (const worn of materialsOf(previous)) worn.dispose();
    bound.push({ mesh: object, surface: object.name, material: name });
  });
}

/** How large a mesh must be, on how many axes, before the walk demands an albedo
 *  map of it (US3-S2). Runs, floor, ceiling, leaves, shells and blocks span a
 *  tile on two axes; 004's keys and 007's pickups do not, and are flat-coloured
 *  markers by those specs' own decision. The threshold is what keeps this from
 *  being a tautology: a missed run is caught for being large and mapless. */
const SURFACE_MIN_TILES = 1;
const SURFACE_MIN_AXES = 2;

const box = new Box3();
const size = new Vector3();

function isLevelSurface(mesh: Mesh, camera: Object3D): boolean {
  if (mesh instanceof InstancedMesh) return false;
  // Not the precise form: that walks every vertex of a merged run per call.
  box.setFromObject(mesh, false);
  if (box.isEmpty()) return false;
  box.getSize(size);
  const spans = [size.x, size.y, size.z].filter(
    (extent) => extent >= SURFACE_MIN_TILES * TILE_SIZE - 1e-6,
  );
  return spans.length >= SURFACE_MIN_AXES && !parentedTo(mesh, camera);
}

/** Screen-space markers hang off the camera and are not level surfaces. */
function parentedTo(mesh: Object3D, camera: Object3D): boolean {
  for (let node: Object3D | null = mesh; node != null; node = node.parent) {
    if (node === camera) return true;
  }
  return false;
}

const materialsOf = (worn: Material | Material[]): Material[] =>
  Array.isArray(worn) ? worn : [worn];
const albedoOf = (material: Material): unknown => (material as { map?: unknown }).map;

/** The scene, walked once after load (US3-S2), read off the objects that will be
 *  drawn rather than off what `bindSurfaces` intended. */
function surveyScene(ctx: GameContext): SceneSurvey {
  let surfaces = 0;
  const untextured: string[] = [];
  const materials = new Set<Material>();
  const albedo = new Set<unknown>();

  ctx.scene.traverse((object: Object3D) => {
    if (!(object instanceof Mesh) || !isLevelSurface(object, ctx.camera)) return;
    surfaces += 1;
    const worn = materialsOf(object.material);
    if (worn.length === 0 || worn.some((entry) => albedoOf(entry) == null)) {
      untextured.push(object.name === '' ? '<unnamed mesh>' : object.name);
      return;
    }
    for (const entry of worn) {
      materials.add(entry);
      albedo.add(albedoOf(entry));
    }
  });

  return {
    surfaces,
    untexturedMeshes: untextured.length,
    untextured,
    distinctMaterials: materials.size,
    distinctAlbedoMaps: albedo.size,
  };
}

/** Uploads the maps and links the programs during load, so the first frame does
 *  not pay for fifteen mip chains (US3-S11) — as 008's post chain does at build
 *  time. `compile` is reached by a local cast, as US4 reaches `shadowMap`. */
function warmPipeline(ctx: GameContext): void {
  const renderer = ctx.renderer as {
    compile?: (scene: unknown, camera: unknown) => unknown;
    initTexture?: (texture: unknown) => void;
  };
  // WebGPU answers with promises; an unadopted rejection is a page fault.
  const settled = (result: unknown): void => {
    (result as { catch?: (onRejected: () => void) => unknown } | null)?.catch?.(() => {});
  };
  try {
    for (const texture of builtTextures()) renderer.initTexture?.(texture);
    settled(renderer.compile?.(ctx.scene, ctx.camera));
    // And one frame here: a driver defers a link and a mip chain to the draw
    // that needs them, so the only way to be sure they are paid is to pay them.
    settled(ctx.renderer.render(ctx.scene, ctx.camera) as unknown);
  } catch {
    // Warming is an optimisation, never a precondition.
  }
}

function publish(ctx: GameContext): void {
  const textures = textureSurvey();
  publishMaterialDiagnostics({
    untexturedMeshes: surveyScene(ctx).untexturedMeshes,
    textureCount: textures.textures,
    bytes: textureBytes(TEXTURE_SIZE, textures.textures),
    generatedMs: generationStats().generatedMs,
  });
  attachMaterialDiagnostics(ctx.diag);
}

defineSystem({
  name: 'materials',
  order: 48,
  setup(ctx) {
    bindSurfaces(ctx);
    warmPipeline(ctx);
    // From setup as well as the first frame, so a harness reading before a
    // frame lands sees real numbers, not US2's zeroes.
    publish(ctx);
    window.__materials = {
      survey: () => surveyScene(ctx),
      bindings: () => bindingSummary().map((entry) => ({ ...entry })),
      textures: () => textureSurvey(),
      spans: () =>
        bound.map(({ mesh, surface, material }) => {
          const uv = mesh.geometry.getAttribute('uv');
          const at = uvBounds(uv == null ? [] : (uv.array as ArrayLike<number>));
          return { surface, material, uSpan: at.maxU - at.minU, vSpan: at.maxV - at.minV };
        }),
    };
  },
  update(ctx) {
    // Once, on the first frame: every setup has run, so the walk sees the scene
    // as drawn (US3-S2). Not per frame — that is a cost.
    if (published) return;
    published = true;
    publish(ctx);
  },
  // FR-011 / US3-S9: declared and empty on purpose — a viewport change
  // regenerates nothing, so `generatedMs` and the texture count are unmoved.
  resize() {},
});
