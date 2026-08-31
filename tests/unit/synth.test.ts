import { describe, it, expect, afterEach } from 'vitest';
import { SOUND_IDS, soundSpec } from '../../src/audio/sound-table';
import { DEFAULT_SAMPLE_RATE, envelopeGain, renderSound, sampleCount, waveSample } from '../../src/audio/synth';

// T025 (FR-009, FR-013, US3-S1, US3-S8). Every sound is oscillator and noise maths
// over a supplied sample rate, asserted as pure data: the node environment has no
// `AudioContext`, and the first case poisons the global, so a branch reaching for the
// platform fails loudly rather than falling back in silence.

const peakOf = (data: Float32Array, from: number, to: number): number => {
  let peak = 0;
  for (let i = from; i < to; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
};

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe('the synthesis module', () => {
  it('builds every declared sound with no AudioContext in the environment (US3-S1)', () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = class {
      constructor() {
        throw new Error('synth constructed an AudioContext');
      }
    };
    for (const id of SOUND_IDS) {
      expect(renderSound(soundSpec(id), DEFAULT_SAMPLE_RATE)).toBeInstanceOf(Float32Array);
    }
  });

  it('renders each sound to its declared duration at the supplied sample rate', () => {
    for (const rate of [8000, DEFAULT_SAMPLE_RATE, 48000]) {
      for (const id of SOUND_IDS) {
        const { durationSeconds } = soundSpec(id);
        expect(renderSound(soundSpec(id), rate).length).toBe(sampleCount(durationSeconds, rate));
        expect(sampleCount(durationSeconds, rate)).toBe(Math.round(durationSeconds * rate));
      }
    }
  });

  it('is audible in its body, bounded by the table, and the same buffer every time', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      const data = renderSound(spec, DEFAULT_SAMPLE_RATE);
      expect(peakOf(data, 0, data.length)).toBeLessThanOrEqual(spec.envelope.peak * spec.gain + 1e-6);
      // Silence is the failure this whole story is exposed to, so every sound must
      // reach a real amplitude in its body — and reach the same one every render.
      expect(peakOf(data, Math.floor(data.length * 0.4), Math.floor(data.length * 0.6)))
        .toBeGreaterThan(0.02);
      expect(Array.from(renderSound(spec, DEFAULT_SAMPLE_RATE))).toEqual(Array.from(data));
    }
  });

  it('renders three distinct buffers for the three weapons (US3-S3)', () => {
    const rendered = (['gunfire-pistol', 'gunfire-smg', 'gunfire-chaingun'] as const).map((id) =>
      Array.from(renderSound(soundSpec(id), DEFAULT_SAMPLE_RATE)).join(','),
    );
    expect(new Set(rendered).size).toBe(rendered.length);
    for (const wave of ['sine', 'square', 'sawtooth', 'triangle'] as const) {
      expect(Math.abs(waveSample(wave, 0.37))).toBeLessThanOrEqual(1);
      expect(waveSample(wave, 0.25)).toBeCloseTo(waveSample(wave, 1.25), 10);
    }
  });
});

describe('the declared envelope', () => {
  it('is zero outside, holds the peak between the ramps, and ramps rather than switching (US3-S8)', () => {
    const steps = 64;
    for (const id of SOUND_IDS) {
      const { envelope, durationSeconds } = soundSpec(id);
      const at = (t: number): number => envelopeGain(envelope, t, durationSeconds);
      for (const outside of [0, durationSeconds, -1, durationSeconds + 1, Number.NaN]) {
        expect(at(outside)).toBe(0);
      }
      expect(at(envelope.attackSeconds)).toBeCloseTo(envelope.peak, 10);
      expect(at(durationSeconds - envelope.releaseSeconds)).toBeCloseTo(envelope.peak, 10);
      expect(at((envelope.attackSeconds + durationSeconds - envelope.releaseSeconds) / 2))
        .toBeCloseTo(envelope.peak, 10);

      // No step of either ramp moves more than one steps-worth of the peak: an
      // instantaneous switch would put the whole peak in a single step.
      const walk = (from: number, span: number, sign: number): void => {
        let previous = sign > 0 ? 0 : envelope.peak;
        for (let i = 1; i <= steps; i += 1) {
          const gain = at(from + (span * i) / steps);
          expect(sign * (gain - previous)).toBeGreaterThanOrEqual(-1e-12);
          expect(Math.abs(gain - previous)).toBeLessThanOrEqual(envelope.peak / steps + 1e-9);
          previous = gain;
        }
        expect(previous).toBeCloseTo(sign > 0 ? envelope.peak : 0, 9);
      };
      walk(0, envelope.attackSeconds, 1);
      walk(durationSeconds - envelope.releaseSeconds, envelope.releaseSeconds, -1);
    }
  });

  it('leaves no click at either edge of a rendered buffer (US3-S8)', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      const data = renderSound(spec, DEFAULT_SAMPLE_RATE);
      const ceiling = spec.envelope.peak * spec.gain;
      const rate = DEFAULT_SAMPLE_RATE;
      // Zero at the start, within one sample of the release ramp at the end, and each
      // ramp's outer tenth near silence — true only of a ramp applied per sample.
      expect(Math.abs(data[0]!)).toBe(0);
      expect(Math.abs(data[data.length - 1]!))
        .toBeLessThanOrEqual(ceiling / (spec.envelope.releaseSeconds * rate) + 1e-6);
      const bound = ceiling * 0.12 + 1e-6;
      const head = Math.max(1, Math.floor((spec.envelope.attackSeconds * rate) / 10));
      const tail = Math.max(1, Math.floor((spec.envelope.releaseSeconds * rate) / 10));
      expect(peakOf(data, 0, head)).toBeLessThanOrEqual(bound);
      expect(peakOf(data, data.length - tail, data.length)).toBeLessThanOrEqual(bound);
    }
  });
});
