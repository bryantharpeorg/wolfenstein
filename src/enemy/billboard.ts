// One camera-facing quad per guard: its frame taken from the shared sheet
// through `view-angle.ts` (FR-009, FR-010, US4-S1, US4-S3), its death animation
// advanced over the declared duration and then held (US4-S5, US4-S6), its draw
// suppressed when the guard is behind the camera (US4-S8). Material and texture
// are shared per type with only the *UVs* per guard, and the quad turns about Y
// alone so the guard stays upright as the player looks down (DECISIONS.md).

import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { BufferAttribute } from 'three';
import { FLOOR_Y, TILE_SIZE } from '../level';
import { deathFrameIndex, walkFrameIndex } from './sprite-shape';
import type { SheetPlan } from './sprite-shape';
import { GUARD_TYPE, guardSpriteSheet } from './sprite-sheet';
import type { GuardSheet } from './sprite-sheet';
import type { GuardState } from './states';
import { viewAngleFor } from './view-angle';

/** The quad's edge in world units. Square, because a sheet cell is square. */
export const BILLBOARD_SIZE = 1.5 * TILE_SIZE;

/** Movement per update below which the walk cycle does not advance, so an idle
 *  guard stands still instead of moonwalking. */
const MOVED_EPSILON = 1e-4;

/** What a billboard needs of a guard. `world.ts`'s record satisfies it
 *  structurally, so none of the guard machinery is imported here. */
export interface BillboardGuard {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly state: GuardState;
}

/** The camera, reduced to the two facts a billboard uses: where it stands, and
 *  its unit forward vector's horizontal components. */
export interface CameraPose {
  readonly x: number;
  readonly z: number;
  readonly forwardX: number;
  readonly forwardZ: number;
}

export interface Billboard {
  readonly mesh: Mesh;
  /** The column last chosen; the system writes it to `__diag`. */
  viewAngle: number;
  /** The sheet row last drawn. */
  frame: number;
  /** False when the guard was culled and issued no draw call (US4-S8). */
  visible: boolean;
  walkElapsedMs: number;
  deathElapsedMs: number;
  /** Whether the death clock has started, so a long frame cannot step over the
   *  animation's first frame. */
  dying: boolean;
  lastX: number;
  lastZ: number;
}

// One material per guard type, holding that type's one texture: a frame is
// chosen by UVs, never by a second material (US4-S7).
const materials = new Map<string, MeshBasicMaterial>();

/** The shared material for a sheet: a *cutout*, not a blend. `alphaTest` carves
 *  the figure out of its transparent cell and `transparent` stays false, so
 *  three.js draws one pass per guard rather than two (US4-S7). */
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

/** One cell of the sheet onto a quad's four UVs. Row 0 is the top of the canvas
 *  and v grows upward: the one flip in this file. */
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

/** One guard's quad: its own four-vertex geometry, so its UVs name its own
 *  frame, over the type's shared material and texture (US4-S7). */
export function createBillboard(guard: BillboardGuard, sheet: GuardSheet = guardSpriteSheet(GUARD_TYPE)): Billboard {
  const geometry = new PlaneGeometry(BILLBOARD_SIZE, BILLBOARD_SIZE);
  const mesh = new Mesh(geometry, billboardMaterial(sheet));
  mesh.position.set(guard.x * TILE_SIZE, FLOOR_Y + BILLBOARD_SIZE / 2, guard.z * TILE_SIZE);
  // A normal recomputed every frame must not be culled by a stale bounding
  // sphere; the cull this story owns is `isInFrontOfCamera`.
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

/** Advances one billboard by `deltaMs` and points it at the camera, returning
 *  the chosen column. A guard the camera cannot see is stepped all the same —
 *  its bearing stays true and `__diag` reports it — but its mesh is made
 *  invisible, so it issues no draw call (US4-S8). */
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
    // long it was; after that the clock only grows (US4-S5, US4-S6).
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

/** Test seam only; production keeps its material for the life of the page. */
export function resetBillboardMaterialsForTest(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
}
