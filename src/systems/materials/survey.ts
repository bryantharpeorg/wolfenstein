/**
 * The scene walk (US3-S2), split out of `register.ts` under Constitution IV's
 * 400-line ceiling. Two questions only, both answered off the objects that will
 * actually be drawn rather than off what the binding pass intended: is this mesh
 * a surface, and does the material it carries have an albedo map?
 */
import { Box3, InstancedMesh, Mesh, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import type { GameContext } from '../../boot/registry';
import { TILE_SIZE } from '../../level';
import { generationStats } from '../../materials/generate';
import { textureSurvey } from '../../materials/texture-adapter';

/**
 * How large a mesh has to be, on two axes, before the scene walk calls it a
 * surface and demands an albedo map of it (US3-S2).
 *
 * A wall run, a floor, a ceiling, a door leaf, a doorway shell and a push-wall
 * block all span at least one tile on two axes. A key is 0.36 across and a
 * pickup is 0.22, and neither is a surface this spec textures: 004 and 007
 * declare them as generated flat-coloured markers, deliberately, and colouring
 * them would be undoing that decision rather than honouring this one. A guard's
 * billboard *is* a tile across and is counted — and passes, because 006 gives it
 * its own generated sprite sheet.
 *
 * The threshold is what keeps this a real assertion rather than a tautology: a
 * merged wall run this system failed to recognise is caught here, because it is
 * large and mapless, not because anyone remembered to list it.
 */
const SURFACE_MIN_TILES = 1;

/** Axes that must reach that extent. A door leaf is 1 x 1.9 x 1; a key is 0.36 cubed. */
const SURFACE_MIN_AXES = 2;

export interface SceneSurvey {
  /** Every mesh reached by the walk, camera-parented ones excluded. */
  readonly meshes: number;
  /** Of those, the ones large enough to be a level surface. */
  readonly surfaces: number;
  /** Surfaces whose material carries no albedo map. Zero, or a bug (US3-S2). */
  readonly untexturedMeshes: number;
  /** Their names, so a failure names the surface rather than a count. */
  readonly untextured: string[];
  /** Distinct materials worn by those surfaces, and distinct albedo maps among
   *  them: equal counts mean one map set per material, shared (US3-S8). */
  readonly distinctMaterials: number;
  readonly distinctAlbedoMaps: number;
  readonly textureCount: number;
  readonly generatedMs: number;
}

const box = new Box3();
const size = new Vector3();

/** Whether a mesh is a level surface: big enough, in the world, and not a
 *  screen-space or instanced marker. */
function isLevelSurface(mesh: Mesh, camera: Object3D): boolean {
  if (mesh instanceof InstancedMesh) return false;
  for (let node: Object3D | null = mesh; node != null; node = node.parent) {
    if (node === camera) return false;
  }
  // Not the precise form: that walks every vertex of a merged run on every call,
  // and the geometry's own bounding box, transformed, is what "how big is this in
  // the world" means here.
  box.setFromObject(mesh, false);
  if (box.isEmpty()) return false;
  box.getSize(size);
  const spans = [size.x, size.y, size.z].filter(
    (extent) => extent >= SURFACE_MIN_TILES * TILE_SIZE - 1e-6,
  );
  return spans.length >= SURFACE_MIN_AXES;
}

function hasAlbedoMap(material: Material | Material[]): boolean {
  const entries = Array.isArray(material) ? material : [material];
  if (entries.length === 0) return false;
  return entries.every((entry) => (entry as { map?: unknown }).map != null);
}

/**
 * The scene, walked once after load (US3-S2). Everything reported here is read
 * off the objects that will actually be drawn, not off what `bindSurfaces`
 * intended: a surface that lost its material between setup and the first frame
 * is exactly what this is for.
 */
export function surveyScene(ctx: GameContext): SceneSurvey {
  let meshes = 0;
  let surfaces = 0;
  const untextured: string[] = [];
  const materials = new Set<Material>();
  const albedo = new Set<unknown>();

  ctx.scene.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    for (let node: Object3D | null = object; node != null; node = node.parent) {
      if (node === ctx.camera) return;
    }
    meshes += 1;
    if (!isLevelSurface(object, ctx.camera)) return;
    surfaces += 1;
    if (hasAlbedoMap(object.material)) {
      for (const entry of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(entry);
        albedo.add((entry as { map?: unknown }).map);
      }
    } else {
      untextured.push(object.name === '' ? '<unnamed mesh>' : object.name);
    }
  });

  return {
    meshes,
    surfaces,
    untexturedMeshes: untextured.length,
    untextured,
    distinctMaterials: materials.size,
    distinctAlbedoMaps: albedo.size,
    textureCount: textureSurvey().textures,
    generatedMs: generationStats().generatedMs,
  };
}

