// The harness's scripted-input seam: `window.__playerDrive(velX, velZ, ms)`.
//
// It writes the same `PlayerState.desiredVel*` fields US3's keyboard will write,
// then integrates that velocity over `ms` synchronously so the smoke gate can
// script a walk before WASD exists (FR-015, plan.md Complexity Tracking). It is
// an input seam for the gate, not a gameplay path, and keeps working unchanged
// once US3 lands.

import { getPlayerState } from './state';
import { integrate } from './integrate';
import { LEVEL_GRID } from '../level';
import type { OpenState } from './tiles';
import type { PlayerDiagnostics } from './diag-player';

declare global {
  interface Window {
    __playerDrive?: (velX: number, velZ: number, ms: number) => void;
  }
}

/**
 * Installs the drive seam. `diag` is the `__diag.player` object the body system
 * publishes; `openState` is the level's open/closed state (empty until M3).
 */
export function installPlayerDrive(diag: PlayerDiagnostics, openState: OpenState): void {
  window.__playerDrive = (velX, velZ, ms) => {
    const state = getPlayerState();
    state.desiredVelX = velX;
    state.desiredVelZ = velZ;

    const result = integrate(LEVEL_GRID, { x: state.x, z: state.z }, velX, velZ, ms, openState);
    state.x = result.position.x;
    state.z = result.position.z;
    state.blockedN = result.blockedAxes.n;
    state.blockedS = result.blockedAxes.s;
    state.blockedE = result.blockedAxes.e;
    state.blockedW = result.blockedAxes.w;
    state.stuck = state.stuck || result.stuck;
    diag.x = state.x;
    diag.z = state.z;
    diag.stuck = state.stuck;

    // Reset so the frame loop does not integrate the same velocity a second time.
    state.desiredVelX = 0;
    state.desiredVelZ = 0;
  };
}
