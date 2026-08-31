// [US3] The `__diag.audio` shape (FR-018, US3-S5, US3-S9), attached to 001's
// `Diagnostics` by module augmentation from this file rather than by editing
// `src/diag/diag.ts` — the seam `combat-diag.ts`, `diag-player.ts` and `run/diag.ts`
// already use, so four stories of one spec do not queue up in one shared interface.
// Additive: nothing 001-007 declared is renamed, removed or repurposed.
//
// This object is the whole of what a harness can learn about audio, and it is
// deliberately reportable while silent: a WebAudio graph that produces nothing
// throws nothing and logs nothing, so `contextState`, `sounds` and `fallbacks`
// together are what distinguish "suspended, as the autoplay policy requires" from
// "built nothing and said so" from "quietly does not work".

import type { Diagnostics } from '../diag/diag';
import type { AudioContextState } from './context';
import type { SoundId } from './sound-table';
import { MASTER_GAIN_CEILING, MAX_VOICES } from './voice-pool';

export interface AudioDiagnostics {
  /** The context's own state, or `unavailable` when there is none (US3-S5). */
  contextState: AudioContextState;
  /** The sounds synthesized at load time, in table order (US3-S2). */
  sounds: SoundId[];
  /** Voices playing right now, never above `voiceCap` (US3-S7). */
  voices: number;
  /** Voices started since load, monotonic. A harness compares two readings of
   *  this across an event to learn whether that event made a sound (FR-011). */
  voicesStarted: number;
  /** The declared cap and ceiling, so a harness asserts against the source of
   *  the limit rather than against a number it was told twice. */
  voiceCap: number;
  masterCeiling: number;
  /** True once a user gesture has been seen, whatever the context did with it. */
  gestured: boolean;
  /** True while the ambient bed has a voice, so a resumed tab is not a second one. */
  droneRunning: boolean;
  /** One line per sound that could not be built (FR-013, US3-S9). Not `errors`:
   *  001 owns that, and it means something threw. */
  fallbacks: string[];
}

/** One list for a check to compare the published object against, as
 *  `COMBAT_DIAGNOSTIC_FIELDS` and `RUN_DIAGNOSTIC_FIELDS` are. */
export const AUDIO_DIAGNOSTIC_FIELDS = [
  'contextState', 'sounds', 'voices', 'voicesStarted', 'voiceCap', 'masterCeiling',
  'gestured', 'droneRunning', 'fallbacks',
] as const satisfies readonly (keyof AudioDiagnostics)[];

declare module '../diag/diag' {
  interface Diagnostics {
    audio?: AudioDiagnostics;
  }
}

export function createAudioDiagnostics(): AudioDiagnostics {
  return {
    contextState: 'unavailable',
    sounds: [],
    voices: 0,
    voicesStarted: 0,
    voiceCap: MAX_VOICES,
    masterCeiling: MASTER_GAIN_CEILING,
    gestured: false,
    droneRunning: false,
    fallbacks: [],
  };
}

/** Idempotent, so a second reader may ensure it without clearing the first's writes. */
export function ensureAudioDiag(diag: Diagnostics): AudioDiagnostics {
  diag.audio ??= createAudioDiagnostics();
  return diag.audio;
}

/** What the engine reports, copied into the published object. By copy, never by
 *  reference: `__diag.audio` is a reading, not a second handle on the engine. */
export function publishAudioDiagnostics(
  audio: AudioDiagnostics,
  engine: {
    state(): AudioContextState;
    inventory: readonly SoundId[];
    fallbacks: readonly string[];
    voices(): number;
    started(): number;
    droneRunning(): boolean;
  },
  gestured: boolean,
): void {
  audio.contextState = engine.state();
  audio.voices = engine.voices();
  audio.voicesStarted = engine.started();
  audio.gestured = gestured;
  audio.droneRunning = engine.droneRunning();
  if (audio.sounds.length !== engine.inventory.length) audio.sounds = [...engine.inventory];
  if (audio.fallbacks.length !== engine.fallbacks.length) audio.fallbacks = [...engine.fallbacks];
}
