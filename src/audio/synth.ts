// The synthesis maths (FR-009, US3-S1): oscillators, a seeded noise source, a
// one-pole low-pass and the declared envelope, summed into a `Float32Array` for a
// sample rate the caller supplies. Constructs nothing — no context, no buffer, no
// node — so the whole inventory is rendered and asserted under `npm run test`.
//
// Two properties carry the story. *Determinism*: every noise layer draws from
// 006's mulberry32 at the seed the table declares, so one spec at one rate is one
// buffer on every run and a regression is a diff rather than an opinion. And
// *bounded output*: a sound's layer gains sum to one and every source is in
// [-1, 1], so a sample can never exceed `envelope.peak * spec.gain` — the ceiling
// the voice pool then divides among live voices, rather than a hope about mixing.

import { createRng } from '../enemy/rng';
import type { Envelope, Layer, SoundSpec, WaveKind } from './sound-table';

/** The rate the pure tests render at when a context has not supplied one. */
export const DEFAULT_SAMPLE_RATE = 44100;

const TWO_PI = Math.PI * 2;

/** How many samples a duration occupies. One rule, so a length is never guessed. */
export function sampleCount(durationSeconds: number, sampleRate: number): number {
  return Math.max(1, Math.round(durationSeconds * sampleRate));
}

/**
 * One cycle of a wave shape, `phase` in cycles (1 is a full turn). Noise is not
 * here: it is a stream, not a function of phase, so it is drawn in `renderSound`.
 */
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

/**
 * The declared envelope's gain at `timeSeconds` (FR-013, US3-S8): zero at both
 * edges, a linear ramp over the attack, the peak between, a linear ramp down over
 * the release. Nothing here ever switches — the value at any two adjacent samples
 * differs by at most one sample's worth of the ramp, which is what "no click"
 * means when a buffer is the thing being built.
 */
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

/** The one-pole coefficient for a cutoff, or 1 (pass-through) when unfiltered.
 *  `y[n] = y[n-1] + a * (x[n] - y[n-1])`, which never exceeds its input. */
function lowpassCoefficient(cutoffHz: number, sampleRate: number): number {
  if (!(cutoffHz > 0)) return 1;
  const rc = 1 / (TWO_PI * cutoffHz);
  const dt = 1 / sampleRate;
  return Math.min(1, dt / (rc + dt));
}

/** Writes one layer's contribution into `out`, scaled by the layer's gain. */
function renderLayer(out: Float32Array, layer: Layer, sampleRate: number): void {
  const length = out.length;
  const rng = createRng(layer.seed);
  const alpha = lowpassCoefficient(layer.lowpassHz, sampleRate);
  const noise = layer.wave === 'noise';
  // The sweep is linear in time between the declared endpoints, and the phase is
  // accumulated rather than recomputed, so a swept oscillator stays continuous.
  const sweep = length > 1 ? (layer.endHz - layer.startHz) / (length - 1) : 0;
  let phase = 0;
  let filtered = 0;

  for (let i = 0; i < length; i += 1) {
    const raw = noise ? rng.nextSigned() : waveSample(layer.wave, phase);
    if (!noise) {
      const hz = layer.startHz + sweep * i;
      phase += hz / sampleRate;
    }
    filtered += alpha * (raw - filtered);
    out[i] = out[i]! + layer.gain * filtered;
  }
}

/**
 * The whole sound as samples (FR-009). Every value comes from the table: the
 * length from its duration, the shape from its layers, the edges from its
 * envelope. No `AudioContext` is touched, which is exactly why US3-S1 is a unit
 * test rather than a smoke assertion.
 */
export function renderSound(spec: SoundSpec, sampleRate: number = DEFAULT_SAMPLE_RATE): Float32Array {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
    throw new Error(`sample rate must be positive: ${sampleRate}`);
  }

  const length = sampleCount(spec.durationSeconds, sampleRate);
  const data = new Float32Array(length);
  for (const layer of spec.layers) renderLayer(data, layer, sampleRate);

  for (let i = 0; i < length; i += 1) {
    const gain = envelopeGain(spec.envelope, i / sampleRate, spec.durationSeconds) * spec.gain;
    data[i] = data[i]! * gain;
  }
  return data;
}
