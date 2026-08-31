// The single declared sound inventory (FR-010, US3-S2). Every duration, envelope
// and oscillator parameter in the game is written down here and nowhere else, so
// "what does the chaingun sound like" is a table lookup rather than a read of the
// synthesis loop. Pure data: no DOM, no three.js, no WebAudio — the whole table is
// asserted under `npm run test` with no `AudioContext` in the environment (US3-S1).
//
// Constitution II is the reason this file exists in this shape: there is no sound
// file to name, so a sound *is* its parameters. Three weapons sharing one gunfire
// would be a passing build and a failed story (US3-S3), so each weapon's entry
// carries its own duration, its own envelope, its own layer stack and its own noise
// seeds — distinct in every field, not merely in one.

import type { WeaponKind } from '../combat/weapons';

/** The oscillator shapes and the noise source, declared once. */
export const WAVE_KINDS = ['sine', 'square', 'sawtooth', 'triangle', 'noise'] as const;

export type WaveKind = (typeof WAVE_KINDS)[number];

/** Every sound the game can make. Six is the floor FR-010 sets. */
export const SOUND_IDS = [
  'gunfire-pistol',
  'gunfire-smg',
  'gunfire-chaingun',
  'door',
  'footstep',
  'drone',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

/**
 * The gain contour a voice is played through (US3-S8): silence, a ramp up
 * over `attackSeconds`, the peak, then a ramp down over `releaseSeconds` ending at
 * silence. Never a switch — an attack or a release of zero is the click US3-S8
 * forbids, and the table test rejects one.
 */
export interface Envelope {
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
  /** The gain held between the two ramps, in `(0, 1]`. */
  readonly peak: number;
}

/** One oscillator or noise source inside a sound. */
export interface Layer {
  readonly wave: WaveKind;
  /** Pitch at the sound's start, in hertz. Ignored by `noise`. */
  readonly startHz: number;
  /** Pitch at its end: a sweep between the two is what makes a shot a *crack*. */
  readonly endHz: number;
  /** Share of the sound. The layer gains of one sound sum to exactly 1, so a
   *  rendered sample can never exceed `envelope.peak * gain`. */
  readonly gain: number;
  /** One-pole low-pass cutoff in hertz; zero means the layer is unfiltered. */
  readonly lowpassHz: number;
  /** The noise stream's seed, so one layer's grain repeats byte for byte. */
  readonly seed: number;
}

/** One sound, whole. Nothing about it is derived at play time. */
export interface SoundSpec {
  readonly id: SoundId;
  readonly durationSeconds: number;
  readonly envelope: Envelope;
  readonly layers: readonly Layer[];
  /** True for the ambient bed alone: every other sound is a one-shot. */
  readonly loop: boolean;
  /** The voice's own gain, before the master bus divides by the live count. */
  readonly gain: number;
}

/**
 * The inventory (FR-010). Read it as four families:
 *
 * - *Gunfire*, one per weapon kind, each a pitched body swept downward under a
 *   noise crack. The pistol is the longest and lowest-cracking, the SMG shorter
 *   and brighter, the chaingun the shortest and the most bass-heavy so a held
 *   trigger reads as a rattle rather than a tone.
 * - *Door*: a slow filtered saw grind with a rubbing noise bed, long enough to
 *   cover the start of 004's travel.
 * - *Footstep*: a short low thump with a scuff, quiet enough to sit under gunfire.
 * - *Drone*: a looping bed whose long attack and release make the loop seam
 *   silent, so a bed that runs for a whole level never clicks at the wrap.
 */
export const SOUND_TABLE: Readonly<Record<SoundId, SoundSpec>> = {
  'gunfire-pistol': {
    id: 'gunfire-pistol',
    durationSeconds: 0.18,
    envelope: { attackSeconds: 0.002, releaseSeconds: 0.16, peak: 1 },
    loop: false,
    gain: 0.55,
    layers: [
      { wave: 'square', startHz: 320, endHz: 90, gain: 0.45, lowpassHz: 2600, seed: 0x9101 },
      { wave: 'noise', startHz: 0, endHz: 0, gain: 0.55, lowpassHz: 4200, seed: 0x9102 },
    ],
  },
  'gunfire-smg': {
    id: 'gunfire-smg',
    durationSeconds: 0.105,
    envelope: { attackSeconds: 0.0015, releaseSeconds: 0.095, peak: 0.92 },
    loop: false,
    gain: 0.45,
    layers: [
      { wave: 'sawtooth', startHz: 520, endHz: 160, gain: 0.4, lowpassHz: 3400, seed: 0x9201 },
      { wave: 'noise', startHz: 0, endHz: 0, gain: 0.6, lowpassHz: 6200, seed: 0x9202 },
    ],
  },
  'gunfire-chaingun': {
    id: 'gunfire-chaingun',
    durationSeconds: 0.075,
    envelope: { attackSeconds: 0.001, releaseSeconds: 0.062, peak: 0.84 },
    loop: false,
    gain: 0.4,
    layers: [
      { wave: 'square', startHz: 180, endHz: 62, gain: 0.5, lowpassHz: 1500, seed: 0x9301 },
      { wave: 'noise', startHz: 0, endHz: 0, gain: 0.5, lowpassHz: 9000, seed: 0x9302 },
    ],
  },
  door: {
    id: 'door',
    durationSeconds: 0.9,
    envelope: { attackSeconds: 0.08, releaseSeconds: 0.35, peak: 0.85 },
    loop: false,
    gain: 0.5,
    layers: [
      { wave: 'sawtooth', startHz: 68, endHz: 44, gain: 0.36, lowpassHz: 700, seed: 0x9401 },
      { wave: 'triangle', startHz: 132, endHz: 94, gain: 0.24, lowpassHz: 900, seed: 0x9402 },
      { wave: 'noise', startHz: 0, endHz: 0, gain: 0.4, lowpassHz: 1100, seed: 0x9403 },
    ],
  },
  footstep: {
    id: 'footstep',
    durationSeconds: 0.14,
    envelope: { attackSeconds: 0.004, releaseSeconds: 0.12, peak: 0.7 },
    loop: false,
    gain: 0.32,
    layers: [
      { wave: 'sine', startHz: 92, endHz: 55, gain: 0.5, lowpassHz: 400, seed: 0x9501 },
      { wave: 'noise', startHz: 0, endHz: 0, gain: 0.5, lowpassHz: 1800, seed: 0x9502 },
    ],
  },
  drone: {
    id: 'drone',
    durationSeconds: 4,
    envelope: { attackSeconds: 1.2, releaseSeconds: 1.2, peak: 0.5 },
    loop: true,
    gain: 0.18,
    layers: [
      { wave: 'sine', startHz: 41, endHz: 41, gain: 0.5, lowpassHz: 0, seed: 0x9601 },
      { wave: 'triangle', startHz: 61.5, endHz: 61.5, gain: 0.22, lowpassHz: 220, seed: 0x9602 },
      { wave: 'noise', startHz: 0, endHz: 0, gain: 0.28, lowpassHz: 140, seed: 0x9603 },
    ],
  },
};

/** The gunfire each weapon kind fires (FR-010): one entry per kind, all distinct. */
export const WEAPON_GUNFIRE: Readonly<Record<WeaponKind, SoundId>> = {
  pistol: 'gunfire-pistol',
  smg: 'gunfire-smg',
  chaingun: 'gunfire-chaingun',
};

export function gunfireSoundFor(kind: WeaponKind): SoundId {
  return WEAPON_GUNFIRE[kind];
}

/** The declared sound, or a throw: an id outside the table is a programming
 *  error, not a sound that happens to be missing (that is a `fallbacks` entry). */
export function soundSpec(id: SoundId): SoundSpec {
  const spec = SOUND_TABLE[id];
  if (spec == null) throw new Error(`no such sound: ${String(id)}`);
  return spec;
}
