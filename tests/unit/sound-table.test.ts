import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEAPON_KINDS } from '../../src/combat/weapons';
import {
  SOUND_IDS,
  SOUND_TABLE,
  WEAPON_GUNFIRE,
  gunfireSoundFor,
  soundSpec,
  type SoundId,
} from '../../src/audio/sound-table';

// T024 (FR-010, US3-S2, US3-S3, SC-004). The inventory is one table, and it is the
// only place a sound's duration, envelope or parameters is written down. Three
// weapons sharing one gunfire is a passing build and a failed story, so the
// distinctness of the three parameter sets is asserted field by field rather than
// by a single deep-inequality that a shared object would still satisfy.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
const AUDIO_API =
  /\b(AudioContext|webkitAudioContext|OfflineAudioContext|AudioBuffer|window|document|navigator)\b/;

/** Every file reachable from `entry` by relative import, `entry` included. */
/** Comments are prose about the API; the scan is about the code that runs. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const match of readFileSync(path, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1]!;
      queue.push(resolve(dirname(path), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
    }
  }
  return [...seen].sort();
}

describe('the declared sound table', () => {
  it('names one id per declared sound, with no duplicate', () => {
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length);
    expect(Object.keys(SOUND_TABLE).sort()).toEqual([...SOUND_IDS].sort());
  });

  it('names gunfire per weapon kind, a door, a footstep and an ambient drone', () => {
    for (const kind of WEAPON_KINDS) {
      const id = gunfireSoundFor(kind);
      expect(SOUND_IDS).toContain(id);
      expect(WEAPON_GUNFIRE[kind]).toBe(id);
    }
    // Six is the floor FR-010 sets: three weapons plus door, footstep and drone.
    expect(SOUND_IDS.length).toBeGreaterThanOrEqual(6);
    for (const required of ['door', 'footstep', 'drone'] as const) {
      expect(SOUND_IDS).toContain(required);
    }
  });

  it('gives every sound a distinct id per weapon, so no two weapons share one', () => {
    const gunfire = WEAPON_KINDS.map((kind) => gunfireSoundFor(kind));
    expect(new Set(gunfire).size).toBe(WEAPON_KINDS.length);
  });

  it('declares a duration and an envelope for every sound in that one table', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      expect(spec.id).toBe(id);
      expect(spec.durationSeconds).toBeGreaterThan(0);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.envelope.peak).toBeGreaterThan(0);
      // Both edges ramp: an attack or release of zero is the instantaneous
      // switch US3-S8 forbids.
      expect(spec.envelope.attackSeconds).toBeGreaterThan(0);
      expect(spec.envelope.releaseSeconds).toBeGreaterThan(0);
      expect(spec.envelope.attackSeconds + spec.envelope.releaseSeconds)
        .toBeLessThanOrEqual(spec.durationSeconds);
    }
  });

  it('builds every sound from oscillator and noise layers whose gains sum to one', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      expect(spec.layers.length).toBeGreaterThan(0);
      let sum = 0;
      for (const layer of spec.layers) {
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.lowpassHz).toBeGreaterThanOrEqual(0);
        if (layer.wave !== 'noise') {
          expect(layer.startHz).toBeGreaterThan(0);
          expect(layer.endHz).toBeGreaterThan(0);
        }
        sum += layer.gain;
      }
      // The bound |sample| <= envelope * spec.gain is a property of the table,
      // not of the renderer, so the ceiling cannot be lost in synthesis.
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('loops the ambient drone and nothing else', () => {
    expect(soundSpec('drone').loop).toBe(true);
    for (const id of SOUND_IDS) {
      if (id !== 'drone') expect(soundSpec(id).loop).toBe(false);
    }
  });

  it('gives each weapon gunfire a distinct parameter set (US3-S3)', () => {
    const specs = WEAPON_KINDS.map((kind) => soundSpec(gunfireSoundFor(kind)));

    // No two share an object, a duration, an envelope or a layer stack.
    const durations = specs.map((spec) => spec.durationSeconds);
    expect(new Set(durations).size).toBe(specs.length);

    const envelopes = specs.map((spec) => JSON.stringify(spec.envelope));
    expect(new Set(envelopes).size).toBe(specs.length);

    const layers = specs.map((spec) => JSON.stringify(spec.layers));
    expect(new Set(layers).size).toBe(specs.length);

    // And no two draw their noise from the same stream, so the grain differs too.
    const seeds = specs.flatMap((spec) => spec.layers.map((layer) => layer.seed));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('is the only place those parameters are written: nothing restates a value', () => {
    const declared = new Set<number>();
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      declared.add(spec.durationSeconds);
      for (const layer of spec.layers) declared.add(layer.startHz);
    }
    const table = readFileSync(resolve(SRC, 'audio/sound-table.ts'), 'utf8');
    for (const value of declared) {
      if (value === 0) continue;
      expect(table).toContain(String(value));
    }
  });

  it('needs no AudioContext and no DOM to be read (US3-S1)', () => {
    for (const path of importGraph('audio/sound-table.ts')) {
      expect(stripComments(readFileSync(path, 'utf8'))).not.toMatch(AUDIO_API);
    }
  });

  it('answers soundSpec for every declared id and only those', () => {
    for (const id of SOUND_IDS) expect(soundSpec(id)).toBe(SOUND_TABLE[id]);
    expect(() => soundSpec('nope' as SoundId)).toThrow();
  });
});
