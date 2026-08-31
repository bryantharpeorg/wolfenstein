// The synthesis maths (FR-009, US3-S1): oscillators, a seeded noise source, a one-pole
// low-pass and the declared envelope, summed into a `Float32Array` at a supplied sample
// rate. Constructs nothing — no context, no buffer, no node. Deterministic (noise draws
// 006's mulberry32 at the table's seed) and bounded (layer gains sum to one over sources
// in [-1, 1], so no sample exceeds `envelope.peak * spec.gain`).

import { createRng } from '../enemy/rng';
import type { Envelope, Layer, SoundSpec, WaveKind } from './sound-table';

export const DEFAULT_SAMPLE_RATE = 44100;

const TWO_PI = Math.PI * 2;

export function sampleCount(durationSeconds: number, sampleRate: number): number {
  return Math.max(1, Math.round(durationSeconds * sampleRate));
}

export function waveSample(wave: Exclude<WaveKind, 'noise'>, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(TWO_PI * p);
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'sawtooth':
      return 2 * p - 1;
    case 'triangle':
      return 4 * Math.abs(p - Math.floor(p + 0.5)) - 1;
  }
}

/** The envelope's gain at `timeSeconds` (FR-013, US3-S8): zero at both edges, linear
 *  ramps over the attack and release, the peak between. Adjacent samples differ by at
 *  most a sample's worth of a ramp, which is "no click" when a buffer is built. */
export function envelopeGain(
  envelope: Envelope,
  timeSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(timeSeconds) || timeSeconds <= 0 || timeSeconds >= durationSeconds) return 0;

  const { attackSeconds, releaseSeconds, peak } = envelope;
  if (timeSeconds < attackSeconds) return (peak * timeSeconds) / attackSeconds;

  const releaseStart = durationSeconds - releaseSeconds;
  if (timeSeconds > releaseStart) return (peak * (durationSeconds - timeSeconds)) / releaseSeconds;

  return peak;
}

function lowpassCoefficient(cutoffHz: number, sampleRate: number): number {
  if (!(cutoffHz > 0)) return 1;
  const rc = 1 / (TWO_PI * cutoffHz);
  const dt = 1 / sampleRate;
  return Math.min(1, dt / (rc + dt));
}

function renderLayer(out: Float32Array, layer: Layer, sampleRate: number): void {
  const length = out.length;
  const rng = createRng(layer.seed);
  const alpha = lowpassCoefficient(layer.lowpassHz, sampleRate);
  const noise = layer.wave === 'noise';
  const sweep = length > 1 ? (layer.endHz - layer.startHz) / (length - 1) : 0;
  let phase = 0;
  let filtered = 0;

  for (let i = 0; i < length; i += 1) {
    const raw = noise ? rng.nextSigned() : waveSample(layer.wave, phase);
    if (!noise) phase += (layer.startHz + sweep * i) / sampleRate;
    filtered += alpha * (raw - filtered);
    out[i] = out[i]! + layer.gain * filtered;
  }
}

/** The whole sound as samples (FR-009): length, shape and edges all from the table,
 *  and no `AudioContext` touched — which is why US3-S1 is a unit test. */
export function renderSound(spec: SoundSpec, sampleRate: number = DEFAULT_SAMPLE_RATE): Float32Array {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
    throw new Error(`sample rate must be positive: ${sampleRate}`);
  }

  const length = sampleCount(spec.durationSeconds, sampleRate);
  const data = new Float32Array(length);
  for (const layer of spec.layers) renderLayer(data, layer, sampleRate);

  for (let i = 0; i < length; i += 1) {
    data[i] = data[i]! * envelopeGain(spec.envelope, i / sampleRate, spec.durationSeconds) * spec.gain;
  }
  return data;
}
