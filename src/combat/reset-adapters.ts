// The cross-spec resets, registered with `restart.ts`'s registry (FR-011). The one
// file in this spec that knows what a door, a secret, a key and a guard are, reaching
// each through an accessor its owning system exports — so the reset policy is here and
// none of it is written into 002, 004 or 006 (plan.md, Complexity Tracking). Not pure:
// everything it decides is one assignment, from another spec's constant.
//
// Each adapter republishes its own `__diag` fields as it resets them, through the
// setter its owning system publishes with. Without that, `__diag` describes the *old*
// run until that system's next `update()`, so the reset is observable only a frame late
// and a snapshot between reads a run that no longer exists (US2-S8).

import type { Diagnostics } from '../diag/diag';
import { PLAYER_SPAWN, TILE_SIZE } from '../level';
import { KEY_KINDS } from '../interaction/keys';
import { SECRET_TRAVEL_TILES } from '../interaction/params';
import { ensureInteractionDiag, setDoorCounts } from '../interaction/interaction-diag';
import { publishSecretCounts } from '../interaction/secret-field';
import { ensurePlayerDiag } from '../player/diag-player';
import { getPlayerState } from '../player/state';
import { getDoorField } from '../systems/doors/register';
import { getSecretField } from '../systems/secrets/register';
import { getKeyRunState } from '../systems/keys/register';
import { resetEnemyRun } from '../systems/enemies/register';
import { resetCombatRun } from '../systems/combat/register';
import { registerResettable } from './restart';

/** Publishes the live player state into `__diag.player` (FR-018). 003 writes these
 *  from its own `update()`, a frame too late for a reset — the restart lands between
 *  two of those writes. */
export function syncPlayerDiag(diag: Diagnostics): void {
  const state = getPlayerState();
  const player = ensurePlayerDiag(diag);
  player.x = state.x;
  player.z = state.z;
  player.yaw = state.yaw;
  player.pitch = state.pitch;
  player.speed = state.speed;
  player.sprinting = state.sprinting;
  player.bobOffset = state.bobOffset;
  player.stuck = state.stuck;
}

/** 002's spawn tile and facing, at the tile centre 003 put them (US2-S6). */
function resetPlayer(diag: Diagnostics): void {
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
  syncPlayerDiag(diag);
}

/** Every door `closed`, mid-travel or not (US2-S7): the doors system repositions
 *  leaves from `progress`, so shutting the state shuts the mesh. */
function resetDoors(diag: Diagnostics): void {
  const field = getDoorField();
  for (const door of field?.doors ?? []) {
    door.state = 'closed';
    door.progress = 0;
    door.dwellMs = 0;
  }
  // Every door closed means none open — a count the doors system would not
  // republish until its next step.
  if (field != null) setDoorCounts(ensureInteractionDiag(diag), field.doors.length, 0);
}

/** Every secret unfound and back in its tile (US2-S7). */
function resetSecrets(diag: Diagnostics): void {
  const field = getSecretField();
  for (const secret of field?.secrets ?? []) {
    secret.state = 'idle';
    secret.displacement = 0;
    secret.travelLimit = SECRET_TRAVEL_TILES;
    secret.found = false;
  }
  if (field != null) publishSecretCounts(ensureInteractionDiag(diag), field);
}

/** Inventory empty, every key back on the floor: the keys system hides a collected
 *  pickup rather than removing it (US2-S7). */
function resetKeys(): void {
  const keys = getKeyRunState();
  for (const kind of KEY_KINDS) keys.inventory[kind] = 0;
  for (const pickup of keys.pickups) pickup.consumed = false;
  for (const [pickup, mesh] of keys.meshes) mesh.visible = !pickup.consumed;
  keys.publish();
}

/** Registers the cross-spec resets from the vitals system's setup. By name, so
 *  idempotent. `diag` is what each adapter republishes into. */
export function installResetAdapters(diag: Diagnostics): void {
  registerResettable('player', () => resetPlayer(diag));
  registerResettable('doors', () => resetDoors(diag));
  registerResettable('secrets', () => resetSecrets(diag));
  registerResettable('keys', resetKeys);
  registerResettable('guards', resetEnemyRun);
  // Its own reset, which publishes what it set: a further assignment here would
  // land after that publish and leave `__diag` disagreeing with the control.
  registerResettable('fire-control', resetCombatRun);
}
