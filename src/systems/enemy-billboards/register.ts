// The enemy-billboards system (order 65): the only file in this story that draws
// anything. It builds one quad per live guard from the shared sheet, points each
// at the camera, writes the chosen column back onto the guard's record so
// `__diag.enemies[i].viewAngle` reports it, and hides the guards behind the
// camera so they issue no draw call (FR-009, FR-010, FR-011, US4-S4, US4-S8).
//
// It is discovered by `src/boot/discover.ts`'s glob, so `src/main.ts` is not
// edited (plan.md, Structure Decision). It runs after `enemies` (order 60) so a
// guard is drawn where this frame's tick left it, and it holds no behaviour of
// its own: the bearing is `view-angle.ts`, the frame is `sprite-shape.ts`, the
// quad is `billboard.ts`, and what is left here is plumbing plus the harness
// seam US4-S4 needs.

import { Vector3 } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { TILE_SIZE } from '../../level';
import { createBillboard, updateBillboard, type Billboard, type CameraPose } from '../../enemy/billboard';
import { GUARD_TYPE, guardSheetCount, guardSpriteSheet, type GuardSheet } from '../../enemy/sprite-sheet';
import { VIEW_ANGLE_COUNT, normalizeAngle } from '../../enemy/view-angle';
import type { EnemyWorld } from '../../enemy/world';
import { getEnemyWorld } from '../enemies/register';

/** What the billboards report about themselves (FR-011, additively: nothing in
 *  001's or US3's contract is redefined, and the field is optional so
 *  `createDiagnostics` is not reopened). `textures` is the claim US4-S7 makes:
 *  one upload per guard type, whatever the guard count is. */
export interface EnemySpriteDiagnostics {
  textures: number;
  billboards: number;
  /** Billboards that passed the cull this frame; the rest issued no draw call. */
  visible: number;
  sheetWidth: number;
  sheetHeight: number;
}

declare module '../../diag/diag' {
  interface Diagnostics {
    enemySprites?: EnemySpriteDiagnostics;
  }
}

/**
 * The harness seam US4-S4 needs. 003 landed no programmatic camera hook and this
 * story does not open 003's module, so the orbit is driven from here.
 *
 * It moves the *camera*, as an override this system re-applies after the player
 * systems have run, and deliberately not the player. A guard that saw the player
 * teleport around it would turn to face it on the next tick -- `step.ts` snaps
 * an alerted guard's facing straight at the player -- and the orbit would then
 * be circling a guard that pivots to keep its front to the viewer, which is the
 * one arrangement in which eight bearings cannot produce eight columns.
 * Overriding the camera alone leaves the guard stationary and unaware of the
 * orbit, which is the premise US4-S4 states.
 */
export interface EnemyOrbitOptions {
  /** Steps in the full turn; defaults to the eight columns of the sheet. */
  readonly steps?: number;
  /** Orbit radius in cells. */
  readonly radius?: number;
  /** Face directly away from the guard instead of at it (US4-S8). */
  readonly lookAway?: boolean;
}

export interface EnemySpriteHarness {
  /** Places the camera at orbit position `step` of a full turn around guard
   *  `index` -- an absolute bearing, owing nothing to the way the guard happens
   *  to be looking -- and returns the column chosen there, having already
   *  published it to `__diag`. */
  orbit(index: number, step: number, options?: EnemyOrbitOptions): number | null;
  /** Drops the override; the player's own camera resumes on the next frame. */
  release(): void;
  /** Hides every billboard, so the draw calls they cost can be measured. */
  setHidden(hidden: boolean): void;
  /** Per-guard cull results this frame, in `__diag.enemies` order. */
  visibleFlags(): boolean[];
}

declare global {
  interface Window {
    __enemySprites?: EnemySpriteHarness;
  }
}

/** A camera pose the harness holds until it releases it. Null in normal play,
 *  where nothing in this file touches the camera at all. */
interface CameraOverride {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

const DEFAULT_ORBIT_RADIUS_CELLS = 2.5;

let context: GameContext | null = null;
let sheet: GuardSheet | null = null;
let hidden = false;
let override: CameraOverride | null = null;
const billboards: Billboard[] = [];

// Scratch, reused every frame: a billboard pass allocates nothing.
const forward = new Vector3();
const pose: { x: number; z: number; forwardX: number; forwardZ: number } = {
  x: 0,
  z: 0,
  forwardX: 0,
  forwardZ: -1,
};

/** Re-applies the harness's camera pose, if it holds one. This system runs at
 *  order 65, after the player systems have written the camera, so the override
 *  is what the frame renders and 003's module is never opened. */
function applyOverride(ctx: GameContext): void {
  if (override == null) return;
  ctx.camera.position.set(override.x, override.y, override.z);
  ctx.camera.rotation.set(0, override.yaw, 0);
  ctx.camera.updateMatrixWorld();
}

function readCameraPose(ctx: GameContext): CameraPose {
  ctx.camera.getWorldDirection(forward);
  const horizontal = Math.hypot(forward.x, forward.z);
  pose.x = ctx.camera.position.x;
  pose.z = ctx.camera.position.z;
  // Normalised on the level plane: pitch must not shrink the forward vector to
  // the point where a guard straight ahead reads as behind.
  pose.forwardX = horizontal === 0 ? 0 : forward.x / horizontal;
  pose.forwardZ = horizontal === 0 ? -1 : forward.z / horizontal;
  return pose;
}

/** One quad per record, built once. The records array is fixed at spawn, so this
 *  runs to completion on the first frame and is a length check thereafter. */
function ensureBillboards(ctx: GameContext, world: EnemyWorld, built: GuardSheet): void {
  for (let index = billboards.length; index < world.records.length; index += 1) {
    const record = world.records[index]!;
    const billboard = createBillboard(record.guard, built);
    ctx.scene.add(billboard.mesh);
    billboards.push(billboard);
  }
}

function publish(ctx: GameContext, built: GuardSheet, visible: number): void {
  const diagnostics: EnemySpriteDiagnostics = ctx.diag.enemySprites ?? {
    textures: 0,
    billboards: 0,
    visible: 0,
    sheetWidth: built.plan.width,
    sheetHeight: built.plan.height,
  };
  diagnostics.textures = guardSheetCount();
  diagnostics.billboards = billboards.length;
  diagnostics.visible = visible;
  diagnostics.sheetWidth = built.plan.width;
  diagnostics.sheetHeight = built.plan.height;
  ctx.diag.enemySprites = diagnostics;
}

/** The per-frame pass, also called synchronously by the orbit seam so a reading
 *  taken straight after a camera move is that camera's, not the last frame's. */
function drawGuards(ctx: GameContext, built: GuardSheet, deltaMs: number): void {
  const world = getEnemyWorld();
  if (world == null) return;
  ensureBillboards(ctx, world, built);

  const camera = readCameraPose(ctx);
  let visible = 0;
  world.records.forEach((record, index) => {
    const billboard = billboards[index];
    if (billboard == null) return;
    // Every guard's bearing is computed, culled or not: `viewAngle` is the
    // guard's relation to the viewer, and it stays true of a guard the camera
    // has turned away from.
    const angle = updateBillboard(billboard, record.guard, camera, built.plan, deltaMs);
    world.setViewAngle(record.id, angle);
    if (billboard.visible) visible += 1;
    if (hidden) billboard.mesh.visible = false;
  });

  publish(ctx, built, visible);
}

function orbitCamera(index: number, step: number, options: EnemyOrbitOptions = {}): number | null {
  const world = getEnemyWorld();
  if (context == null || sheet == null || world == null) return null;
  const record = world.records[index];
  if (record == null) return null;

  const steps = options.steps ?? VIEW_ANGLE_COUNT;
  const radius = options.radius ?? DEFAULT_ORBIT_RADIUS_CELLS;
  // An *absolute* bearing: step `k` is a fixed compass direction, so the reading
  // it produces owes nothing to the guard's own facing, and the eight of them
  // are evidence rather than arithmetic run backwards.
  const bearing = normalizeAngle((step * Math.PI * 2) / steps);
  // `(-sin b, -cos b)` is the direction of bearing `b` (`view-angle.ts`), so
  // this stands the camera at that bearing from the guard; a camera looking back
  // down the same bearing is at yaw `b + PI`.
  const x = (record.guard.x - radius * Math.sin(bearing)) * TILE_SIZE;
  const z = (record.guard.z - radius * Math.cos(bearing)) * TILE_SIZE;

  override = {
    x,
    y: context.camera.position.y,
    z,
    yaw: normalizeAngle(bearing + (options.lookAway === true ? 0 : Math.PI)),
  };
  applyOverride(context);
  // Drawn synchronously, so the reading belongs to this camera pose rather than
  // to whatever the previous frame saw.
  drawGuards(context, sheet, 0);
  return billboards[index]?.viewAngle ?? null;
}

defineSystem({
  name: 'enemy-billboards',
  order: 65,

  setup(ctx) {
    context = ctx;
    // One sheet, drawn once, shared by every guard of this type (US4-S7).
    sheet = guardSpriteSheet(GUARD_TYPE);
    publish(ctx, sheet, 0);

    window.__enemySprites = {
      orbit: orbitCamera,
      release(): void {
        override = null;
      },
      setHidden(next: boolean): void {
        hidden = next;
        for (const billboard of billboards) billboard.mesh.visible = next ? false : billboard.visible;
      },
      visibleFlags: () => billboards.map((billboard) => billboard.visible),
    };
  },

  update(ctx, deltaMs) {
    if (sheet == null) return;
    context = ctx;
    applyOverride(ctx);
    drawGuards(ctx, sheet, deltaMs);
  },
});
