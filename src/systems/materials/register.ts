/**
 * The materials system: where the merged geometry 002 emitted gets skinned
 * without any of the draw-call budget it won being spent (FR-008, FR-009,
 * FR-010, FR-011).
 *
 * Order 48 is deliberate — after the level system (40), the doors (45) and the
 * secrets (47), so every surface this spec is responsible for already exists in
 * the scene, and before anything that reads a material back. `src/main.ts` and
 * `src/boot/registry.ts` are not edited: 001's glob discovery finds this file.
 *
 * What happens here, and only here:
 *   - every map set is built once, through `src/materials/maps.ts`;
 *   - each surface's UV attribute is rewritten in world-tile space *before* its
 *     material is attached, so a 20-tile wall run reads as twenty bricks;
 *   - one shared `MeshStandardMaterial` per material name is attached, so five
 *     materials upload five map sets however many meshes wear them;
 *   - the scene is walked once after load and what it found is published; that
 *     walk lives in `./survey.ts`, split out under Constitution IV's ceiling.
 *
 * `resize` is declared and does nothing on purpose: FR-011 says a viewport
 * change regenerates no texture, and the cheapest way to mean that is a hook
 * that provably re-attaches nothing.
 */
import { BufferAttribute, Mesh, Vector3 } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_MESH_NAME, FLOOR_MESH_NAME, WALL_MESH_PREFIX } from '../../geometry/build';
import { DOOR_LEAF_MESH_PREFIX, DOOR_SHELL_MESH_NAME } from '../doors/register';
import { SECRET_BLOCK_MESH_PREFIX, SECRET_SHELL_MESH_NAME } from '../secrets/register';
import { LEVEL_GRID } from '../../level';
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
import { surveyScene, type SceneSurvey } from './survey';

/**
 * Every map set, built the moment this module is loaded — before the renderer
 * exists, let alone the frame loop. Nothing under `src/materials/` needs a
 * renderer to produce a texel (FR-001), so nothing about generation has to wait
 * for one, and a page-load cost paid before the first frame is a cost no frame
 * pays (FR-004, US3-S11).
 *
 * This placement is load-bearing, not stylistic. Building inside `setup` put
 * roughly 300ms of generation inside the interval `recordFrame` goes on to
 * sample: the browser hands the first `requestAnimationFrame` a timestamp from
 * before that block ran, so the *second* frame's delta swallows the whole load
 * and the harness reads a frame rate no frame ever ran at. Moved here, the same
 * work happens while the module graph is still evaluating and the frame loop
 * measures frames.
 */
const MATERIALS = sharedMaterials();

export interface BoundSurface {
  readonly mesh: Mesh;
  readonly surface: string;
  readonly material: MaterialName;
}

const bound: BoundSurface[] = [];
let published = false;

declare global {
  interface Window {
    /** The harness probe (`tools/smoke-checks/materials.mjs`). Following 007's
     *  `window.__hud.drawn()`: a claim about what was actually bound cannot be
     *  read back out of a rendered frame, so the scene walk is exposed. */
    __materials?: {
      survey(): SceneSurvey;
      bindings(): { surface: string; material: string }[];
      textures(): ReturnType<typeof textureSurvey>;
      /** The UV extent every bound surface actually carries, in repeats — the
       *  runtime half of US3-S5, which the unit tests decide for the pure
       *  function but not for the geometry the page ships. */
      spans(): { surface: string; material: string; uSpan: number; vSpan: number }[];
    };
  }
}

/** Which material a named mesh wears, or null if the name is not a surface. */
function materialNameFor(name: string): MaterialName | null {
  if (name === FLOOR_MESH_NAME) return materialForSurface('floor');
  if (name === CEILING_MESH_NAME) return materialForSurface('ceiling');
  if (name === DOOR_SHELL_MESH_NAME) return materialForSurface('door');
  if (name.startsWith(DOOR_LEAF_MESH_PREFIX)) return materialForSurface('door');
  // The recess shell spans every push-wall at once, so it wears the first one's
  // material rather than any single tile's.
  if (name === SECRET_SHELL_MESH_NAME) return firstSecretMaterial();
  if (name.startsWith(SECRET_BLOCK_MESH_PREFIX)) return secretMaterialFromName(name);
  if (name.startsWith(WALL_MESH_PREFIX)) {
    const type = name.slice(WALL_MESH_PREFIX.length);
    // 002 merges the `D` and `S` tiles into wall groups of their own, which 004
    // hides behind its leaves and blocks. They are bound anyway, and bound as
    // what they are, so an un-hidden group is never an untextured one.
    if (type === 'D') return materialForSurface('door');
    if (type === 'S') return firstSecretMaterial();
    return materialForWallType(type);
  }
  return null;
}

/** `secret-block-12,42` -> the material of the run that push-wall hides in. */
function secretMaterialFromName(name: string): MaterialName {
  const tile = name.slice(SECRET_BLOCK_MESH_PREFIX.length).split(',');
  const x = Number(tile[0]);
  const z = Number(tile[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return firstSecretMaterial();
  return materialForSecretCell(LEVEL_GRID, x, z);
}

/** The material of the level's first push-wall: what the merged `S` group and
 *  the shared recess shell wear, both of which span every secret at once. */
function firstSecretMaterial(): MaterialName {
  for (let z = 0; z < LEVEL_GRID.length; z += 1) {
    const row = LEVEL_GRID[z]!;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === 'S') return materialForSecretCell(LEVEL_GRID, x, z);
    }
  }
  return BINDING_FALLBACK_MATERIAL;
}

/**
 * Rewrites a geometry's UV attribute in world-tile space (FR-009, US3-S5).
 * Positions are taken through the mesh's world matrix first: 002's merged runs
 * are already in world coordinates, but a door leaf's box is centred on its own
 * origin, and tiling both from the same rule is what makes a leaf's bricks line
 * up with the wall it sits in.
 *
 * A geometry shared by more than one mesh is cloned before it is written, so two
 * push-walls in different runs do not overwrite each other's UVs.
 */
const written = new Set<BufferGeometry>();
const worldPoint = new Vector3();

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
    worldPositions[i * 3] = worldPoint.x;
    worldPositions[i * 3 + 1] = worldPoint.y;
    worldPositions[i * 3 + 2] = worldPoint.z;
    // The rotation half only: a normal is a direction, and every mesh in this
    // scene is axis-aligned, so transforming the direction is enough to pick the
    // face's plane back out of it.
    worldPoint
      .fromBufferAttribute(normal, i)
      .transformDirection(mesh.matrixWorld);
    worldNormals[i * 3] = worldPoint.x;
    worldNormals[i * 3 + 1] = worldPoint.y;
    worldNormals[i * 3 + 2] = worldPoint.z;
  }
  geometry.setAttribute('uv', new BufferAttribute(computeTileUVs(worldPositions, worldNormals), 2));
}

/** Frees the flat-coloured material 002 or 004 put on a mesh this spec replaces. */
function disposeMaterial(material: Material | Material[]): void {
  for (const entry of Array.isArray(material) ? material : [material]) {
    // Shared between meshes (004's one leaf material for every door), so a
    // second dispose is a no-op three.js already tolerates.
    entry.dispose();
  }
}

function bindSurfaces(ctx: GameContext): void {
  // The map sets were built when this module loaded; this only attaches them.
  ctx.scene.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    const name = materialNameFor(object.name);
    if (name == null) return;
    // T027: the UVs are written *before* the material is attached, so no frame
    // ever samples a shared texture through 002's per-quad 0..1 coordinates.
    writeTileUVs(object);
    const previous = object.material;
    object.material = MATERIALS[name];
    if (previous !== object.material) disposeMaterial(previous);
    bound.push({ mesh: object, surface: object.name, material: name });
  });
}

/**
 * Uploads the maps and compiles the programs *now*, during load, rather than
 * letting the first rendered frame pay for them (US3-S11). Fifteen full-resolution
 * maps and their mip chains are tens of milliseconds of work on a software
 * rasterizer, and a frame that pays it is a visible hitch on the frame the
 * player first sees — the same cost, moved off the render loop.
 *
 * `compile` is reached by a local cast rather than by widening `GameContext`:
 * 001's shared interface stays as it is, exactly as US4 reaches `shadowMap`.
 * A renderer that does not offer it simply pays on the first frame instead.
 */
function warmPipeline(ctx: GameContext): void {
  const renderer = ctx.renderer as {
    compile?: (scene: unknown, camera: unknown) => unknown;
    initTexture?: (texture: unknown) => void;
  };
  try {
    for (const texture of builtTextures()) renderer.initTexture?.(texture);
    const result = renderer.compile?.(ctx.scene, ctx.camera);
    // WebGPU answers with a promise; nothing here waits on it, because a
    // renderer that warms asynchronously is still warmer than one that does not.
    void result;
    // And one frame drawn here, at load: a driver defers the real work of a
    // program link and a mip chain to the draw that first needs it, so the only
    // way to be sure the cost is paid before the loop starts is to pay it. 008's
    // post chain builds itself the same way, for the same reason.
    ctx.renderer.render(ctx.scene, ctx.camera);
  } catch {
    // Warming is an optimisation, never a precondition: a renderer that refuses
    // renders the same frames, one of them more slowly.
  }
}

function publish(ctx: GameContext): void {
  const survey = surveyScene(ctx);
  const textures = textureSurvey();
  publishMaterialDiagnostics({
    untexturedMeshes: survey.untexturedMeshes,
    textureCount: textures.textures,
    bytes: textureBytes(TEXTURE_SIZE, textures.textures),
    generatedMs: generationStats().generatedMs,
  });
  attachMaterialDiagnostics(ctx.diag);
}

defineSystem({
  name: 'materials',
  // Above 002's level geometry (40), and above 004's doors (45) and secrets (47),
  // so every surface exists to be bound.
  order: 48,
  setup(ctx) {
    bindSurfaces(ctx);
    warmPipeline(ctx);
    // Published from setup as well as from the first frame, so a harness that
    // reads `__diag.materials` before a frame lands sees the real numbers rather
    // than US2's zeroes.
    publish(ctx);
    window.__materials = {
      survey: () => surveyScene(ctx),
      bindings: () => bindingSummary().map((entry) => ({ ...entry })),
      textures: () => textureSurvey(),
      spans: () =>
        bound.map((entry) => {
          const uv = entry.mesh.geometry.getAttribute('uv');
          const bounds = uvBounds(uv == null ? [] : (uv.array as ArrayLike<number>));
          return {
            surface: entry.surface,
            material: entry.material,
            uSpan: bounds.maxU - bounds.minU,
            vSpan: bounds.maxV - bounds.minV,
          };
        }),
    };
  },
  update(ctx) {
    // Once, on the first frame: by now every system's setup has run, so the walk
    // sees the scene as it is actually drawn (US3-S2). Not every frame — a scene
    // traversal per frame is a cost this spec exists to avoid spending.
    if (published) return;
    published = true;
    publish(ctx);
  },
  resize() {
    // FR-011 / US3-S9: a viewport change regenerates nothing and re-attaches
    // nothing. `generatedMs` and the uploaded texture count are read after a
    // resize by `tools/smoke-checks/materials.mjs` and must be unmoved.
  },
});
