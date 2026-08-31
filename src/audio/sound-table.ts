// The one sound table (FR-010, US3-S2). Constitution II leaves a sound with no file to
// be, so a sound *is* its parameters: written down here and nowhere else, as pure data
// with no DOM and no WebAudio, so the inventory is asserted under `npm run test`
// (US3-S1). Three weapons sharing one gunfire is a passing build and a failed story
// (US3-S3), so each weapon differs in duration, envelope, layers and seeds.

import type { WeaponKind } from '../combat/weapons';

export const WAVE_KINDS = ['sine', 'square', 'sawtooth', 'triangle', 'noise'] as const;

export type WaveKind = (typeof WAVE_KINDS)[number];

export const SOUND_IDS = [
  'gunfire-pistol', 'gunfire-smg', 'gunfire-chaingun', 'door', 'footstep', 'drone',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

/** The gain contour a voice plays through; an edge of zero is the click US3-S8
 *  forbids, which the table test rejects. */
export interface Envelope {
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
  readonly peak: number; // held between the ramps, in (0, 1]
}

/** One oscillator or noise source. The start-to-end sweep is what makes a shot a
 *  crack; the layer gains of one sound sum to exactly 1. */
export interface Layer {
  readonly wave: WaveKind;
  readonly startHz: number; // ignored by `noise`
  readonly endHz: number;
  readonly gain: number;
  readonly lowpassHz: number; // one-pole cutoff; zero leaves the layer unfiltered
  readonly seed: number; // the noise stream's seed, so its grain repeats
}

export interface SoundSpec {
  readonly id: SoundId;
  readonly durationSeconds: number;
  readonly envelope: Envelope;
  readonly layers: readonly Layer[];
  readonly loop: boolean; // the ambient bed alone; every other sound is a one-shot
  readonly gain: number; // the voice's own gain, before the master bus
}

const layer = (
  wave: WaveKind, startHz: number, endHz: number, gain: number, lowpassHz: number, seed: number,
): Layer => ({ wave, startHz, endHz, gain, lowpassHz, seed });

/** The inventory (FR-010): gunfire per weapon, each a pitched body swept down under a
 *  noise crack — pistol longest and lowest, SMG brighter, chaingun shortest and most
 *  bass-heavy so a held trigger rattles; a slow filtered door grind; a thump and scuff
 *  for a footstep; a looping drone whose long edges silence the loop seam. */
export const SOUND_TABLE: Readonly<Record<SoundId, SoundSpec>> = {
  'gunfire-pistol': {
    id: 'gunfire-pistol', durationSeconds: 0.18, loop: false, gain: 0.55,
    envelope: { attackSeconds: 0.002, releaseSeconds: 0.16, peak: 1 },
    layers: [layer('square', 320, 90, 0.45, 2600, 0x9101), layer('noise', 0, 0, 0.55, 4200, 0x9102)],
  },
  'gunfire-smg': {
    id: 'gunfire-smg', durationSeconds: 0.105, loop: false, gain: 0.45,
    envelope: { attackSeconds: 0.0015, releaseSeconds: 0.095, peak: 0.92 },
    layers: [layer('sawtooth', 520, 160, 0.4, 3400, 0x9201), layer('noise', 0, 0, 0.6, 6200, 0x9202)],
  },
  'gunfire-chaingun': {
    id: 'gunfire-chaingun', durationSeconds: 0.075, loop: false, gain: 0.4,
    envelope: { attackSeconds: 0.001, releaseSeconds: 0.062, peak: 0.84 },
    layers: [layer('square', 180, 62, 0.5, 1500, 0x9301), layer('noise', 0, 0, 0.5, 9000, 0x9302)],
  },
  door: {
    id: 'door', durationSeconds: 0.9, loop: false, gain: 0.5,
    envelope: { attackSeconds: 0.08, releaseSeconds: 0.35, peak: 0.85 },
    layers: [
      layer('sawtooth', 68, 44, 0.36, 700, 0x9401), layer('triangle', 132, 94, 0.24, 900, 0x9402),
      layer('noise', 0, 0, 0.4, 1100, 0x9403),
    ],
  },
  footstep: {
    id: 'footstep', durationSeconds: 0.14, loop: false, gain: 0.32,
    envelope: { attackSeconds: 0.004, releaseSeconds: 0.12, peak: 0.7 },
    layers: [layer('sine', 92, 55, 0.5, 400, 0x9501), layer('noise', 0, 0, 0.5, 1800, 0x9502)],
  },
  drone: {
    id: 'drone', durationSeconds: 4, loop: true, gain: 0.18,
    envelope: { attackSeconds: 1.2, releaseSeconds: 1.2, peak: 0.5 },
    layers: [
      layer('sine', 41, 41, 0.5, 0, 0x9601), layer('triangle', 61.5, 61.5, 0.22, 220, 0x9602),
      layer('noise', 0, 0, 0.28, 140, 0x9603),
    ],
  },
};

export const WEAPON_GUNFIRE: Readonly<Record<WeaponKind, SoundId>> = {
  pistol: 'gunfire-pistol', smg: 'gunfire-smg', chaingun: 'gunfire-chaingun',
};

export function gunfireSoundFor(kind: WeaponKind): SoundId {
  return WEAPON_GUNFIRE[kind];
}

/** The declared sound, or a throw: an unknown id is a programming error, not a sound
 *  that happens to be missing (that is a `fallbacks` entry). */
export function soundSpec(id: SoundId): SoundSpec {
  const spec = SOUND_TABLE[id];
  if (spec == null) throw new Error(`no such sound: ${String(id)}`);
  return spec;
}
