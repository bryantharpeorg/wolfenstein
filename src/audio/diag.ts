// [US3] The `__diag.audio` shape (FR-018, US3-S5, US3-S9), attached to 001's
// `Diagnostics` by module augmentation from this file rather than by editing
// `src/diag/diag.ts` — the seam `combat-diag.ts` and `run/diag.ts` already use. It is
// deliberately reportable while silent: a graph that produces nothing throws nothing and
// logs nothing, so `contextState`, `sounds` and `fallbacks` together separate
// "suspended, as the policy requires" from "built nothing and said so".

import type { Diagnostics } from '../diag/diag';
import type { AudioContextState, AudioEngine } from './context';
import type { SoundId } from './sound-table';
import { MASTER_GAIN_CEILING, MAX_VOICES } from './voice-pool';

export interface AudioDiagnostics {
  contextState: AudioContextState; // or `unavailable` when there is none (US3-S5)
  sounds: SoundId[]; // synthesized at load time, in table order (US3-S2)
  voices: number; // playing right now, never above `voiceCap` (US3-S7)
  voicesStarted: number; // since load, monotonic: two readings say whether an event sounded
  voiceCap: number; // the declared limits, so a harness asserts against their source
  masterCeiling: number;
  gestured: boolean; // true once a gesture is seen, whatever the context did with it
  droneRunning: boolean; // so a resumed tab is not a second bed
  fallbacks: string[]; // one line per sound that could not be built (FR-013, US3-S9)
}

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

export function ensureAudioDiag(diag: Diagnostics): AudioDiagnostics {
  diag.audio ??= createAudioDiagnostics();
  return diag.audio;
}

/** What the engine reports, copied in: `__diag.audio` is a reading rather than a
 *  second handle on the engine. */
export function publishAudioDiagnostics(
  audio: AudioDiagnostics,
  engine: AudioEngine,
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
