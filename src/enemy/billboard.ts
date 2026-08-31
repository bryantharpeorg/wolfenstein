// One camera-facing quad per guard (FR-009, FR-010, US4-S1, US4-S3, US4-S5). The
// normal is pointed at the camera every frame, so a guard is solid from every bearing
// rather than a card that vanishes edge-on. Which cell it shows is two indices — the
// column from `./view-angle.ts`, the row from the state and its time in it — written
// into the quad's four UVs, so every guard shares one material and one texture
// (US4-S7). The frame arithmetic is pure and exported, putting US4-S5 under vitest.

import { Frustum, Mesh, MeshBasicMaterial, PlaneGeometry, type Vector3 } from 'three';
import type { GuardState } from './states';
import {
  DEATH_DURATION_MS,
  DEATH_FRAMES,
  WALK_FRAMES,
  frameIndexOf,
  type GuardFrame,
  type SheetPlan,
} from './sprite-shape';
import type { GuardSheet } from './sprite-sheet';
import { viewAngleIndexFromPositions } from './view-angle';

export const BILLBOARD_WIDTH = 1;
export const BILLBOARD_HEIGHT = 1.6;

export const WALK_FRAME_MS = 140;
export const DEATH_FRAME_MS = DEATH_DURATION_MS / DEATH_FRAMES.length;

export interface GuardView {
  readonly state: GuardState;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
}

/** Through the declared frames over `DEATH_DURATION_MS`, then holding the last one
 *  forever — US4-S5 in one line. */
export function deathFrame(elapsedMs: number): GuardFrame {
  const step = Math.floor(Math.max(0, elapsedMs) / DEATH_FRAME_MS);
  return DEATH_FRAMES[Math.min(step, DEATH_FRAMES.length - 1)]!;
}

/** Whether the death animation has run to its end and is now holding (US4-S6). */
export function deathAnimationComplete(elapsedMs: number): boolean {
  return elapsedMs >= DEATH_DURATION_MS;
}

export function frameForGuard(state: GuardState, elapsedMs: number): GuardFrame {
  switch (state) {
    case 'death':
      return deathFrame(elapsedMs);
    case 'attack':
      return 'attack';
    case 'chase':
      return WALK_FRAMES[Math.floor(Math.max(0, elapsedMs) / WALK_FRAME_MS) % WALK_FRAMES.length]!;
    default:
      return 'stand';
  }
}

export function frameRowForGuard(state: GuardState, elapsedMs: number): number {
  return frameIndexOf(frameForGuard(state, elapsedMs));
}

export interface CellUv {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

export function cellUv(plan: SheetPlan, angle: number, frameIndex: number): CellUv {
  // Half a texel in: a sample on a cell boundary would show a one-pixel seam of the
  // neighbouring bearing down every guard's edge.
  const insetU = 0.5 / plan.width;
  const insetV = 0.5 / plan.height;
  const left = (angle * plan.cell) / plan.width;
  const right = ((angle + 1) * plan.cell) / plan.width;
  const top = 1 - (frameIndex * plan.cell) / plan.height;
  const bottom = 1 - ((frameIndex + 1) * plan.cell) / plan.height;
  return { u0: left + insetU, u1: right - insetU, v0: bottom + insetV, v1: top - insetV };
}

export interface GuardBillboard {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly plan: SheetPlan;
  angle: number;
  frameIndex: number;
}

const materials = new Map<string, MeshBasicMaterial>();

function materialFor(sheet: GuardSheet): MeshBasicMaterial {
  let material = materials.get(sheet.type);
  if (material == null) {
    // The sheet's empty space is fully transparent, so an alpha *test* cuts the figure
    // out and leaves depth writes intact — two guards then sort correctly whatever
    // order they are drawn in.
    material = new MeshBasicMaterial({ map: sheet.texture, transparent: true, alphaTest: 0.5 });
    materials.set(sheet.type, material);
  }
  return material;
}

/** Geometry is per guard — four vertices — because the UVs select the frame; the
 *  material and texture are shared. Culling is decided here (US4-S8), not left to
 *  the renderer's own pass. */
export function createGuardBillboard(sheet: GuardSheet): GuardBillboard {
  const geometry = new PlaneGeometry(BILLBOARD_WIDTH, BILLBOARD_HEIGHT);
  const mesh = new Mesh(geometry, materialFor(sheet));
  mesh.frustumCulled = false;
  geometry.computeBoundingSphere();
  return { mesh, plan: sheet.plan, angle: -1, frameIndex: -1 };
}

export function setBillboardCell(billboard: GuardBillboard, angle: number, frameIndex: number): void {
  if (billboard.angle === angle && billboard.frameIndex === frameIndex) return;
  const { u0, u1, v0, v1 } = cellUv(billboard.plan, angle, frameIndex);
  const uv = billboard.mesh.geometry.getAttribute('uv');
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
  billboard.angle = angle;
  billboard.frameIndex = frameIndex;
}

/** The quad's normal is +Z in its own space, so the yaw returned is exactly the
 *  heading from quad to camera — US4-S1's "the normal points at the camera". About Y
 *  only: chasing the camera's pitch would lean the figure off its feet. */
export function faceCamera(mesh: Mesh, cameraPosition: Vector3): number {
  const dx = cameraPosition.x - mesh.position.x;
  const dz = cameraPosition.z - mesh.position.z;
  const yaw = dx === 0 && dz === 0 ? mesh.rotation.y : Math.atan2(dx, dz);
  mesh.rotation.set(0, yaw, 0);
  return yaw;
}

export function billboardNormal(mesh: Mesh): { x: number; z: number } {
  const yaw = mesh.rotation.y;
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function placeBillboard(mesh: Mesh, x: number, z: number, floorY = 0): void {
  mesh.position.set(x, floorY + BILLBOARD_HEIGHT / 2, z);
}

/** Whether the camera can see the quad at all: a guard behind the camera fails
 *  here and is never drawn (US4-S8). */
export function isVisibleToCamera(mesh: Mesh, frustum: Frustum): boolean {
  mesh.updateMatrixWorld();
  return frustum.intersectsObject(mesh);
}

export interface BillboardUpdate {
  readonly viewAngle: number;
  readonly frameIndex: number;
  readonly visible: boolean;
}

export function updateGuardBillboard(
  billboard: GuardBillboard,
  guard: GuardView,
  viewer: Vector3,
  elapsedInStateMs: number,
  frustum: Frustum | null,
): BillboardUpdate {
  const viewAngle = viewAngleIndexFromPositions(guard, { x: viewer.x, z: viewer.z });
  const frameIndex = frameRowForGuard(guard.state, elapsedInStateMs);

  placeBillboard(billboard.mesh, guard.x, guard.z);
  faceCamera(billboard.mesh, viewer);
  setBillboardCell(billboard, viewAngle, frameIndex);

  const visible = frustum == null ? true : isVisibleToCamera(billboard.mesh, frustum);
  billboard.mesh.visible = visible;
  return { viewAngle, frameIndex, visible };
}
