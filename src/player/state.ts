// The PlayerState record: the single source of truth for where the viewpoint is.
// Pure data: no three.js, no DOM. US1 creates it complete; US2 and US3 import it
// and assign their fields at runtime without editing this file.

import type { PlayerSpawn } from '../level';

export interface PlayerState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Horizontal speed in world units per second, measured by US3. */
  speed: number;
  sprinting: boolean;
  bobOffset: number;
  stuck: boolean;
  blockedN: boolean;
  blockedS: boolean;
  blockedE: boolean;
  blockedW: boolean;
  desiredVelX: number;
  desiredVelZ: number;
}

/**
 * Builds a fresh PlayerState from the level's spawn. Position and facing come
 * from the spawn; every field US2 and US3 populate is zero-initialised so they
 * can assign into it without editing this file.
 */
export function createPlayerState(spawn: PlayerSpawn): PlayerState {
  return {
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.yaw,
    pitch: 0,
    speed: 0,
    sprinting: false,
    bobOffset: 0,
    stuck: false,
    blockedN: false,
    blockedS: false,
    blockedE: false,
    blockedW: false,
    desiredVelX: 0,
    desiredVelZ: 0,
  };
}

// The single shared instance, created by the player-look system at setup and
// read/written by the other player systems. Module-level so no shared file is
// edited to pass it around.
let shared: PlayerState | null = null;

export function setPlayerState(state: PlayerState): void {
  shared = state;
}

export function getPlayerState(): PlayerState {
  if (shared == null) {
    throw new Error('PlayerState has not been initialised');
  }
  return shared;
}
