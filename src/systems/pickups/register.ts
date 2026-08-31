/**
 * The pickups system (order 74): the render edge of US3, and the *only* place a
 * pickup is collected. Every decision lives in `src/combat/pickups.ts` and
 * `src/combat/pickup-effects.ts` and is tested without a page; this file builds a
 * mesh per marker, runs the proximity check against the player's position once a
 * frame, publishes the four counters into `__diag.combat`, and registers its own
 * reset with US2's registry — so restart puts every pickup back on the floor
 * without US2 editing anything this story owns (FR-011, FR-013, FR-014).
 *
 * Order 74 is after the player systems (30-36), so the check sees where the frame
 * left the player, and before vitals (75) for two reasons: the health and score a
 * pickup moved are published by that system in the same frame rather than a frame
 * late, and its setup captures the spawn snapshot SC-002 compares against — which
 * must already carry `pickupsTotal`.
 *
 * 004's keys are collected here too and nowhere else (US3-S9). The keys system
 * still owns the inventory, the lock gate and the key meshes; what it no longer
 * owns is a second collection path. A key is a `Pickup` with a key kind, and the
 * inventory add is its effect.
 */
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { FLOOR_Y, TILE_SIZE } from '../../level';
import { ensureCombatDiag, publishAmmo, type CombatDiagnostics } from '../../combat/combat-diag';
import { applyPickupEffect, type PickupKind, type PickupTargets } from '../../combat/pickup-effects';
import {
  buildPickupField,
  collectPickupsAt,
  pickupCenter,
  resetPickupField,
  type Pickup,
  type PickupField,
} from '../../combat/pickups';
import { registerResettable } from '../../combat/restart';
import { commandsResolve } from '../../combat/run-state';
import { keyPickupAt } from '../../interaction/pickups';
import { getFireControl } from '../combat/register';
import { getKeyRunState } from '../keys/register';
import { getVitalsRunState } from '../vitals/register';

/** Named marker faults (FR-013, US3-S2), empty on the shipped level. Deliberately
 *  not `errors`, which 001 owns and which means "something threw" — the same
 *  distinction 006 drew with `enemySpawnErrors`. Attached by module augmentation so
 *  `src/diag/diag.ts` is not edited, and not a field of `__diag.combat` because
 *  FR-018 declares that shape and a load fault is not combat state. */
declare module '../../diag/diag' {
  interface Diagnostics {
    pickupErrors?: readonly string[];
  }
}

// Generated geometry and flat colour, per Constitution II: a pickup is a small box
// the colour of its kind, never an imported sprite. Keys are absent — the keys
// system already builds an octahedron per key, and a second mesh on the same tile
// would be a second key to look at.
const PICKUP_COLORS: Partial<Record<PickupKind, number>> = {
  health: 0x3fb96a,
  ammo: 0xc9a227,
  treasure: 0xd8c020,
};

const PICKUP_BOX = 0.22;
const PICKUP_HEIGHT = 0.22;

let field: PickupField | null = null;
let combat: CombatDiagnostics | null = null;

// One `InstancedMesh` for every pickup in the level, coloured per instance: a mesh
// each would be a dozen draw calls, and US4 has to fit a HUD, a view-model and a
// muzzle flash inside the same budget of twenty that 002 set (FR-018, SC-006).
let instances: InstancedMesh | null = null;
/** Each drawn pickup's instance index and its placed transform, kept so hiding and
 *  restoring are one copy back rather than a rebuild. */
const placement = new Map<Pickup, { readonly index: number; readonly matrix: Matrix4 }>();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** The live run the effects write to. Null until every owning system has set up,
 *  which is why collection is skipped rather than faked on such a frame. */
function targets(): PickupTargets | null {
  const control = getFireControl();
  const run = getVitalsRunState();
  if (control == null || run == null) return null;
  return { vitals: run.vitals, ammo: control.ammo, score: run.score, keys: getKeyRunState().inventory };
}

function publish(): void {
  if (combat == null || field == null) return;
  combat.pickupsCollected = field.pickupsCollected;
  combat.pickupsTotal = field.pickupsTotal;
  combat.treasureFound = field.treasureFound;
  combat.treasureTotal = field.treasureTotal;
}

/** A consumed pickup is scaled away rather than removed, so a restart puts it back
 *  by copying its transform in again — the instance count never changes, so neither
 *  does the draw call (FR-011, US2-S7). */
function syncMeshes(): void {
  if (instances == null) return;
  for (const [pickup, placed] of placement) {
    instances.setMatrixAt(placed.index, pickup.consumed ? HIDDEN : placed.matrix);
  }
  instances.instanceMatrix.needsUpdate = true;
}

/** 004's own pickup record for a collected key, kept truthful: the inventory add
 *  was this path's effect, and this marks the key gone and hides its mesh so the
 *  keys system's reset — which US2 already registered — restores both (US3-S9). */
function retireKeyPickup(pickup: Pickup): void {
  const keys = getKeyRunState();
  const key = keyPickupAt(keys.pickups, pickup.tile.x, pickup.tile.z);
  if (key != null) key.consumed = true;
  for (const [collected, mesh] of keys.meshes) mesh.visible = !collected.consumed;
  keys.publish();
}

function collectAtPlayer(ctx: GameContext): void {
  if (field == null) return;
  const player = ctx.diag.player;
  const state = targets();
  if (player == null || state == null) return;

  // In tiles, which is what the pure module measures its radius in.
  const taken = collectPickupsAt(
    field,
    player.x / TILE_SIZE,
    player.z / TILE_SIZE,
    // The one application of the one effect: `collectPickupsAt` consumes nothing
    // this refuses, which is how a health pickup survives a full player (US3-S6).
    (pickup) => applyPickupEffect(pickup.kind, state).applied,
  );
  if (taken.length === 0) return;

  for (const pickup of taken) {
    if (pickup.kind === 'silver-key' || pickup.kind === 'gold-key') retireKeyPickup(pickup);
  }
  syncMeshes();

  // Ammo is published by the combat system at order 70, already past for this
  // frame; health and score are published by vitals at 75, still to come. Writing
  // the magazine here keeps `__diag` and the run in step on the collecting frame.
  const control = getFireControl();
  if (combat != null && control != null) publishAmmo(combat, control.ammo);
  publish();
}

function buildMeshes(ctx: GameContext): void {
  if (field == null) return;
  // Keys are excluded: the keys system already draws an octahedron on those tiles,
  // and a second mesh there would be a second key to look at.
  const drawn = field.pickups.filter((pickup) => PICKUP_COLORS[pickup.kind] != null);
  if (drawn.length === 0) return;

  const geometry = new BoxGeometry(PICKUP_BOX, PICKUP_BOX, PICKUP_BOX);
  const mesh = new InstancedMesh(geometry, new MeshStandardMaterial(), drawn.length);
  instances = mesh;
  const color = new Color();
  const matrix = new Matrix4();

  drawn.forEach((pickup, index) => {
    const centre = pickupCenter(pickup);
    matrix.makeTranslation(
      centre.x * TILE_SIZE,
      FLOOR_Y + PICKUP_HEIGHT,
      centre.z * TILE_SIZE,
    );
    placement.set(pickup, { index, matrix: matrix.clone() });
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.setHex(PICKUP_COLORS[pickup.kind]!));
  });

  ctx.scene.add(mesh);
}

/** What US2's restart runs (FR-011, US2-S7, US3-S10): every pickup uncollected,
 *  both counters at zero, every mesh back on the floor, and `__diag` republished
 *  before the snapshot is taken. The key pickups 004 owns are restored by that
 *  spec's adapter, which US2 registered and this story does not touch. */
function resetPickupsRun(): void {
  if (field == null) return;
  resetPickupField(field);
  syncMeshes();
  publish();
}

defineSystem({
  name: 'pickups',
  order: 74,

  setup(ctx) {
    combat = ensureCombatDiag(ctx.diag);
    field = buildPickupField();
    // Recorded, never thrown: an undeclared kind costs its own marker and nothing
    // else, and is named on the page as well as in the field (US3-S2).
    ctx.diag.pickupErrors = field.errors.map((error) => `${error.name}: ${error.message}`);

    registerResettable('pickups', resetPickupsRun);
    buildMeshes(ctx);
    publish();
  },

  update(ctx) {
    // Behind the gate FR-010 closes: a dead player collects nothing, and the
    // supplies they were standing on are still there after the restart.
    if (commandsResolve()) collectAtPlayer(ctx);
  },
});
