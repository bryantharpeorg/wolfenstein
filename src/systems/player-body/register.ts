// The player-body system (order 34): places the player at the level's spawn tile
// and facing yaw at setup, integrates `PlayerState.desiredVel*` through
// `src/player/integrate.ts` each frame, writes `camera.position.x` and
// `camera.position.z` only, and publishes `x`, `z` and `stuck` to
// `window.__diag.player` (FR-009, FR-010, US2-S7).
//
// The per-axis blocked flags are written to `PlayerState.blocked*` (FR-008); the
// `__diag.player` shape is fixed by FR-014 and carries no blocked flags.

import { defineSystem } from '../../boot/registry';
import { LEVEL_GRID, PLAYER_SPAWN, TILE_SIZE } from '../../level';
import { getPlayerState } from '../../player/state';
import { ensurePlayerDiag, type PlayerDiagnostics } from '../../player/diag-player';
import { integrate } from '../../player/integrate';
import { installPlayerDrive } from '../../player/drive-hook';
import { liveOpenTiles } from '../../interaction/open-state';
import type { OpenState } from '../../player/tiles';

// The live open state: a door or secret blocks until its own system publishes it
// as passable (004 FR-016, 003 FR-007) — 003 already took open state as an arg.
const OPEN_STATE: OpenState = liveOpenTiles;

let playerDiag: PlayerDiagnostics | null = null;

defineSystem({
  name: 'player-body',
  order: 34,
  setup(ctx) {
    playerDiag = ensurePlayerDiag(ctx.diag);

    const state = getPlayerState();
    // The spawn is a tile coordinate; the player stands at the tile's centre.
    state.x = PLAYER_SPAWN.x + TILE_SIZE / 2;
    state.z = PLAYER_SPAWN.z + TILE_SIZE / 2;
    state.yaw = PLAYER_SPAWN.yaw;

    ctx.camera.position.x = state.x;
    ctx.camera.position.z = state.z;

    installPlayerDrive(playerDiag, OPEN_STATE);
  },
  update(ctx, deltaMs) {
    if (playerDiag == null) return;

    const state = getPlayerState();
    const result = integrate(
      LEVEL_GRID,
      { x: state.x, z: state.z },
      state.desiredVelX,
      state.desiredVelZ,
      deltaMs,
      OPEN_STATE,
    );

    state.x = result.position.x;
    state.z = result.position.z;
    state.blockedN = result.blockedAxes.n;
    state.blockedS = result.blockedAxes.s;
    state.blockedE = result.blockedAxes.e;
    state.blockedW = result.blockedAxes.w;
    state.stuck = state.stuck || result.stuck;

    ctx.camera.position.x = state.x;
    ctx.camera.position.z = state.z;

    playerDiag.x = state.x;
    playerDiag.z = state.z;
    playerDiag.stuck = state.stuck;
  },
});
