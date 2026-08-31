// The audio system (order 85): the DOM edge of US3, and only subscription, every
// decision living in `src/audio/` where it is asserted without a page. 001's glob
// discovery finds this file and `audio` arrives by module augmentation, so no shared
// wiring is edited; order 85 is after combat, vitals and the elevator, so the counters
// read here are the ones this frame settled on. A sound answers the *resolved* event
// (FR-011): gunfire is the delta of 007's `shotsFired`, which excludes refusals; a door
// is a leaf's state changing; a footstep is distance actually travelled. Startup never
// awaits audio (FR-012) — the engine is built synchronously and left suspended.

import { defineSystem, type GameContext } from '../../boot/registry';
import { createAudioEngine, type AudioEngine } from '../../audio/context';
import { ensureAudioDiag, publishAudioDiagnostics, type AudioDiagnostics } from '../../audio/diag';
import {
  createFootstepCadence,
  gunfireForResolvedShots,
  soundForDoorTransition,
  stepFootstepCadence,
  type FootstepCadence,
} from '../../audio/triggers';
import { MAX_VOICES } from '../../audio/voice-pool';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { registerResettable } from '../../combat/restart';
import type { Door, DoorState } from '../../interaction/door';
import { getDoorField } from '../doors/register';
import { SPRINT_SPEED } from '../../player/params';

const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'touchstart'] as const;

/** The furthest one frame credits to the legs, as a multiple of a frame of sprinting:
 *  beyond it was not walked — a restart returns the player to spawn in no time — and
 *  is dropped rather than banked, so a jump buys one frame of walking at most. */
const TELEPORT_SPEED_FACTOR = 2;

const MILLISECONDS_PER_SECOND = 1000;

let engine: AudioEngine | null = null;
let audio: AudioDiagnostics | null = null;
let combat: CombatDiagnostics | null = null;
let cadence: FootstepCadence = createFootstepCadence();

let gestured = false;

let lastShotsFired = 0;
let lastX: number | null = null;
let lastZ: number | null = null;
const doorStates = new Map<Door, DoorState>();

/** The clock voices age against: frame time, so a hidden tab retires nothing. */
let clockMs = 0;

function resetAudioRun(): void {
  lastShotsFired = 0;
  lastX = null;
  lastZ = null;
  cadence = createFootstepCadence();
  doorStates.clear();
}

function bindGestures(): void {
  const wake = (): void => {
    gestured = true;
    engine?.resume();
  };
  for (const type of GESTURE_EVENTS) window.addEventListener(type, wake, { passive: true });

  // A hidden tab goes quiet and a returning one comes back through the same context,
  // without a second drone, which `startDrone` refuses.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') engine?.suspend();
    else if (gestured) engine?.resume();
  });
}

function playGunfire(): void {
  if (engine == null || combat == null) return;
  const fired = combat.shotsFired - lastShotsFired;
  lastShotsFired = combat.shotsFired;
  // A restart puts the counter back to zero; that is not a negative burst.
  if (fired <= 0) return;
  for (const sound of gunfireForResolvedShots(combat.weapon, fired, MAX_VOICES)) {
    engine.play(sound, clockMs);
  }
}

function playDoors(): void {
  const field = getDoorField();
  if (engine == null || field == null) return;
  for (const door of field.doors) {
    const previous = doorStates.get(door);
    doorStates.set(door, door.state);
    if (previous == null) continue;
    const sound = soundForDoorTransition({ from: previous, to: door.state });
    if (sound != null) engine.play(sound, clockMs);
  }
}

function playFootsteps(ctx: GameContext, deltaMs: number): void {
  if (engine == null) return;
  const player = ctx.diag.player;
  const x = player?.x ?? ctx.camera.position.x;
  const z = player?.z ?? ctx.camera.position.z;
  const fromX = lastX;
  const fromZ = lastZ;
  lastX = x;
  lastZ = z;
  if (fromX == null || fromZ == null) return;

  const plausible = (SPRINT_SPEED * deltaMs * TELEPORT_SPEED_FACTOR) / MILLISECONDS_PER_SECOND;
  const travelled = Math.min(Math.hypot(x - fromX, z - fromZ), plausible);
  const steps = stepFootstepCadence(cadence, travelled);
  for (let step = 0; step < steps; step += 1) engine.play('footstep', clockMs);
}

defineSystem({
  name: 'audio',
  order: 85,

  setup(ctx) {
    audio = ensureAudioDiag(ctx.diag);
    combat = ensureCombatDiag(ctx.diag);
    // Never awaited: a context that cannot be built is a silent game (FR-012, US3-S9).
    engine = createAudioEngine();
    lastShotsFired = combat.shotsFired;
    bindGestures();
    registerResettable('audio-run', resetAudioRun);
    publishAudioDiagnostics(audio, engine, gestured);
  },

  update(ctx, deltaMs) {
    if (engine == null || audio == null) return;
    const elapsed = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    clockMs += elapsed;

    playGunfire();
    playDoors();
    playFootsteps(ctx, elapsed);

    // The bed, once a gesture has let it start; a no-op on every other frame.
    engine.startDrone(clockMs);
    engine.update(clockMs);
    publishAudioDiagnostics(audio, engine, gestured);
  },
});
