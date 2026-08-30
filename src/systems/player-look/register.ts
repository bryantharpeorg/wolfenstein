// The player-look system (order 30): installs the pointer-lock adapter on the
// canvas at setup, and each frame drains the accumulated mouse deltas through
// `src/player/look.ts` into PlayerState, writing `camera.rotation` with order
// YXZ so the camera's up vector stays world up at the pitch clamp. It publishes
// `yaw`, `pitch` and `pointerLocked` to `window.__diag.player` (FR-001, FR-002,
// FR-003).
//
// Deltas are ignored while `pointerLocked` is false, and the system keeps
// running after a denied or revoked lock, so a later click re-acquires it and
// the keyboard movement US3 adds is never disabled by a pointer-lock failure
// (FR-004, US1-S7, US1-S8).

import { defineSystem } from '../../boot/registry';
import { PLAYER_SPAWN } from '../../level';
import { getMovementParams } from '../../player/params';
import { createPlayerState, getPlayerState, setPlayerState } from '../../player/state';
import { ensurePlayerDiag, type PlayerDiagnostics } from '../../player/diag-player';
import { applyLook } from '../../player/look';
import {
  createPointerLockAdapter,
  type PointerLockAdapter,
  type PointerLockEventSource,
  type PointerLockTarget,
} from '../../player/pointer-lock';

let adapter: PointerLockAdapter | null = null;
let playerDiag: PlayerDiagnostics | null = null;

defineSystem({
  name: 'player-look',
  order: 30,
  setup(ctx) {
    playerDiag = ensurePlayerDiag(ctx.diag);
    setPlayerState(createPlayerState(PLAYER_SPAWN));
    ctx.camera.rotation.order = 'YXZ';

    const canvas = document.getElementById('game-canvas');
    if (canvas != null) {
      adapter = createPointerLockAdapter(
        canvas as unknown as PointerLockTarget,
        document as unknown as PointerLockEventSource,
      );
    }
  },
  update(ctx) {
    if (adapter == null || playerDiag == null) return;

    const state = getPlayerState();
    const deltas = adapter.drainDeltas();

    if (adapter.pointerLocked) {
      const params = getMovementParams();
      const next = applyLook(
        { yaw: state.yaw, pitch: state.pitch },
        { deltaX: deltas.deltaX, deltaY: deltas.deltaY },
        params.sensitivityYaw,
        params.sensitivityPitch,
      );
      state.yaw = next.yaw;
      state.pitch = next.pitch;
    }

    ctx.camera.rotation.y = state.yaw;
    ctx.camera.rotation.x = state.pitch;
    ctx.camera.rotation.z = 0;

    playerDiag.yaw = state.yaw;
    playerDiag.pitch = state.pitch;
    playerDiag.pointerLocked = adapter.pointerLocked;
  },
});
