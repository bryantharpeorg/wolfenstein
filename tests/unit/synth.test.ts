import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SOUND_IDS, soundSpec } from '../../src/audio/sound-table';
import {
  DEFAULT_SAMPLE_RATE,
  envelopeGain,
  renderSound,
  sampleCount,
  waveSample,
} from '../../src/audio/synth';

// T025 (FR-009, FR-013, US3-S1, US3-S8). Every sound is oscillator and noise maths
// over a supplied sample rate, so the whole inventory is asserted as pure data with
// no `AudioContext` anywhere — the module is loaded here under vitest's node
// environment, where the constructor does not exist at all.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
const AUDIO_API =
  /\b(AudioContext|webkitAudioContext|OfflineAudioContext|AudioBuffer|AudioNode|window|document|navigator)\b/;

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

const peakOf = (data: Float32Array, from: number, to: number): number => {
  let peak = 0;
  for (let i = from; i < to; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
};

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe('the synthesis module', () => {
  it('imports nothing that names an AudioContext or the DOM', () => {
    for (const path of importGraph('audio/synth.ts')) {
      expect(stripComments(readFileSync(path, 'utf8'))).not.toMatch(AUDIO_API);
    }
  });

  it('builds every declared sound with no AudioContext in the environment', () => {
    // Not merely absent: constructing one is made an error, so a lazy branch
    // reaching for the platform is a failure rather than a silent fallback.
    class Forbidden {
      constructor() {
        throw new Error('synth constructed an AudioContext');
      }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = Forbidden;

    for (const id of SOUND_IDS) {
      const data = renderSound(soundSpec(id), DEFAULT_SAMPLE_RATE);
      expect(data).toBeInstanceOf(Float32Array);
      expect(data.length).toBeGreaterThan(0);
    }
  });

  it('renders each sound to its declared duration at the supplied sample rate', () => {
    for (const rate of [8000, 22050, DEFAULT_SAMPLE_RATE, 48000]) {
      for (const id of SOUND_IDS) {
        const spec = soundSpec(id);
        const data = renderSound(spec, rate);
        expect(data.length).toBe(sampleCount(spec.durationSeconds, rate));
        expect(data.length).toBe(Math.round(spec.durationSeconds * rate));
      }
    }
  });

  it('keeps every sample inside the bound the table declares', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      const data = renderSound(spec, DEFAULT_SAMPLE_RATE);
      const bound = spec.envelope.peak * spec.gain + 1e-6;
      expect(peakOf(data, 0, data.length)).toBeLessThanOrEqual(bound);
    }
  });

  it('is not silent: every sound reaches a real amplitude in its body', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      const data = renderSound(spec, DEFAULT_SAMPLE_RATE);
      const body = peakOf(data, Math.floor(data.length * 0.4), Math.floor(data.length * 0.6));
      expect(body).toBeGreaterThan(0.02);
    }
  });

  it('is deterministic: one spec at one rate renders one buffer', () => {
    for (const id of SOUND_IDS) {
      const first = renderSound(soundSpec(id), DEFAULT_SAMPLE_RATE);
      const second = renderSound(soundSpec(id), DEFAULT_SAMPLE_RATE);
      expect(Array.from(second)).toEqual(Array.from(first));
    }
  });

  it('renders three distinct buffers for the three weapons (US3-S3)', () => {
    const buffers = (['gunfire-pistol', 'gunfire-smg', 'gunfire-chaingun'] as const).map((id) =>
      Array.from(renderSound(soundSpec(id), DEFAULT_SAMPLE_RATE)).join(','),
    );
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});

describe('the declared envelope', () => {
  it('starts at zero, rises over the attack and returns to zero over the release', () => {
    for (const id of SOUND_IDS) {
      const { envelope, durationSeconds } = soundSpec(id);
      expect(envelopeGain(envelope, 0, durationSeconds)).toBe(0);
      expect(envelopeGain(envelope, durationSeconds, durationSeconds)).toBe(0);
      expect(envelopeGain(envelope, envelope.attackSeconds, durationSeconds))
        .toBeCloseTo(envelope.peak, 10);
      expect(envelopeGain(envelope, durationSeconds - envelope.releaseSeconds, durationSeconds))
        .toBeCloseTo(envelope.peak, 10);
    }
  });

  it('ramps rather than switching: the attack is monotone and never jumps', () => {
    for (const id of SOUND_IDS) {
      const { envelope, durationSeconds } = soundSpec(id);
      const steps = 64;
      let previous = -1;
      for (let i = 0; i <= steps; i += 1) {
        const gain = envelopeGain(envelope, (envelope.attackSeconds * i) / steps, durationSeconds);
        expect(gain).toBeGreaterThanOrEqual(previous);
        // No step of the ramp is more than one steps-worth of the peak: a
        // switch would put the whole peak in a single step.
        expect(gain - Math.max(previous, 0)).toBeLessThanOrEqual(envelope.peak / steps + 1e-9);
        previous = gain;
      }
    }
  });

  it('ramps rather than switching: the release is monotone and never jumps', () => {
    for (const id of SOUND_IDS) {
      const { envelope, durationSeconds } = soundSpec(id);
      const steps = 64;
      const from = durationSeconds - envelope.releaseSeconds;
      let previous = Infinity;
      for (let i = 0; i <= steps; i += 1) {
        const gain = envelopeGain(envelope, from + (envelope.releaseSeconds * i) / steps, durationSeconds);
        expect(gain).toBeLessThanOrEqual(previous + 1e-12);
        expect(Math.min(previous, envelope.peak) - gain).toBeLessThanOrEqual(envelope.peak / steps + 1e-9);
        previous = gain;
      }
      expect(previous).toBeCloseTo(0, 10);
    }
  });

  it('holds the peak between the two ramps', () => {
    for (const id of SOUND_IDS) {
      const { envelope, durationSeconds } = soundSpec(id);
      const middle = (envelope.attackSeconds + (durationSeconds - envelope.releaseSeconds)) / 2;
      expect(envelopeGain(envelope, middle, durationSeconds)).toBeCloseTo(envelope.peak, 10);
    }
  });

  it('answers zero outside the sound', () => {
    const { envelope, durationSeconds } = soundSpec('door');
    expect(envelopeGain(envelope, -1, durationSeconds)).toBe(0);
    expect(envelopeGain(envelope, durationSeconds + 1, durationSeconds)).toBe(0);
    expect(envelopeGain(envelope, Number.NaN, durationSeconds)).toBe(0);
  });

  it('leaves no click at either edge of a rendered buffer', () => {
    for (const id of SOUND_IDS) {
      const spec = soundSpec(id);
      const data = renderSound(spec, DEFAULT_SAMPLE_RATE);
      // Exactly zero at the start, and within a sample's worth of the release
      // ramp at the end: the last sample sits one sample short of the duration.
      expect(Math.abs(data[0]!)).toBe(0);
      const lastStep = (spec.envelope.peak * spec.gain) / (spec.envelope.releaseSeconds * DEFAULT_SAMPLE_RATE);
      expect(Math.abs(data[data.length - 1]!)).toBeLessThanOrEqual(lastStep + 1e-6);

      // The first tenth of the attack cannot exceed a tenth of the ceiling,
      // which is only true if the ramp is applied sample by sample.
      const window = Math.max(1, Math.floor((spec.envelope.attackSeconds * DEFAULT_SAMPLE_RATE) / 10));
      const bound = spec.envelope.peak * spec.gain * 0.12 + 1e-6;
      expect(peakOf(data, 0, window)).toBeLessThanOrEqual(bound);

      const tail = Math.max(1, Math.floor((spec.envelope.releaseSeconds * DEFAULT_SAMPLE_RATE) / 10));
      expect(peakOf(data, data.length - tail, data.length)).toBeLessThanOrEqual(bound);
    }
  });
});

describe('the oscillator bank', () => {
  it('spans [-1, 1] for every declared wave shape', () => {
    for (const wave of ['sine', 'square', 'sawtooth', 'triangle'] as const) {
      for (let i = 0; i < 128; i += 1) {
        const value = waveSample(wave, i / 128);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is periodic in phase', () => {
    for (const wave of ['sine', 'square', 'sawtooth', 'triangle'] as const) {
      expect(waveSample(wave, 0.25)).toBeCloseTo(waveSample(wave, 1.25), 10);
    }
  });
});
