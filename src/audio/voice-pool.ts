// The voice cap and the master gain budget (FR-013, US3-S7). Pure bookkeeping over
// numbers: no context, no nodes, no DOM, so a chaingun held down for a second is
// asserted under `npm run test` rather than watched for.
//
// Two declared limits, and they answer different failures. The *cap* bounds how
// many sources exist at once, because a browser that is asked for a hundred
// concurrent buffer sources stutters before it clips. The *ceiling* bounds their
// summed amplitude, because ten voices that each peak at 0.55 sum to 5.5 and a
// destination that is handed 5.5 does not get louder — it distorts. Eviction is
// oldest-first: the sound a player is still hearing the tail of is the one they
// will miss least, and the newest trigger is the one they just caused.

import type { SoundId } from './sound-table';

/** The declared maximum of simultaneously live voices (FR-013). */
export const MAX_VOICES = 12;

/** The declared ceiling on the summed signal reaching the destination (FR-013). */
export const MASTER_GAIN_CEILING = 0.7;

/** One live voice, as the pool accounts for it. The graph node lives elsewhere. */
export interface Voice {
  readonly id: number;
  readonly sound: SoundId;
  /** When it started, in the caller's clock. The eviction order, oldest first. */
  readonly startedAtMs: number;
  /** The voice's own gain, before the master bus. */
  readonly gain: number;
}

export interface VoicePool {
  /** The live voices, in the order they were granted. */
  readonly voices: Voice[];
  readonly cap: number;
  nextId: number;
}

/** What one trigger did: the voice it started, and the voices that made room. */
export interface VoiceGrant {
  readonly voice: Voice;
  /** Stopped so the cap holds; empty when the pool had room (US3-S7). */
  readonly evicted: readonly Voice[];
}

export function createVoicePool(cap: number = MAX_VOICES): VoicePool {
  return { voices: [], cap: Math.max(1, Math.floor(cap)), nextId: 1 };
}

export function liveVoices(pool: Readonly<VoicePool>): number {
  return pool.voices.length;
}

/** The summed gain of the live voices, before the master bus divides it. */
export function summedGain(pool: Readonly<VoicePool>): number {
  let sum = 0;
  for (const voice of pool.voices) sum += voice.gain;
  return sum;
}

/**
 * The master bus gain for the pool as it stands (FR-013): the declared ceiling
 * when the live voices already sum below it, and the ratio that brings them back
 * to it when they do not. Never above the ceiling, so a single quiet footstep is
 * not amplified to fill the budget.
 */
export function masterGain(pool: Readonly<VoicePool>): number {
  const sum = summedGain(pool);
  if (!(sum > MASTER_GAIN_CEILING)) return MASTER_GAIN_CEILING;
  return MASTER_GAIN_CEILING / sum;
}

/** The live voice that started earliest; ties break toward the one granted first. */
function oldestIndex(pool: Readonly<VoicePool>): number {
  let index = 0;
  for (let i = 1; i < pool.voices.length; i += 1) {
    if (pool.voices[i]!.startedAtMs < pool.voices[index]!.startedAtMs) index = i;
  }
  return index;
}

/**
 * Starts a voice, stopping the oldest ones first if the cap would be exceeded
 * (FR-013, US3-S7). More triggers on one frame than the cap is not an error and
 * not a dropped trigger: the newest always plays, and the count never exceeds the
 * cap at any point, including inside this call.
 */
export function startVoice(
  pool: VoicePool,
  sound: SoundId,
  atMs: number,
  gain: number,
): VoiceGrant {
  const evicted: Voice[] = [];
  while (pool.voices.length >= pool.cap) {
    evicted.push(pool.voices.splice(oldestIndex(pool), 1)[0]!);
  }

  const voice: Voice = { id: pool.nextId, sound, startedAtMs: atMs, gain };
  pool.nextId += 1;
  pool.voices.push(voice);
  return { voice, evicted };
}

/** Retires a voice that finished or was stopped. False when it was already gone,
 *  so an `onended` and a sweep may both report the same voice without a double
 *  release. */
export function endVoice(pool: VoicePool, id: number): boolean {
  const index = pool.voices.findIndex((voice) => voice.id === id);
  if (index < 0) return false;
  pool.voices.splice(index, 1);
  return true;
}

/** Every live voice, cleared. What a restart and a closed context both do. */
export function clearVoices(pool: VoicePool): readonly Voice[] {
  const stopped = [...pool.voices];
  pool.voices.length = 0;
  return stopped;
}
