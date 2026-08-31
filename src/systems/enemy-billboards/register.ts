// The enemy-billboards system: the render edge of US4 (FR-009, FR-010, FR-011).
//
// Every decision it makes lives in `src/enemy/` and is asserted without a page —
// the column from `view-angle.ts`, the sheet from `sprite-shape.ts`, the quad,
// the frame and the cull from `billboard.ts`. This file is the wiring: one
// billboard per guard record, the chosen column written back onto that record's
// `viewAngle` each frame, and `__diag.enemies` / `__diag.enemiesAlive`
// published for the smoke gate to read.
//
// `src/main.ts` is not edited: 001's `boot/discover.ts` finds this file by glob.

import { Frustum, Matrix4, type PerspectiveCamera } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { FLOOR_Y } from '../../level';
import {
  createGuardBillboard,
  placeBillboard,
  updateGuardBillboard,
  type GuardBillboard,
} from '../../enemy/billboard';
import { buildGuardSheet, guardSheetStats } from '../../enemy/sprite-sheet';
import { DEATH_DURATION_MS, DEATH_FRAMES } from '../../enemy/sprite-shape';
import { countAlive, ensureEnemyDiag, type EnemyDiagnostic } from '../../enemy/enemy-diag';
import { bearingFromDelta } from '../../enemy/view-angle';
import { readAdopted, resolveGuardSource, spawnFallbackGuards } from './guard-source';

/** After the player systems, which write the camera each frame (003 order 30-34):
 *  a billboard has to face where the camera actually ended up. */
const SYSTEM_ORDER = 70;

/** The guard type this milestone ships. One sheet, one texture (US4-S7). */
const GUARD_TYPE = 'guard';

interface Entry {
  readonly record: EnemyDiagnostic;
  readonly billboard: GuardBillboard;
  /** Milliseconds the record has held its current state — the death animation's
   *  clock, kept here because a record carries a state but no time in it. */
  elapsedMs: number;
  lastState: string;
  /** Whether the quad was drawn on the last pass — US4-S8 read per guard. */
  visible: boolean;
}

/** The scripted viewpoint the smoke gate orbits with. Null in normal play. */
interface ViewpointOverride {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The harness's camera seam, the counterpart of 003's `window.__playerDrive`.
 *
 * SC-005 and US4-S4 want eight camera bearings around a stationary guard with no
 * human at the mouse, and nothing landed before this story can move the camera
 * programmatically. Rather than reach into 003's player state, this hook
 * overrides the viewpoint the billboards are drawn from — and the camera itself,
 * so the frustum cull under assertion is the real one (plan.md, Complexity
 * Tracking).
 */
export interface EnemyViewHook {
  /** Where the guards stand, so the harness can orbit one without guessing. */
  guards(): { x: number; z: number; state: string }[];
  /** Puts the camera at `(x, z)` looking at `(atX, atZ)` and re-runs the pass;
   *  returns the `viewAngle` of every guard as read straight afterwards. */
  orbit(x: number, z: number, atX: number, atZ: number): number[];
  /** Whether each guard's quad was drawn on the last pass, in `guards()` order:
   *  US4-S8 read one guard at a time rather than as a total. */
  visibility(): boolean[];
  /** The sheet frame each guard's quad currently shows, in `guards()` order —
   *  how US4-S5's death animation is watched from outside the page. */
  frames(): string[];
  /** The built sheet's shape, so the harness asserts US4-S2's dimensions
   *  against the canvas that actually exists rather than against the plan. */
  sheet(): {
    cell: number;
    width: number;
    height: number;
    canvasWidth: number;
    canvasHeight: number;
    frames: string[];
    deathFrames: string[];
    deathDurationMs: number;
  };
  /** Drops the override and hands the camera back to the player systems. */
  release(): void;
  /** Hides or shows every billboard, so the harness can measure what the guards
   *  cost in draw calls by difference (US4-S7). */
  setBillboardsVisible(visible: boolean): void;
}

declare global {
  interface Window {
    __enemyView?: EnemyViewHook;
  }
}

const entries = new Map<EnemyDiagnostic, Entry>();
const fallback: EnemyDiagnostic[] = [];
const frustum = new Frustum();
const projectionScreen = new Matrix4();

let override: ViewpointOverride | null = null;
let hidden = false;

/** Builds and drops billboards so the set of quads matches the set of records.
 *  Reconciled by record identity, so a system that replaces its array without
 *  replacing its records rebuilds nothing. */
function reconcile(ctx: GameContext, records: readonly EnemyDiagnostic[]): void {
  const sheet = buildGuardSheet(GUARD_TYPE);
  const live = new Set(records);

  for (const [record, entry] of entries) {
    if (live.has(record)) continue;
    ctx.scene.remove(entry.billboard.mesh);
    entry.billboard.mesh.geometry.dispose();
    entries.delete(record);
  }

  for (const record of records) {
    if (entries.has(record)) continue;
    const billboard = createGuardBillboard(sheet);
    ctx.scene.add(billboard.mesh);
    entries.set(record, {
      record,
      billboard,
      elapsedMs: 0,
      lastState: record.state,
      visible: false,
    });
  }
}

/** The camera the billboards face: the scripted viewpoint when the harness has
 *  one installed, and the player's camera otherwise. */
function applyOverride(camera: PerspectiveCamera): void {
  if (override == null) return;
  camera.position.x = override.x;
  camera.position.z = override.z;
  camera.rotation.order = 'YXZ';
  camera.rotation.set(0, override.yaw, 0);
}

function drawGuards(ctx: GameContext, deltaMs: number): void {
  const camera = ctx.camera;
  applyOverride(camera);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  projectionScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projectionScreen);

  const source = resolveGuardSource(ctx.diag, fallback);
  reconcile(ctx, source.records);

  let drawn = 0;
  for (const record of source.records) {
    const entry = entries.get(record);
    if (entry == null) continue;

    if (record.state !== entry.lastState) {
      entry.lastState = record.state;
      entry.elapsedMs = 0;
    } else {
      entry.elapsedMs += Math.max(0, deltaMs);
    }

    const view = readAdopted(record);
    const update = updateGuardBillboard(
      entry.billboard,
      view,
      camera.position,
      entry.elapsedMs,
      frustum,
    );

    // FR-011, US4-S4: the column the renderer chose is written back onto the
    // record, which is the object `__diag.enemies` exposes.
    record.viewAngle = update.viewAngle;

    if (hidden) entry.billboard.mesh.visible = false;
    entry.visible = update.visible && !hidden;
    if (entry.visible) drawn += 1;
  }

  ctx.diag.enemies = source.records as EnemyDiagnostic[];
  ctx.diag.enemiesAlive = countAlive(source.records);

  const sheets = guardSheetStats();
  ctx.diag.enemyBillboards = {
    sheets: sheets.canvases,
    textures: sheets.textures,
    drawn,
    total: entries.size,
  };
}

function installViewHook(ctx: GameContext): void {
  const hook: EnemyViewHook = {
    guards: () =>
      [...entries.values()].map((entry) => {
        const view = readAdopted(entry.record);
        return { x: view.x, z: view.z, state: view.state };
      }),
    orbit(x, z, atX, atZ) {
      override = { x, z, yaw: bearingFromDelta(atX - x, atZ - z) };
      // Re-run the pass so the reading is fresh the instant the call returns;
      // the frame loop keeps the override applied until it is released.
      drawGuards(ctx, 0);
      return [...entries.values()].map((entry) => entry.record.viewAngle);
    },
    visibility: () => [...entries.values()].map((entry) => entry.visible),
    frames: () =>
      [...entries.values()].map((entry) => entry.billboard.plan.frames[entry.billboard.frameIndex] ?? ''),
    sheet() {
      const built = buildGuardSheet(GUARD_TYPE);
      return {
        cell: built.plan.cell,
        width: built.plan.width,
        height: built.plan.height,
        canvasWidth: built.canvas.width,
        canvasHeight: built.canvas.height,
        frames: [...built.plan.frames],
        deathFrames: [...DEATH_FRAMES],
        deathDurationMs: DEATH_DURATION_MS,
      };
    },
    release() {
      override = null;
    },
    setBillboardsVisible(visible) {
      hidden = !visible;
      for (const entry of entries.values()) entry.billboard.mesh.visible = visible;
    },
  };
  window.__enemyView = hook;
}

defineSystem({
  name: 'enemy-billboards',
  order: SYSTEM_ORDER,
  setup(ctx) {
    ensureEnemyDiag(ctx.diag);

    // The sheet is built once, here, at load time — canvas 2D calls, no file
    // (Constitution II, US4-S2).
    buildGuardSheet(GUARD_TYPE);

    if (fallback.length === 0) fallback.push(...spawnFallbackGuards());
    const source = resolveGuardSource(ctx.diag, fallback);
    reconcile(ctx, source.records);
    // Stand them on the floor before the first frame, so a guard is never seen
    // at the world origin for one frame while the camera settles.
    for (const entry of entries.values()) {
      const view = readAdopted(entry.record);
      placeBillboard(entry.billboard.mesh, view.x, view.z, FLOOR_Y);
    }

    ctx.diag.enemies = source.records as EnemyDiagnostic[];
    ctx.diag.enemiesAlive = countAlive(source.records);

    installViewHook(ctx);
  },
  update(ctx, deltaMs) {
    drawGuards(ctx, deltaMs);
  },
});
