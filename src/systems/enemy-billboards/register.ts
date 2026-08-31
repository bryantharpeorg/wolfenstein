// The enemy-billboards system: the render edge of US4 (FR-009, FR-010, FR-011). Every
// decision it makes lives in `src/enemy/` and is asserted without a page; this file is
// the wiring — one billboard per record, the chosen column written back onto that
// record's `viewAngle` each frame, and `__diag.enemies` / `enemiesAlive` published for
// the smoke gate. `src/main.ts` is not edited: 001's `boot/discover.ts` globs this.

import { Frustum, Matrix4, type PerspectiveCamera } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { ENEMY_SPAWNS, FLOOR_Y, TILE_SIZE } from '../../level';
import { createGuard } from '../../enemy/guard';
import { createGuardBillboard, placeBillboard, updateGuardBillboard, type GuardBillboard } from '../../enemy/billboard';
import { buildGuardSheet, guardSheetStats } from '../../enemy/sprite-sheet';
import { DEATH_DURATION_MS, DEATH_FRAMES } from '../../enemy/sprite-shape';
import { countAlive, ensureEnemyDiag, type EnemyDiagnostic } from '../../enemy/enemy-diag';
import { bearingFromDelta } from '../../enemy/view-angle';
import type { Diagnostics } from '../../diag/diag';

const SYSTEM_ORDER = 70;

/** The guard type this milestone ships. One sheet, one texture (US4-S7). */
const GUARD_TYPE = 'guard';

// Where the billboards get their guards. US3 owns the live records
// (`src/enemy/world.ts`), which this story cannot import before its sibling lands and
// must not duplicate — so the seam is the *published records*: what `__diag.enemies`
// already carries with a position is adopted, and a stationary guard stands on each
// spawn marker only when nothing has published any.

/** FR-011's three fields plus where the guard stands — optional, because a published
 *  record is not known to carry them until read: US3's world reports a `cell`. */
interface GuardRecord extends EnemyDiagnostic {
  x?: number;
  z?: number;
  facing?: number;
  cell?: { x: number; z: number };
}

function positionOf(record: GuardRecord): { x: number; z: number } | null {
  if (typeof record.x === 'number' && typeof record.z === 'number') return { x: record.x, z: record.z };
  if (record.cell != null) return { x: record.cell.x + TILE_SIZE / 2, z: record.cell.z + TILE_SIZE / 2 };
  return null;
}

function readAdopted(record: EnemyDiagnostic) {
  const r = record as GuardRecord;
  const { x, z } = positionOf(r) ?? { x: 0, z: 0 };
  return { state: r.state, x, z, facing: typeof r.facing === 'number' ? r.facing : 0 };
}

/** At each marker's tile centre, facing the level's middle so eight markers do not
 *  all present one bearing. Records, not a simulation: they hold `idle`, because what
 *  moves them is US3's. */
function spawnFallbackGuards(): GuardRecord[] {
  return ENEMY_SPAWNS.map((marker, i) => {
    const x = marker.x + TILE_SIZE / 2;
    const z = marker.z + TILE_SIZE / 2;
    const g = createGuard({ id: `guard-${i}`, x, z, facing: bearingFromDelta(32 - x, 32 - z) });
    return { state: g.state, viewAngle: 0, pathable: g.pathable, x, z, facing: g.facing };
  });
}

function resolveGuards(diag: Diagnostics): EnemyDiagnostic[] {
  const published = diag.enemies;
  const adoptable =
    published != null &&
    published !== fallback &&
    published.length > 0 &&
    published.every((record) => positionOf(record) != null);
  return adoptable ? published : fallback;
}

/**
 * The harness's camera seam, 003's `window.__playerDrive` counterpart. SC-005 and
 * US4-S4 want eight camera bearings around a stationary guard with no human at the
 * mouse, and 003 landed no programmatic camera hook — so rather than reach into its
 * player state, `orbit()` overrides the viewpoint the billboards are drawn from, and
 * the camera itself, keeping the frustum cull under assertion the real one.
 * `guards()`, `visibility()` and `frames()` report in one order, so US4-S8 and US4-S5
 * are read a guard at a time; `sheet()` reports the canvas actually built, so US4-S2
 * is asserted against it, not the plan; `setBillboardsVisible()` prices the guards in
 * draw calls (US4-S7).
 */
declare global {
  interface Window {
    __enemyView?: ReturnType<typeof makeViewHook>;
  }
}

interface Entry {
  readonly record: EnemyDiagnostic;
  readonly billboard: GuardBillboard;
  elapsedMs: number;
  lastState: string;
  visible: boolean;
}

const entries = new Map<EnemyDiagnostic, Entry>();
const fallback: EnemyDiagnostic[] = [];
const frustum = new Frustum();
const projectionScreen = new Matrix4();

let override: { x: number; z: number; yaw: number } | null = null;
let hidden = false;

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

  const records = resolveGuards(ctx.diag);
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

    const update = updateGuardBillboard(entry.billboard, readAdopted(record), camera.position, entry.elapsedMs, frustum);

    // FR-011, US4-S4: the column the renderer chose is written back onto the
    // record, which is the object `__diag.enemies` exposes.
    record.viewAngle = update.viewAngle;

    if (hidden) entry.billboard.mesh.visible = false;
    entry.visible = update.visible && !hidden;
    if (entry.visible) drawn += 1;
  }

  ctx.diag.enemies = records;
  ctx.diag.enemiesAlive = countAlive(records);

  const sheets = guardSheetStats();
  ctx.diag.enemyBillboards = { sheets: sheets.canvases, textures: sheets.textures, drawn, total: entries.size };
}

function makeViewHook(ctx: GameContext) {
  const all = () => [...entries.values()];
  return {
    guards: () => all().map((e) => readAdopted(e.record)),
    orbit(x: number, z: number, atX: number, atZ: number) {
      override = { x, z, yaw: bearingFromDelta(atX - x, atZ - z) };
      // Re-run the pass so the reading is fresh the instant the call returns; the
      // frame loop keeps the override applied until it is released.
      drawGuards(ctx, 0);
      return all().map((e) => e.record.viewAngle);
    },
    visibility: () => all().map((e) => e.visible),
    frames: () => all().map((e) => e.billboard.plan.frames[e.billboard.frameIndex] ?? ''),
    sheet() {
      const { plan, canvas } = buildGuardSheet(GUARD_TYPE);
      return {
        cell: plan.cell, width: plan.width, height: plan.height,
        canvasWidth: canvas.width, canvasHeight: canvas.height,
        frames: [...plan.frames], deathFrames: [...DEATH_FRAMES], deathDurationMs: DEATH_DURATION_MS,
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

    if (fallback.length === 0) fallback.push(...spawnFallbackGuards());
    const records = resolveGuards(ctx.diag);
    reconcile(ctx, records);
    // Stand them on the floor before the first frame, so a guard is never seen at
    // the world origin while the camera settles.
    for (const entry of entries.values()) {
      const view = readAdopted(entry.record);
      placeBillboard(entry.billboard.mesh, view.x, view.z, FLOOR_Y);
    }

    ctx.diag.enemies = records;
    ctx.diag.enemiesAlive = countAlive(records);
    window.__enemyView = makeViewHook(ctx);
  },
  update: drawGuards,
});
