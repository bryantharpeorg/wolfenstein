// The billboard: one camera-facing quad per guard, its frame taken from the
// shared sheet through `view-angle.ts` (FR-009, FR-010, US4-S1, US4-S3), its
// death animation advanced over the declared duration and then held (US4-S5,
// US4-S6), and its draw suppressed entirely when the guard is behind the camera
// (US4-S8).
//
// Two structural choices carry the story's cost claims. The material and the
// texture are shared by every guard of a type and only the *UVs* are per guard,
// so a frame change is four numbers written into a 4-vertex attribute rather
// than a second texture; and the quad is turned about Y alone, so its normal
// points at the camera in the horizontal plane while the guard stays upright --
// a full `lookAt` would lay the sprite back as the player looked down, which is
// the one way a billboard can look worse than the axis-aligned card US4-S1
// forbids.

import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { BufferAttribute } from 'three';
import { FLOOR_Y, TILE_SIZE } from '../level';
import { deathFrameIndex, walkFrameIndex } from './sprite-shape';
import type { SheetPlan } from './sprite-shape';
import { GUARD_TYPE, guardSpriteSheet } from './sprite-sheet';
import type { GuardSheet } from './sprite-sheet';
import type { GuardState } from './states';
import { viewAngleFor } from './view-angle';

/** The quad's edge in world units. Square, because a sheet cell is square: any
 *  other aspect would stretch the drawn figure. */
export const BILLBOARD_SIZE = 1.5 * TILE_SIZE;

/** Cells of movement per update below which the walk cycle does not advance, so
 *  an idle guard stands still instead of moonwalking on the spot. */
const MOVED_EPSILON = 1e-4;

/** What a billboard needs to know about a guard: `world.ts`'s record satisfies
 *  it structurally, so this module imports none of the guard machinery. */
export interface BillboardGuard {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly state: GuardState;
}

/** The camera, reduced to the two facts a billboard uses: where it stands and
 *  which way it looks, both on the level plane. */
export interface CameraPose {
  readonly x: number;
  readonly z: number;
  /** The unit forward vector's horizontal components. */
  readonly forwardX: number;
  readonly forwardZ: number;
}

export interface Billboard {
  readonly mesh: Mesh;
  /** The column last chosen, which is what the system writes back to `__diag`. */
  viewAngle: number;
  /** The sheet row last drawn. */
  frame: number;
  /** False when the guard was culled and issued no draw call (US4-S8). */
  visible: boolean;
  /** Milliseconds of walking, and of dying; the second one only ever grows. */
  walkElapsedMs: number;
  deathElapsedMs: number;
  /** Whether the death clock has started, so the first frame of the animation is
   *  rendered rather than stepped over by a long frame. */
  dying: boolean;
  lastX: number;
  lastZ: number;
}

// One material per guard type, holding that type's one texture: a frame is
// chosen by UVs, never by a second material (US4-S7).
const materials = new Map<string, MeshBasicMaterial>();

/**
 * The shared material for a sheet. `alphaTest` cuts the transparent cell around
 * the figure so the guard is a silhouette, not a card.
 *
 * It is a *cutout*, not a blend: `transparent` is deliberately left false. A
 * double-sided transparent material is drawn in two passes by three.js, which
 * would cost two draw calls per visible guard and break US4-S7's "no more than
 * one per visible guard" for no gain -- the sheet has no partial alpha in it.
 */
export function billboardMaterial(sheet: GuardSheet): MeshBasicMaterial {
  const existing = materials.get(sheet.type);
  if (existing != null) return existing;
  const material = new MeshBasicMaterial({
    map: sheet.texture,
    transparent: false,
    alphaTest: 0.5,
    side: DoubleSide,
    depthWrite: true,
  });
  materials.set(sheet.type, material);
  return material;
}

/** Whether the guard is in front of the camera's own plane. Behind it, nothing
 *  is drawn at all (US4-S8). */
export function isInFrontOfCamera(camera: CameraPose, guard: BillboardGuard): boolean {
  const dx = guard.x * TILE_SIZE - camera.x;
  const dz = guard.z * TILE_SIZE - camera.z;
  return dx * camera.forwardX + dz * camera.forwardZ > 0;
}

/** The yaw that turns the quad's +Z normal at the camera (US4-S1). */
export function billboardYaw(camera: CameraPose, guard: BillboardGuard): number {
  const dx = camera.x - guard.x * TILE_SIZE;
  const dz = camera.z - guard.z * TILE_SIZE;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** Writes one cell of the sheet onto a quad's four UVs. Row 0 is the top of the
 *  canvas and v grows upward, which is the one flip in this file. */
export function setBillboardFrame(mesh: Mesh, plan: SheetPlan, angle: number, frame: number): void {
  const uv = mesh.geometry.getAttribute('uv') as BufferAttribute | undefined;
  if (uv == null) return;
  const u0 = angle / plan.angles;
  const u1 = (angle + 1) / plan.angles;
  const vTop = 1 - frame / plan.frames;
  const vBottom = 1 - (frame + 1) / plan.frames;
  uv.setXY(0, u0, vTop);
  uv.setXY(1, u1, vTop);
  uv.setXY(2, u0, vBottom);
  uv.setXY(3, u1, vBottom);
  uv.needsUpdate = true;
}

/**
 * One guard's quad. The geometry is this guard's own — four vertices, so that
 * its UVs can name its own frame — while the material and texture are the
 * type's, shared (US4-S7).
 */
export function createBillboard(guard: BillboardGuard, sheet: GuardSheet = guardSpriteSheet(GUARD_TYPE)): Billboard {
  const geometry = new PlaneGeometry(BILLBOARD_SIZE, BILLBOARD_SIZE);
  const mesh = new Mesh(geometry, billboardMaterial(sheet));
  mesh.position.set(guard.x * TILE_SIZE, FLOOR_Y + BILLBOARD_SIZE / 2, guard.z * TILE_SIZE);
  // A quad whose normal is recomputed every frame must not be culled by a
  // stale bounding sphere; the cull this story owns is the one below.
  mesh.frustumCulled = false;

  const billboard: Billboard = {
    mesh,
    viewAngle: 0,
    frame: 0,
    visible: false,
    walkElapsedMs: 0,
    deathElapsedMs: 0,
    dying: false,
    lastX: guard.x,
    lastZ: guard.z,
  };
  setBillboardFrame(mesh, sheet.plan, 0, 0);
  return billboard;
}

/**
 * Advances one billboard by `deltaMs` and points it at the camera. Returns the
 * chosen column so the caller can publish it without reaching into the record.
 *
 * The death clock starts at the first update that sees `death` and only ever
 * grows, so the animation runs over its declared duration and then holds its
 * last frame for as long as the corpse lies there (US4-S5, US4-S6). A guard the
 * camera cannot see is stepped all the same -- its bearing is still true, and
 * `__diag.enemies[i].viewAngle` is read for guards the harness has not turned to
 * face -- but its mesh is made invisible, so it issues no draw call (US4-S8).
 */
export function updateBillboard(
  billboard: Billboard,
  guard: BillboardGuard,
  camera: CameraPose,
  plan: SheetPlan,
  deltaMs: number,
): number {
  const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;

  const angle = viewAngleFor(
    { x: guard.x, z: guard.z },
    guard.facing,
    { x: camera.x / TILE_SIZE, z: camera.z / TILE_SIZE },
  );
  billboard.viewAngle = angle;

  if (guard.state === 'death') {
    // The update that first sees `death` draws the *first* death frame however
    // long that frame was: a slow frame must not step over the start of the
    // animation, and after that the clock only ever grows.
    if (billboard.dying) billboard.deathElapsedMs += step;
    else billboard.dying = true;
    billboard.frame = deathFrameIndex(plan, billboard.deathElapsedMs);
  } else {
    const moved = Math.hypot(guard.x - billboard.lastX, guard.z - billboard.lastZ);
    if (moved > MOVED_EPSILON) billboard.walkElapsedMs += step;
    billboard.frame = walkFrameIndex(plan, billboard.walkElapsedMs);
  }
  billboard.lastX = guard.x;
  billboard.lastZ = guard.z;

  billboard.mesh.position.x = guard.x * TILE_SIZE;
  billboard.mesh.position.z = guard.z * TILE_SIZE;
  billboard.mesh.rotation.set(0, billboardYaw(camera, guard), 0);
  setBillboardFrame(billboard.mesh, plan, angle, billboard.frame);

  billboard.visible = isInFrontOfCamera(camera, guard);
  billboard.mesh.visible = billboard.visible;
  return angle;
}

/** Test seam only; production code keeps its material for the life of the page. */
export function resetBillboardMaterialsForTest(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
}
