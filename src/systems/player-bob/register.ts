// The player-bob system (order 36): measures horizontal speed from the position
// player-body actually resolved rather than from key state, drives
// `src/player/bob.ts`, writes `camera.position.y` as eye height plus the offset,
// and publishes `bobOffset` to `window.__diag.player` (FR-013, FR-014,
// US3-S5..S9).

import { defineSystem } from '../../boot/registry';
import { getPlayerState } from '../../player/state';
import { ensurePlayerDiag, type PlayerDiagnostics } from '../../player/diag-player';
import { advanceBob, createBobState, type BobState } from '../../player/bob';
import { EYE_HEIGHT } from '../../player/params';

let bobState: BobState | null = null;
let playerDiag: PlayerDiagnostics | null = null;
let prevX = 0;
let prevZ = 0;

defineSystem({
  name: 'player-bob',
  order: 36,
  setup(ctx) {
    playerDiag = ensurePlayerDiag(ctx.diag);
    bobState = createBobState();
    const state = getPlayerState();
    prevX = state.x;
    prevZ = state.z;
  },
  update(ctx, deltaMs) {
    if (bobState == null || playerDiag == null) return;

    const state = getPlayerState();

    // Measured horizontal speed from the resolved position delta, not key state.
    const dt = deltaMs / 1000;
    const dx = state.x - prevX;
    const dz = state.z - prevZ;
    const distance = Math.hypot(dx, dz);
    const speed = dt > 0 ? distance / dt : 0;

    prevX = state.x;
    prevZ = state.z;

    bobState = advanceBob(bobState, speed, deltaMs);
    state.bobOffset = bobState.offset;

    ctx.camera.position.y = EYE_HEIGHT + bobState.offset;
    playerDiag.bobOffset = bobState.offset;
  },
});
