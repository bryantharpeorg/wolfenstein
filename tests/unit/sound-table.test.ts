import { describe, it, expect } from 'vitest';
import { WEAPON_KINDS } from '../../src/combat/weapons';
import {
  SOUND_IDS, SOUND_TABLE, WEAPON_GUNFIRE, gunfireSoundFor, soundSpec, type SoundId,
} from '../../src/audio/sound-table';

// T024 (FR-010, US3-S2, US3-S3). The inventory is one table, and the only place a
// sound's duration, envelope or parameters is written down. Three weapons sharing one
// gunfire is a passing build and a failed story, so their parameter sets are compared
// field by field, which one shared object would not survive.

const distinct = (values: unknown[]): number => new Set(values.map((v) => JSON.stringify(v))).size;

describe('the declared sound table', () => {
  it('names gunfire per weapon kind, a door, a footstep and an ambient drone', () => {
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length);
    expect(Object.keys(SOUND_TABLE).sort()).toEqual([...SOUND_IDS].sort());
    for (const kind of WEAPON_KINDS) {
      expect(SOUND_IDS).toContain(gunfireSoundFor(kind));
      expect(WEAPON_GUNFIRE[kind]).toBe(gunfireSoundFor(kind));
    }
    expect(SOUND_IDS.length).toBeGreaterThanOrEqual(6);
    for (const id of ['door', 'footstep', 'drone'] as const) expect(SOUND_IDS).toContain(id);
    expect(new Set(WEAPON_KINDS.map(gunfireSoundFor)).size).toBe(WEAPON_KINDS.length);
    expect(() => soundSpec('nope' as SoundId)).toThrow();
  });

  it('declares a duration, a two-edged envelope and layers summing to one for each', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      expect(spec).toBe(SOUND_TABLE[id]);
      expect(spec.id).toBe(id);
      expect(spec.durationSeconds).toBeGreaterThan(0);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.envelope.peak).toBeGreaterThan(0);
      // Both edges ramp — an edge of zero is the switch US3-S8 forbids — and both fit
      // inside the declared duration.
      expect(spec.envelope.attackSeconds).toBeGreaterThan(0);
      expect(spec.envelope.releaseSeconds).toBeGreaterThan(0);
      expect(spec.envelope.attackSeconds + spec.envelope.releaseSeconds)
        .toBeLessThanOrEqual(spec.durationSeconds);
      expect(spec.loop).toBe(id === 'drone');

      expect(spec.layers.length).toBeGreaterThan(0);
      let sum = 0;
      for (const layer of spec.layers) {
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.lowpassHz).toBeGreaterThanOrEqual(0);
        if (layer.wave !== 'noise') expect(Math.min(layer.startHz, layer.endHz)).toBeGreaterThan(0);
        sum += layer.gain;
      }
      // |sample| <= peak * gain is then a property of the table rather than of the
      // renderer, so the declared ceiling cannot be lost in synthesis.
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('gives each weapon gunfire a distinct parameter set (US3-S3)', () => {
    const specs = WEAPON_KINDS.map((kind) => soundSpec(gunfireSoundFor(kind)));
    expect(distinct(specs.map((spec) => spec.durationSeconds))).toBe(specs.length);
    expect(distinct(specs.map((spec) => spec.envelope))).toBe(specs.length);
    expect(distinct(specs.map((spec) => spec.layers))).toBe(specs.length);
    const seeds = specs.flatMap((spec) => spec.layers.map((layer) => layer.seed));
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});
