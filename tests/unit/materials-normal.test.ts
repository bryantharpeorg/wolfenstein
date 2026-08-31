import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FLAT_NORMAL_ENCODED,
  NORMAL_DECODE_TOLERANCE,
  NORMAL_STRENGTH,
  NORMAL_UNIT_TOLERANCE,
  decodeNormalTexel,
  deriveNormalMap,
  flatNormalMap,
} from '../../src/materials/normal';
import { RGBA_CHANNELS } from '../../src/materials/constants';
import { generateAlbedo } from '../../src/materials/generate';
import { MATERIAL_NAMES } from '../../src/materials/table';

// FR-005 / US2-S1..S4. Central-difference tangent-space normals from a height
// field: a flat field is flat, a known slope is the hand-computed vector, every
// decoded texel is unit length, and none of it reads albedo luminance.

const SIZE = 64;

function constantField(size: number, value: number): Float32Array {
  return new Float32Array(size * size).fill(value);
}

/** h(x, y) = slope * x, in height units per texel along u. */
function rampU(size: number, slope: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) field[y * size + x] = slope * x;
  }
  return field;
}

/** h(x, y) = slope * y, in height units per texel along v. */
function rampV(size: number, slope: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) field[y * size + x] = slope * y;
  }
  return field;
}

/** The vector the derivation is defined to produce: normalize(-du*s, -dv*s, 1). */
function handComputed(du: number, dv: number, strength: number): [number, number, number] {
  const x = -du * strength;
  const y = -dv * strength;
  const length = Math.hypot(x, y, 1);
  return [x / length, y / length, 1 / length];
}

/** The albedo-luminance field US2-S4 forbids the derivation from reading. */
function luminanceField(albedo: Uint8ClampedArray): Float32Array {
  const field = new Float32Array(albedo.length / RGBA_CHANNELS);
  for (let i = 0; i < field.length; i += 1) {
    const o = i * RGBA_CHANNELS;
    field[i] =
      (0.2126 * (albedo[o] ?? 0) + 0.7152 * (albedo[o + 1] ?? 0) + 0.0722 * (albedo[o + 2] ?? 0)) /
      255;
  }
  return field;
}

describe('US2-S1: a constant height field encodes as flat', () => {
  const map = deriveNormalMap(constantField(SIZE, 0.37), SIZE);

  it('fills an RGBA buffer of the requested size', () => {
    expect(map).toBeInstanceOf(Uint8ClampedArray);
    expect(map.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
  });

  it('encodes every texel as (128, 128, 255) within +/-1 per channel', () => {
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const o = i * RGBA_CHANNELS;
      expect(Math.abs((map[o] ?? -1) - FLAT_NORMAL_ENCODED[0])).toBeLessThanOrEqual(1);
      expect(Math.abs((map[o + 1] ?? -1) - FLAT_NORMAL_ENCODED[1])).toBeLessThanOrEqual(1);
      expect(Math.abs((map[o + 2] ?? -1) - FLAT_NORMAL_ENCODED[2])).toBeLessThanOrEqual(1);
    }
    expect(FLAT_NORMAL_ENCODED.slice(0, 3)).toEqual([128, 128, 255]);
  });

  it('is flat at the wrapped edge too, so no tile boundary reads as a cliff', () => {
    const corners: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [SIZE - 1, 0],
      [0, SIZE - 1],
      [SIZE - 1, SIZE - 1],
    ];
    for (const [x, y] of corners) {
      const o = (y * SIZE + x) * RGBA_CHANNELS;
      expect(map[o]).toBe(128);
      expect(map[o + 1]).toBe(128);
      expect(map[o + 2]).toBe(255);
    }
  });

  it('is exactly what flatNormalMap() produces', () => {
    expect(Array.from(flatNormalMap(SIZE))).toEqual(Array.from(map));
  });
});

describe('US2-S2: a linear ramp encodes the hand-computed normal', () => {
  const SLOPE = 0.01;

  it('matches the hand-computed vector at an interior texel along u', () => {
    const map = deriveNormalMap(rampU(SIZE, SLOPE), SIZE);
    const expected = handComputed(SLOPE, 0, NORMAL_STRENGTH);
    const actual = decodeNormalTexel(map, (SIZE / 2) * SIZE + SIZE / 2);
    for (let c = 0; c < 3; c += 1) {
      expect(Math.abs((actual[c] ?? 0) - (expected[c] ?? 0))).toBeLessThanOrEqual(NORMAL_DECODE_TOLERANCE);
    }
    // A ramp rising along +u tilts the normal toward -u.
    expect(actual[0]).toBeLessThan(0);
  });

  it('matches the hand-computed vector at an interior texel along v', () => {
    const map = deriveNormalMap(rampV(SIZE, SLOPE), SIZE);
    const expected = handComputed(0, SLOPE, NORMAL_STRENGTH);
    const actual = decodeNormalTexel(map, (SIZE / 2) * SIZE + SIZE / 2);
    for (let c = 0; c < 3; c += 1) {
      expect(Math.abs((actual[c] ?? 0) - (expected[c] ?? 0))).toBeLessThanOrEqual(NORMAL_DECODE_TOLERANCE);
    }
    expect(actual[1]).toBeLessThan(0);
  });

  it('scales with the declared strength: a steeper ramp tilts further', () => {
    const gentle = decodeNormalTexel(deriveNormalMap(rampU(SIZE, 0.004), SIZE), 33 * SIZE + 33);
    const steep = decodeNormalTexel(deriveNormalMap(rampU(SIZE, 0.04), SIZE), 33 * SIZE + 33);
    expect(steep[0]).toBeLessThan(gentle[0]);
    expect(steep[2]).toBeLessThan(gentle[2]);
  });

  it('keeps Z positive everywhere, on every ramp and every real material', () => {
    const fields = [rampU(SIZE, 0.25), rampV(SIZE, -0.25), constantField(SIZE, 0)];
    for (const name of MATERIAL_NAMES) fields.push(generateAlbedo(name, SIZE).height);
    for (const field of fields) {
      const map = deriveNormalMap(field, SIZE);
      for (let i = 0; i < SIZE * SIZE; i += 1) {
        expect(map[i * RGBA_CHANNELS + 2]).toBeGreaterThanOrEqual(128);
        expect(decodeNormalTexel(map, i)[2]).toBeGreaterThan(0);
      }
    }
  });
});

describe('US2-S3: every decoded normal is unit length', () => {
  it.each([...MATERIAL_NAMES])('%s decodes to unit length at every texel', (name) => {
    const map = deriveNormalMap(generateAlbedo(name, SIZE).height, SIZE);
    let worst = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const [x, y, z] = decodeNormalTexel(map, i);
      worst = Math.max(worst, Math.abs(Math.hypot(x, y, z) - 1));
    }
    expect(worst).toBeLessThanOrEqual(NORMAL_UNIT_TOLERANCE);
  });

  it('holds for a violently steep field, where quantisation is worst', () => {
    const field = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < field.length; i += 1) field[i] = i % 2 === 0 ? 0 : 40;
    const map = deriveNormalMap(field, SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const [x, y, z] = decodeNormalTexel(map, i);
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThanOrEqual(NORMAL_UNIT_TOLERANCE);
    }
  });

  it('sets alpha opaque so the buffer is a complete RGBA texture', () => {
    const map = deriveNormalMap(generateAlbedo('stone', SIZE).height, SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) expect(map[i * RGBA_CHANNELS + 3]).toBe(255);
  });
});

describe('US2-S4: the derivation reads the height field, not albedo luminance', () => {
  it('ignores a violently varying albedo when the height field is constant', () => {
    const brick = generateAlbedo('brick', SIZE);
    const map = deriveNormalMap(constantField(SIZE, 0.5), SIZE);
    // The brick albedo has strong mortar-versus-face luminance structure...
    const luminance = luminanceField(brick.albedo);
    let spread = 0;
    for (let i = 1; i < luminance.length; i += 1) {
      spread = Math.max(spread, Math.abs((luminance[i] ?? 0) - (luminance[0] ?? 0)));
    }
    expect(spread).toBeGreaterThan(0.05);
    // ...and none of it reaches the normal map, because height is what is read.
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(map[i * RGBA_CHANNELS]).toBe(128);
      expect(map[i * RGBA_CHANNELS + 1]).toBe(128);
    }
  });

  it('produces a different map from the height field than from albedo luminance', () => {
    for (const name of MATERIAL_NAMES) {
      const generated = generateAlbedo(name, SIZE);
      const fromHeight = deriveNormalMap(generated.height, SIZE);
      const fromLuminance = deriveNormalMap(luminanceField(generated.albedo), SIZE);
      let differing = 0;
      for (let i = 0; i < fromHeight.length; i += 1) {
        if (fromHeight[i] !== fromLuminance[i]) differing += 1;
      }
      expect(differing).toBeGreaterThan(0);
    }
  });

  it('takes a height field and never an albedo buffer in its source', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/materials/normal.ts', import.meta.url)),
      'utf8',
    );
    expect(/\balbedo\b/i.test(source.replace(/^\s*(\/\/|\*).*$/gm, ''))).toBe(false);
    expect(/\bluminance\b/i.test(source.replace(/^\s*(\/\/|\*).*$/gm, ''))).toBe(false);
    expect(/Uint8ClampedArray/.test(source)).toBe(true);
  });
});

describe('the wrapped central difference', () => {
  it('reads the far edge rather than clamping, so a tiling field stays tiling', () => {
    // h(x) = A*sin(2*pi*x/size) tiles exactly; its derivative at x=0 is known.
    const amplitude = 0.4;
    const field = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        field[y * SIZE + x] = amplitude * Math.sin((2 * Math.PI * x) / SIZE);
      }
    }
    const map = deriveNormalMap(field, SIZE);
    const left = decodeNormalTexel(map, 5 * SIZE + 0);
    const right = decodeNormalTexel(map, 5 * SIZE + (SIZE - 1));
    const inner = decodeNormalTexel(map, 5 * SIZE + 1);
    // Wrapped, the edge texel is a near neighbour of its interior neighbour.
    expect(Math.abs(left[0] - inner[0])).toBeLessThan(0.05);
    // Clamping instead of wrapping halves the edge difference; wrapping does not.
    const du = (amplitude * Math.sin((2 * Math.PI * 1) / SIZE) - amplitude * Math.sin((2 * Math.PI * (SIZE - 1)) / SIZE)) / 2;
    const expected = handComputed(du, 0, NORMAL_STRENGTH);
    for (let c = 0; c < 3; c += 1) {
      expect(Math.abs((left[c] ?? 0) - (expected[c] ?? 0))).toBeLessThanOrEqual(NORMAL_DECODE_TOLERANCE);
    }
    expect(right[2]).toBeGreaterThan(0);
  });
});
