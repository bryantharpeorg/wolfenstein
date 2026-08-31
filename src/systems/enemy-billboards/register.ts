// The enemy-billboards system: the render edge of US4 (FR-009, FR-010, FR-011). Every
// decision it makes lives in `src/enemy/` and is asserted without a page; this file is
// the wiring — one billboard per live guard record, the chosen column written back
// onto that record through the world's own `setViewAngle`, and what the render cost
// published for the smoke gate. `src/main.ts` is not edited: 001's `boot/discover.ts`
// globs this.
//
// The guards come from US3's world through `getEnemyWorld()`, the accessor that story
// installed for exactly this, so neither story opens the other's file. `__diag.enemies`
// stays US3's to publish; this one writes only the bearings into it.

import { Frustum, Matrix4, type PerspectiveCamera } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { FLOOR_Y } from '../../level';
import { getEnemyWorld } from '../enemies/register';
import type { GuardRecord } from '../../enemy/world';
import { GUARD_MAX_HEALTH } from '../../enemy/states';
import {
  createGuardBillboard,
  placeBillboard,
  updateGuardBillboard,
  type GuardBillboard,
} from '../../enemy/billboard';
import { buildGuardSheet, guardSheetStats } from '../../enemy/sprite-sheet';
import { DEATH_DURATION_MS, DEATH_FRAMES } from '../../enemy/sprite-shape';
import { ensureEnemyDiag } from '../../enemy/enemy-diag';
import { bearingFromDelta } from '../../enemy/view-angle';

/** After the enemies system (60), so a bearing is taken from this frame's positions. */
const SYSTEM_ORDER = 70;

/** The guard type this milestone ships. One sheet, one texture (US4-S7). */
const GUARD_TYPE = 'guard';

interface Entry {
  readonly record: GuardRecord;
  readonly billboard: GuardBillboard;
  elapsedMs: number;
  lastState: string;
  visible: boolean;
}

const entries = new Map<GuardRecord, Entry>();
const frustum = new Frustum();
const projectionScreen = new Matrix4();

let override: { x: number; z: number; yaw: number } | null = null;
let hidden = false;

/** The record as the billboard needs to see it: where the guard stands and which way
 *  it faces, both of which live on US1's immutable `Guard` inside the record. */
function viewOf(record: GuardRecord) {
  return {
    state: record.state,
    x: record.guard.x,
    z: record.guard.z,
    facing: record.guard.facing,
  };
}

function liveRecords(): readonly GuardRecord[] {
  return getEnemyWorld()?.records ?? [];
}

function reconcile(ctx: GameContext, records: readonly GuardRecord[]): void {
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
    entries.set(record, { record, billboard, elapsedMs: 0, lastState: record.state, visible: false });
  }
}

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

  const world = getEnemyWorld();
  const records = liveRecords();
  reconcile(ctx, records);

  let drawn = 0;
  for (const record of records) {
    const entry = entries.get(record);
    if (entry == null) continue;

    if (record.state !== entry.lastState) {
      entry.lastState = record.state;
      entry.elapsedMs = 0;
    } else {
      entry.elapsedMs += Math.max(0, deltaMs);
    }

    const update = updateGuardBillboard(
      entry.billboard,
      viewOf(record),
      camera.position,
      entry.elapsedMs,
      frustum,
    );

    // FR-011, US4-S4: the column the renderer chose goes back through the world,
    // which writes it onto both the record and the `__diag.enemies` entry US3
    // published — so the bearing is read where the spec says to read it.
    world?.setViewAngle(record.id, update.viewAngle);

    if (hidden) entry.billboard.mesh.visible = false;
    entry.visible = update.visible && !hidden;
    if (entry.visible) drawn += 1;
  }

  const sheets = guardSheetStats();
  ctx.diag.enemyBillboards = {
    sheets: sheets.canvases,
    textures: sheets.textures,
    drawn,
    total: entries.size,
  };
}

/**
 * The harness's camera seam, 003's `window.__playerDrive` counterpart. SC-005 and
 * US4-S4 want eight camera bearings around a stationary guard with no human at the
 * mouse, and 003 landed no programmatic camera hook — so rather than reach into its
 * player state, `orbit()` overrides the viewpoint the billboards are drawn from, and
 * the camera itself, keeping the frustum cull under assertion the real one.
 * `guards()`, `visibility()` and `frames()` report in one order, so US4-S8 and US4-S5
 * are read a guard at a time; `sheet()` reports the canvas actually built, so US4-S2
 * is asserted against it and not against the plan; `setBillboardsVisible()` prices the
 * guards in draw calls (US4-S7); `kill()` runs a guard into `death` the way a shot
 * would, through US3's damage seam, rather than by poking the published record.
 */
declare global {
  interface Window {
    __enemyView?: ReturnType<typeof makeViewHook>;
  }
}

function makeViewHook(ctx: GameContext) {
  const all = () => [...entries.values()];
  return {
    guards: () => all().map((e) => viewOf(e.record)),
    orbit(x: number, z: number, atX: number, atZ: number) {
      override = { x, z, yaw: bearingFromDelta(atX - x, atZ - z) };
      // Re-run the pass so the reading is fresh the instant the call returns; the
      // frame loop keeps the override applied until it is released.
      drawGuards(ctx, 0);
      return all().map((e) => e.record.viewAngle);
    },
    visibility: () => all().map((e) => e.visible),
    frames: () => all().map((e) => e.billboard.plan.frames[e.billboard.frameIndex] ?? ''),
    kill(index = 0) {
      const record = all()[index]?.record;
      if (record == null) return false;
      getEnemyWorld()?.damageGuardById(record.id, GUARD_MAX_HEALTH * 2);
      return true;
    },
    sheet() {
      const { plan, canvas } = buildGuardSheet(GUARD_TYPE);
      return {
        cell: plan.cell,
        width: plan.width,
        height: plan.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        frames: [...plan.frames],
        deathFrames: [...DEATH_FRAMES],
        deathDurationMs: DEATH_DURATION_MS,
      };
    },
    release: () => {
      override = null;
    },
    setBillboardsVisible(visible: boolean) {
      hidden = !visible;
      for (const entry of entries.values()) entry.billboard.mesh.visible = visible;
    },
  };
}

defineSystem({
  name: 'enemy-billboards',
  order: SYSTEM_ORDER,
  setup(ctx) {
    ensureEnemyDiag(ctx.diag);
    // Built once, here, at load time — canvas 2D calls, no file (Constitution II).
    buildGuardSheet(GUARD_TYPE);

    reconcile(ctx, liveRecords());
    // Stand them on the floor before the first frame, so a guard is never seen at
    // the world origin while the camera settles.
    for (const entry of entries.values()) {
      const view = viewOf(entry.record);
      placeBillboard(entry.billboard.mesh, view.x, view.z, FLOOR_Y);
    }

    window.__enemyView = makeViewHook(ctx);
  },
  update: drawGuards,
});
