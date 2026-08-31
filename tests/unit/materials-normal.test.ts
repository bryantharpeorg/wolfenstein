import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RGBA_CHANNELS } from '../../src/materials/constants';
import { MATERIAL_NAMES } from '../../src/materials/table';
import { generateAlbedo } from '../../src/materials/generate';
import {
  NORMAL_ENCODE_TOLERANCE,
  NORMAL_STRENGTH,
  NORMAL_UNIT_TOLERANCE,
  decodeNormalTexel,
  deriveNormalMap,
  flatNormalMap,
} from '../../src/materials/normal';

// FR-005 / US2-S1..S4. Every claim here is arithmetic over a buffer: a flat
// field encodes flat, a ramp of known slope encodes to the vector hand-computed
// from that slope, every texel decodes to unit length, and the field the
// derivation reads is the material's own height, never its albedo's luminance.

const SIZE = 64;

/** The declared convention, computed here by hand rather than by calling the
 * module under test: x increases with the column, the row increases downward,
 * green points up the image (three.js / OpenGL), and +Z leaves the surface. */
function handComputedNormal(dhdx: number, dhdrow: number): readonly [number, number, number] {
  const x = -dhdx * NORMAL_STRENGTH;
  const y = dhdrow * NORMAL_STRENGTH;
  const length = Math.hypot(x, y, 1);
  return [x / length, y / length, 1 / length];
}

function encodeChannel(component: number): number {
  return Math.round((component * 0.5 + 0.5) * 255);
}

function constantField(size: number, value: number): Float32Array {
  return new Float32Array(size * size).fill(value);
}

/** A ramp of known slope along +x, constant down each column. */
function rampField(size: number, slope: number): Float32Array {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) height[y * size + x] = slope * x;
  }
  return height;
}

/** The albedo's luminance as a height field — what FR-005 forbids deriving from. */
function luminanceField(albedo: Uint8ClampedArray, size: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i += 1) {
    const o = i * RGBA_CHANNELS;
    field[i] = (0.2126 * albedo[o]! + 0.7152 * albedo[o + 1]! + 0.0722 * albedo[o + 2]!) / 255;
  }
  return field;
}

describe('a constant height field is flat (US2-S1)', () => {
  const normal = deriveNormalMap(constantField(SIZE, 0.37), SIZE);

  it('fills a full RGBA buffer at the requested size', () => {
    expect(normal).toBeInstanceOf(Uint8ClampedArray);
    expect(normal.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
  });

  it('encodes every texel to (128, 128, 255) within one unit per channel', () => {
    for (let i = 0; i < normal.length; i += RGBA_CHANNELS) {
      expect(Math.abs(normal[i]! - 128)).toBeLessThanOrEqual(NORMAL_ENCODE_TOLERANCE);
      expect(Math.abs(normal[i + 1]! - 128)).toBeLessThanOrEqual(NORMAL_ENCODE_TOLERANCE);
      expect(Math.abs(normal[i + 2]! - 255)).toBeLessThanOrEqual(NORMAL_ENCODE_TOLERANCE);
      expect(normal[i + 3]!).toBe(255);
    }
  });

  it('is the same buffer content the declared flat fallback ships', () => {
    expect(Array.from(flatNormalMap(SIZE))).toEqual(Array.from(normal));
  });
});

describe('a ramp of known slope encodes to the hand-computed vector (US2-S2)', () => {
  const slope = 0.01;
  const normal = deriveNormalMap(rampField(SIZE, slope), SIZE);
  // Central difference over a linear ramp: (h[x+1] - h[x-1]) / 2 === slope.
  const expected = handComputedNormal(slope, 0);

  it('matches at every interior texel within the declared tolerance', () => {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 1; x < SIZE - 1; x += 1) {
        const o = (y * SIZE + x) * RGBA_CHANNELS;
        expect(Math.abs(normal[o]! - encodeChannel(expected[0]))).toBeLessThanOrEqual(
          NORMAL_ENCODE_TOLERANCE,
        );
        expect(Math.abs(normal[o + 1]! - encodeChannel(expected[1]))).toBeLessThanOrEqual(
          NORMAL_ENCODE_TOLERANCE,
        );
        expect(Math.abs(normal[o + 2]! - encodeChannel(expected[2]))).toBeLessThanOrEqual(
          NORMAL_ENCODE_TOLERANCE,
        );
      }
    }
  });

  it('tilts against the uphill direction rather than with it', () => {
    const o = (3 * SIZE + 10) * RGBA_CHANNELS;
    expect(normal[o]!).toBeLessThan(128);
    expect(decodeNormalTexel(normal, 3 * SIZE + 10)[0]).toBeLessThan(0);
  });

  it('keeps Z positive everywhere, including the wrapped edge columns', () => {
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(decodeNormalTexel(normal, i)[2]).toBeGreaterThan(0);
      expect(normal[i * RGBA_CHANNELS + 2]!).toBeGreaterThan(128);
    }
  });
});

describe('every generated normal decodes to unit length (US2-S3)', () => {
  it.each(MATERIAL_NAMES)('%s', (name) => {
    const { height } = generateAlbedo(name, SIZE);
    const normal = deriveNormalMap(height, SIZE);
    let worst = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const [x, y, z] = decodeNormalTexel(normal, i);
      expect(z).toBeGreaterThan(0);
      worst = Math.max(worst, Math.abs(Math.hypot(x, y, z) - 1));
    }
    expect(worst).toBeLessThanOrEqual(NORMAL_UNIT_TOLERANCE);
  });
});

describe('the derivation reads the height field, not albedo luminance (US2-S4)', () => {
  const { albedo, height } = generateAlbedo('brick', SIZE);

  it('produces a different map from the albedo luminance of the same material', () => {
    const fromHeight = deriveNormalMap(height, SIZE);
    const fromLuminance = deriveNormalMap(luminanceField(albedo, SIZE), SIZE);
    let differing = 0;
    for (let i = 0; i < fromHeight.length; i += RGBA_CHANNELS) {
      if (Math.abs(fromHeight[i]! - fromLuminance[i]!) > 1) differing += 1;
    }
    expect(differing).toBeGreaterThan(SIZE * SIZE * 0.1);
  });

  it('takes a height field as its only field argument, and names no albedo', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/materials/normal.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/albedo/i);
    expect(source).not.toMatch(/luminance/i);
  });
});

describe('edge sampling wraps rather than cliffing (Edge Cases)', () => {
  it('reads column 0 against the last column, so a tiling field has no seam', () => {
    // A field constant along a wrapped ramp: h = sin over a whole period tiles
    // exactly, so the seam column must encode like any other column.
    const size = 32;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] = 0.5 + 0.25 * Math.sin((2 * Math.PI * x) / size);
      }
    }
    const normal = deriveNormalMap(height, size);
    const dhdx = 0.25 * ((2 * Math.PI) / size) * Math.cos(0);
    const expected = handComputedNormal(dhdx, 0);
    expect(Math.abs(normal[0]! - encodeChannel(expected[0]))).toBeLessThanOrEqual(2);
    expect(Math.abs(normal[2]! - encodeChannel(expected[2]))).toBeLessThanOrEqual(2);
  });
});
