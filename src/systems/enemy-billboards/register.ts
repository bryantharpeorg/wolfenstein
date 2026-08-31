// The enemy-billboards system (order 65): the only file in this story that draws
// anything. One quad per live guard from the shared sheet, each pointed at the
// camera, the chosen column written back onto the guard's record so
// `__diag.enemies[i].viewAngle` reports it, and guards behind the camera hidden
// so they issue no draw call (FR-009, FR-010, FR-011, US4-S4, US4-S8).
//
// Discovered by `src/boot/discover.ts`'s glob, so `src/main.ts` is not edited
// (plan.md), and run after `enemies` (order 60) so a guard is drawn where this
// frame's tick left it. It holds no behaviour of its own.

import { Vector3 } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { TILE_SIZE } from '../../level';
import { createBillboard, updateBillboard, type Billboard, type CameraPose } from '../../enemy/billboard';
import { GUARD_TYPE, guardSheetCount, guardSpriteSheet, type GuardSheet } from '../../enemy/sprite-sheet';
import { VIEW_ANGLE_COUNT, normalizeAngle } from '../../enemy/view-angle';
import type { EnemyWorld } from '../../enemy/world';
import { getEnemyWorld } from '../enemies/register';

/** What the billboards report (FR-011, additively — an optional field, so
 *  `createDiagnostics` is not reopened). `textures` is US4-S7's claim. */
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

/** The harness seam US4-S4 needs: 003 landed no programmatic camera hook and
 *  this story does not open 003's module, so the orbit is driven from here, by
 *  moving the *camera* and never the player (DECISIONS.md). */
export interface EnemyOrbitOptions {
  /** Steps in the full turn; defaults to the sheet's eight columns. */
  readonly steps?: number;
  /** Orbit radius in cells. */
  readonly radius?: number;
  /** Face away from the guard instead of at it (US4-S8). */
  readonly lookAway?: boolean;
}

export interface EnemySpriteHarness {
  /** Stands the camera at orbit position `step` of a full turn around guard
   *  `index` and returns the column chosen there, already published. */
  orbit(index: number, step: number, options?: EnemyOrbitOptions): number | null;
  /** Drops the override; the player's own camera resumes next frame. */
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

/** Held until the harness releases it. Null in normal play, where nothing here
 *  touches the camera at all. */
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
const pose = { x: 0, z: 0, forwardX: 0, forwardZ: -1 };

/** Re-applies the harness's pose. Order 65 is after the player systems have
 *  written the camera, so the override is what the frame renders. */
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
  // Normalised on the level plane: pitch must not shrink the forward vector
  // until a guard straight ahead reads as behind.
  pose.forwardX = horizontal === 0 ? 0 : forward.x / horizontal;
  pose.forwardZ = horizontal === 0 ? -1 : forward.z / horizontal;
  return pose;
}

/** One quad per record, built once: the records array is fixed at spawn, so
 *  this is a length check after the first frame. */
function ensureBillboards(ctx: GameContext, world: EnemyWorld, built: GuardSheet): void {
  for (let index = billboards.length; index < world.records.length; index += 1) {
    const record = world.records[index]!;
    const billboard = createBillboard(record.guard, built);
    ctx.scene.add(billboard.mesh);
    billboards.push(billboard);
  }
}

function publish(ctx: GameContext, built: GuardSheet, visible: number): void {
  ctx.diag.enemySprites = {
    textures: guardSheetCount(),
    billboards: billboards.length,
    visible,
    sheetWidth: built.plan.width,
    sheetHeight: built.plan.height,
  };
}

/** The per-frame pass, also called synchronously by the orbit seam so a reading
 *  taken after a camera move is that camera's, not the last frame's. */
function drawGuards(ctx: GameContext, built: GuardSheet, deltaMs: number): void {
  const world = getEnemyWorld();
  if (world == null) return;
  ensureBillboards(ctx, world, built);

  const camera = readCameraPose(ctx);
  let visible = 0;
  world.records.forEach((record, index) => {
    const billboard = billboards[index];
    if (billboard == null) return;
    // Bearings are computed culled or not: `viewAngle` is the guard's relation
    // to the viewer and stays true when it is not drawn.
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
  // owes nothing to the guard's facing and the eight are evidence rather than
  // arithmetic run backwards. `(-sin b, -cos b)` is the direction of bearing
  // `b`, and a camera looking back down it is at yaw `b + PI`.
  const bearing = normalizeAngle((step * Math.PI * 2) / steps);
  const x = (record.guard.x - radius * Math.sin(bearing)) * TILE_SIZE;
  const z = (record.guard.z - radius * Math.cos(bearing)) * TILE_SIZE;

  override = {
    x,
    y: context.camera.position.y,
    z,
    yaw: normalizeAngle(bearing + (options.lookAway === true ? 0 : Math.PI)),
  };
  applyOverride(context);
  // Drawn synchronously, so the reading belongs to this pose.
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
