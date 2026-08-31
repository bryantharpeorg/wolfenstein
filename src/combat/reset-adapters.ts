// The cross-spec resets, registered with `restart.ts`'s registry (FR-011). The
// one file in this spec that knows what a door, a secret, a key and a guard are,
// reaching each through an accessor its owning system exports rather than that
// system's internals — so the reset policy is here and none of it is written
// into 002, 004 or 006 (plan.md, Complexity Tracking).
//
// Deliberately not pure. Everything it decides is one assignment; everything it
// decides *from* — the spawn tile, the closed door state, the starting magazine
// — is another spec's declared constant, never a literal restated here.

import { PLAYER_SPAWN, TILE_SIZE } from '../level';
import { KEY_KINDS } from '../interaction/keys';
import { SECRET_TRAVEL_TILES } from '../interaction/params';
import { getPlayerState } from '../player/state';
import { getDoorField } from '../systems/doors/register';
import { getSecretField } from '../systems/secrets/register';
import { getKeyRunState } from '../systems/keys/register';
import { resetEnemyRun } from '../systems/enemies/register';
import { getFireControl, resetCombatRun } from '../systems/combat/register';
import { DEFAULT_WEAPON, startingAmmo } from './weapons';
import { registerResettable } from './restart';

/** 002's spawn tile and facing (US2-S6), at the tile centre 003 put them. */
function resetPlayer(): void {
  Object.assign(getPlayerState(), {
    x: PLAYER_SPAWN.x + TILE_SIZE / 2,
    z: PLAYER_SPAWN.z + TILE_SIZE / 2,
    yaw: PLAYER_SPAWN.yaw,
    pitch: 0,
    speed: 0,
    sprinting: false,
    bobOffset: 0,
    // Sticky within a run, so a restart is the only thing that clears it.
    stuck: false,
    blockedN: false,
    blockedS: false,
    blockedE: false,
    blockedW: false,
    desiredVelX: 0,
    desiredVelZ: 0,
  });
}

/** Every door `closed`, mid-travel or not (US2-S7). The doors system repositions
 *  its leaves from `progress`, so shutting the state shuts the mesh. */
function resetDoors(): void {
  for (const door of getDoorField()?.doors ?? []) {
    door.state = 'closed';
    door.progress = 0;
    door.dwellMs = 0;
  }
}

/** Every secret unfound and back in its tile (US2-S7); `found` is what
 *  `secretsFound` counts. */
function resetSecrets(): void {
  for (const secret of getSecretField()?.secrets ?? []) {
    secret.state = 'idle';
    secret.displacement = 0;
    secret.travelLimit = SECRET_TRAVEL_TILES;
    secret.found = false;
  }
}

/** The inventory empty and every key back on the floor (US2-S7): the keys system
 *  hides a collected pickup rather than removing it. */
function resetKeys(): void {
  const keys = getKeyRunState();
  for (const kind of KEY_KINDS) keys.inventory[kind] = 0;
  for (const pickup of keys.pickups) pickup.consumed = false;
  for (const [pickup, mesh] of keys.meshes) mesh.visible = !pickup.consumed;
  keys.publish();
}

/** This spec's magazine and active weapon; the counters go with them, so a
 *  restarted run's spread repeats. */
function resetFireControl(): void {
  resetCombatRun();
  const control = getFireControl();
  if (control == null) return;
  control.weapon = DEFAULT_WEAPON;
  control.ammo = startingAmmo();
}

/** Registers the cross-spec resets from the vitals system's setup. By name, and
 *  therefore idempotent. */
export function installResetAdapters(): void {
  registerResettable('player', resetPlayer);
  registerResettable('doors', resetDoors);
  registerResettable('secrets', resetSecrets);
  registerResettable('keys', resetKeys);
  registerResettable('guards', resetEnemyRun);
  registerResettable('fire-control', resetFireControl);
}
