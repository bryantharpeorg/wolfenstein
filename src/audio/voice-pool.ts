// The voice cap and the master gain budget (FR-013, US3-S7). Pure bookkeeping over
// numbers, so a chaingun held down for a second is asserted under `npm run test`. The
// *cap* bounds how many sources exist at once; the *ceiling* bounds their summed
// amplitude, since ten voices peaking at 0.55 sum to 5.5 and a destination handed 5.5
// distorts rather than getting louder. Eviction is oldest-first: the tail still
// sounding is the one missed least.

import type { SoundId } from './sound-table';

/** The declared maximum of simultaneously live voices (FR-013). */
export const MAX_VOICES = 12;

/** The declared ceiling on the summed signal reaching the destination (FR-013). */
export const MASTER_GAIN_CEILING = 0.7;

export interface Voice {
  readonly id: number;
  readonly sound: SoundId;
  readonly startedAtMs: number; // the eviction order, oldest first
  readonly gain: number; // the voice's own gain, before the master bus
}

export interface VoicePool {
  readonly voices: Voice[]; // live, in the order they were granted
  readonly cap: number;
  nextId: number;
}

export interface VoiceGrant {
  readonly voice: Voice;
  readonly evicted: readonly Voice[]; // empty when the pool had room (US3-S7)
}

export function createVoicePool(cap: number = MAX_VOICES): VoicePool {
  return { voices: [], cap: Math.max(1, Math.floor(cap)), nextId: 1 };
}

export function liveVoices(pool: Readonly<VoicePool>): number {
  return pool.voices.length;
}

export function summedGain(pool: Readonly<VoicePool>): number {
  let sum = 0;
  for (const voice of pool.voices) sum += voice.gain;
  return sum;
}

/** The bus gain for the pool as it stands (FR-013): the ceiling while the live voices
 *  sum below it, the ratio that brings them back to it when they do not, and never
 *  above, so one quiet footstep is not amplified to fill the budget. */
export function masterGain(pool: Readonly<VoicePool>): number {
  const sum = summedGain(pool);
  if (!(sum > MASTER_GAIN_CEILING)) return MASTER_GAIN_CEILING;
  return MASTER_GAIN_CEILING / sum;
}

function oldestIndex(pool: Readonly<VoicePool>): number {
  let index = 0;
  for (let i = 1; i < pool.voices.length; i += 1) {
    if (pool.voices[i]!.startedAtMs < pool.voices[index]!.startedAtMs) index = i;
  }
  return index;
}

/** Starts a voice, stopping the oldest first if the cap would be exceeded (FR-013,
 *  US3-S7): the newest always plays, and the live count never exceeds the cap at any
 *  point, including inside this call. */
export function startVoice(pool: VoicePool, sound: SoundId, atMs: number, gain: number): VoiceGrant {
  const evicted: Voice[] = [];
  while (pool.voices.length >= pool.cap) {
    evicted.push(pool.voices.splice(oldestIndex(pool), 1)[0]!);
  }

  const voice: Voice = { id: pool.nextId, sound, startedAtMs: atMs, gain };
  pool.nextId += 1;
  pool.voices.push(voice);
  return { voice, evicted };
}

export function endVoice(pool: VoicePool, id: number): boolean {
  const index = pool.voices.findIndex((voice) => voice.id === id);
  if (index < 0) return false;
  pool.voices.splice(index, 1);
  return true;
}

export function clearVoices(pool: VoicePool): readonly Voice[] {
  const stopped = [...pool.voices];
  pool.voices.length = 0;
  return stopped;
}
