// The player-locomotion system (order 32): installs the keyboard adapter at
// setup, and each frame writes PlayerState.desiredVelX/desiredVelZ from
// `src/player/locomotion.ts` using the yaw the player-look system already
// applied, leaving the integration itself to player-body. It also publishes
// `speed` and `sprinting` to `window.__diag.player` additively over the fields
// 001 and 002 own (FR-011, FR-012, FR-014, US3-S1..S4).

import { defineSystem } from '../../boot/registry';
import { commandsResolve } from '../../combat/run-state';
import { getPlayerState } from '../../player/state';
import { ensurePlayerDiag, type PlayerDiagnostics } from '../../player/diag-player';
import { computeDesiredVelocity } from '../../player/locomotion';
import {
  createKeyboardAdapter,
  type KeyboardAdapter,
  type KeyboardEventSource,
} from '../../player/keyboard';
import { WALK_SPEED, SPRINT_SPEED } from '../../player/params';

let adapter: KeyboardAdapter | null = null;
let playerDiag: PlayerDiagnostics | null = null;

defineSystem({
  name: 'player-locomotion',
  order: 32,
  setup(ctx) {
    playerDiag = ensurePlayerDiag(ctx.diag);
    adapter = createKeyboardAdapter(window as unknown as KeyboardEventSource);
  },
  update() {
    if (adapter == null || playerDiag == null) return;

    const state = getPlayerState();

    // The one gate every player command consults (007 FR-010): movement stops
    // resolving on death, and a key held across it banks no frames.
    if (!commandsResolve()) {
      state.desiredVelX = 0;
      state.desiredVelZ = 0;
      state.sprinting = false;
      state.speed = 0;
      playerDiag.speed = 0;
      playerDiag.sprinting = false;
      return;
    }

    const vel = computeDesiredVelocity(adapter.keys, state.yaw);
    state.desiredVelX = vel.x;
    state.desiredVelZ = vel.z;
    state.sprinting = adapter.keys.sprint;
    // `speed` is the base speed the player is trying to move at: zero when idle
    // (or an opposite pair cancels), otherwise walk or sprint (FR-014, US3-S4).
    const moving = vel.x !== 0 || vel.z !== 0;
    state.speed = moving ? (adapter.keys.sprint ? SPRINT_SPEED : WALK_SPEED) : 0;

    playerDiag.speed = state.speed;
    playerDiag.sprinting = state.sprinting;
  },
});
