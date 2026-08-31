// One camera-facing quad per guard (FR-009, FR-010, US4-S1, US4-S3, US4-S5).
//
// The quad's normal is pointed at the camera every frame, so a guard is a solid
// figure from every bearing rather than an axis-aligned card that vanishes
// edge-on. Which cell of the sheet it shows is two indices — the column from
// `./view-angle.ts`, the row from the guard's state and how long it has been in
// it — written into the quad's four UVs, which is why every guard can share one
// material and one texture and still show a different frame (US4-S7).
//
// The frame arithmetic below is pure and exported: the death animation is a
// function of elapsed milliseconds, so US4-S5's "advances over its declared
// duration and holds the final frame" is a vitest assertion rather than a thing
// to watch for on a screen.

import { Frustum, Mesh, MeshBasicMaterial, PlaneGeometry, type Vector3 } from 'three';
import type { GuardState } from './states';
import {
  DEATH_DURATION_MS,
  DEATH_FRAMES,
  GUARD_FRAMES,
  WALK_FRAMES,
  frameIndexOf,
  type GuardFrame,
  type SheetPlan,
} from './sprite-shape';
import type { GuardSheet } from './sprite-sheet';
import { viewAngleIndexFromPositions } from './view-angle';

/** The quad, in world units. The level's ceiling is 2 and the player's eye is at
 *  1.5, so a guard stands a little under eye height. */
export const BILLBOARD_WIDTH = 1;
export const BILLBOARD_HEIGHT = 1.6;

/** Milliseconds one walk frame is held. */
export const WALK_FRAME_MS = 140;

/** How long one death frame is held, from the declared total duration. */
export const DEATH_FRAME_MS = DEATH_DURATION_MS / DEATH_FRAMES.length;

/** What the renderer needs to know about a guard. Deliberately narrower than the
 *  guard record: a position, a heading and a state. */
export interface GuardView {
  readonly state: GuardState;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
}

/**
 * The death frame at `elapsedMs` into the animation: it advances through the
 * declared death frames over `DEATH_DURATION_MS` and then holds the last one
 * forever, which is US4-S5 in one line.
 */
export function deathFrame(elapsedMs: number): GuardFrame {
  const step = Math.floor(Math.max(0, elapsedMs) / DEATH_FRAME_MS);
  const index = Math.min(step, DEATH_FRAMES.length - 1);
  return DEATH_FRAMES[index]!;
}

/** Whether the death animation has run to its end and is now holding. */
export function deathAnimationComplete(elapsedMs: number): boolean {
  return elapsedMs >= DEATH_DURATION_MS;
}

/** The frame a guard shows, from its state and its time in that state. */
export function frameForGuard(state: GuardState, elapsedMs: number): GuardFrame {
  switch (state) {
    case 'death':
      return deathFrame(elapsedMs);
    case 'attack':
      return 'attack';
    case 'chase': {
      const step = Math.floor(Math.max(0, elapsedMs) / WALK_FRAME_MS) % WALK_FRAMES.length;
      return WALK_FRAMES[step]!;
    }
    default:
      return 'stand';
  }
}

/** The row a guard's frame sits on. */
export function frameRowForGuard(state: GuardState, elapsedMs: number): number {
  return frameIndexOf(frameForGuard(state, elapsedMs));
}

export interface CellUv {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

/**
 * The UV rectangle of one cell, inset by half a texel. Without the inset a
 * sample exactly on a cell boundary can land in the neighbouring bearing, which
 * shows as a one-pixel seam of the wrong sprite down the edge of every guard.
 */
export function cellUv(plan: SheetPlan, angle: number, frameIndex: number): CellUv {
  const insetU = 0.5 / plan.width;
  const insetV = 0.5 / plan.height;
  const left = (angle * plan.cell) / plan.width;
  const right = ((angle + 1) * plan.cell) / plan.width;
  // The canvas grows downward and the texture upward, so a row's top edge is the
  // larger v.
  const top = 1 - (frameIndex * plan.cell) / plan.height;
  const bottom = 1 - ((frameIndex + 1) * plan.cell) / plan.height;
  return { u0: left + insetU, u1: right - insetU, v0: bottom + insetV, v1: top - insetV };
}

/** A guard's quad, and the frame it currently shows. */
export interface GuardBillboard {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly plan: SheetPlan;
  /** The column last written; -1 before the first update. */
  angle: number;
  /** The row last written; -1 before the first update. */
  frameIndex: number;
}

/** One material for the whole type: shared, so the guards differ by UVs alone. */
const materials = new Map<string, MeshBasicMaterial>();

function materialFor(sheet: GuardSheet): MeshBasicMaterial {
  let material = materials.get(sheet.type);
  if (material == null) {
    material = new MeshBasicMaterial({
      map: sheet.texture,
      transparent: true,
      // The sheet's empty space is fully transparent, so an alpha *test* cuts
      // the figure out and leaves depth writes intact — two guards then sort
      // against each other correctly whatever order they are drawn in.
      alphaTest: 0.5,
    });
    materials.set(sheet.type, material);
  }
  return material;
}

/** Test seam only; production builds one material per type and keeps it. */
export function resetBillboardMaterialsForTest(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
}

/** Builds a guard's quad. The geometry is per guard — four vertices — because
 *  the UVs are what select the frame; the material and texture are shared. */
export function createGuardBillboard(sheet: GuardSheet): GuardBillboard {
  const geometry = new PlaneGeometry(BILLBOARD_WIDTH, BILLBOARD_HEIGHT);
  const mesh = new Mesh(geometry, materialFor(sheet));
  // Culling is decided here, per US4-S8, rather than left to the renderer's own
  // pass, so "issues no draw call" is a fact this module reports.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = true;
  geometry.computeBoundingSphere();
  return { mesh, plan: sheet.plan, angle: -1, frameIndex: -1 };
}

/** Writes a cell's UVs onto the quad. A no-op when the cell has not changed, so
 *  a standing guard costs no buffer upload. */
export function setBillboardCell(billboard: GuardBillboard, angle: number, frameIndex: number): void {
  if (billboard.angle === angle && billboard.frameIndex === frameIndex) return;
  const { u0, u1, v0, v1 } = cellUv(billboard.plan, angle, frameIndex);
  const uv = billboard.mesh.geometry.getAttribute('uv');
  // PlaneGeometry's four vertices run top-left, top-right, bottom-left,
  // bottom-right.
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
  billboard.angle = angle;
  billboard.frameIndex = frameIndex;
}

/**
 * Turns the quad to face the camera and returns the yaw applied. The quad's
 * normal is +Z in its own space, so this yaw is exactly the heading from the
 * quad to the camera — US4-S1's "the quad's normal points at the camera".
 *
 * The rotation is about Y only: a guard stands on the floor, and tipping it to
 * chase the camera's pitch would lean the whole figure off its feet.
 */
export function faceCamera(mesh: Mesh, cameraPosition: Vector3): number {
  const dx = cameraPosition.x - mesh.position.x;
  const dz = cameraPosition.z - mesh.position.z;
  const yaw = dx === 0 && dz === 0 ? mesh.rotation.y : Math.atan2(dx, dz);
  mesh.rotation.set(0, yaw, 0);
  return yaw;
}

/** Where the quad's normal points, in world XZ. Exported for the assertion that
 *  it points at the camera rather than at a fixed axis. */
export function billboardNormal(mesh: Mesh): { x: number; z: number } {
  const yaw = mesh.rotation.y;
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Stands the quad on the floor at a cell position. */
export function placeBillboard(mesh: Mesh, x: number, z: number, floorY = 0): void {
  mesh.position.set(x, floorY + BILLBOARD_HEIGHT / 2, z);
}

/** Whether the camera can see the quad at all. A guard behind the camera fails
 *  here and is never drawn (US4-S8). */
export function isVisibleToCamera(mesh: Mesh, frustum: Frustum): boolean {
  mesh.updateMatrixWorld();
  return frustum.intersectsObject(mesh);
}

/** The whole per-frame update for one guard: which way it is seen from, which
 *  frame it shows, where it stands and whether it is drawn at all. */
export interface BillboardUpdate {
  /** The sheet column, `0..7` — the value published as `__diag.enemies[i].viewAngle`. */
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

/** The frames a sheet declares, re-exported so a caller need not reach past this
 *  module for the row count. */
export const BILLBOARD_FRAMES = GUARD_FRAMES;
