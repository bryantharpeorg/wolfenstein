// The five height-field-and-colour routines. Each reads one spec from
// `table.ts` and returns raw data: a height field and the RGBA buffer shaded
// from it. Kept apart from the generation orchestrator so neither file
// approaches the 400-line ceiling (FR-001, FR-002, US1-S5, US1-S6).

import { RGBA_CHANNELS } from './constants';
import { fbmField, ridge } from './noise';
import { hash2d } from './rng';
import type {
  BloodStoneSpec,
  BrickSpec,
  MaterialSpec,
  Rgb,
  SteelSpec,
  StoneSpec,
  WoodSpec,
} from './table';

/** A generated surface before anything renderer-shaped touches it. */
export interface RawMaterial {
  readonly albedo: Uint8ClampedArray;
  /** The scalar field the albedo was shaded from, in `0..1`. US2 differentiates
   * this — never the albedo's luminance (FR-005). */
  readonly height: Float32Array;
}

const TAU = Math.PI * 2;

// Seed offsets, so a material's noise layers never share one lattice.
const LAYER_B = 0x2f1c3;
const LAYER_C = 0x5b7d1;

function blankSurface(size: number): { albedo: Uint8ClampedArray; height: Float32Array } {
  return {
    albedo: new Uint8ClampedArray(size * size * RGBA_CHANNELS),
    height: new Float32Array(size * size),
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Writes one opaque texel from a colour scaled by a shade factor. */
function putScaled(albedo: Uint8ClampedArray, index: number, colour: Rgb, shade: number): void {
  const at = index * RGBA_CHANNELS;
  albedo[at] = colour[0] * shade;
  albedo[at + 1] = colour[1] * shade;
  albedo[at + 2] = colour[2] * shade;
  albedo[at + 3] = 255;
}

/** Writes one opaque texel from a blend of two colours, then a shade factor. */
function putMix(
  albedo: Uint8ClampedArray,
  index: number,
  from: Rgb,
  to: Rgb,
  t: number,
  shade: number,
): void {
  const at = index * RGBA_CHANNELS;
  albedo[at] = (from[0] + (to[0] - from[0]) * t) * shade;
  albedo[at + 1] = (from[1] + (to[1] - from[1]) * t) * shade;
  albedo[at + 2] = (from[2] + (to[2] - from[2]) * t) * shade;
  albedo[at + 3] = 255;
}

// A running-bond lattice: bricks beveled up out of recessed mortar, each course
// shifted, each brick tinted its own way so a wall is never one flat red.
function renderBrick(spec: BrickSpec, size: number): RawMaterial {
  const p = spec.params;
  const { albedo, height } = blankSurface(size);
  const grain = fbmField(spec.seed, size, {
    periodX: p.grainPeriod,
    periodY: p.grainPeriod,
    octaves: p.grainOctaves,
  });
  const wear = fbmField(spec.seed + LAYER_B, size, {
    periodX: p.wearPeriod,
    periodY: p.wearPeriod,
    octaves: 2,
  });
  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    const course = Math.floor(v * p.courses);
    const rowFrac = v * p.courses - course;
    const dy = Math.min(rowFrac, 1 - rowFrac);
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const bu = u * p.bricksPerCourse + (course % 2) * p.bond;
      const column = Math.floor(bu);
      const colFrac = bu - column;
      const dx = Math.min(colFrac, 1 - colFrac);
      const index = y * size + x;
      const g = grain[index] ?? 0;
      const w = wear[index] ?? 0;
      if (dx < p.mortarU || dy < p.mortarV) {
        height[index] = p.mortarDepth * (0.7 + 0.5 * g);
        putScaled(albedo, index, spec.accent, 0.8 + 0.4 * g);
        continue;
      }
      // The brick index wraps with the pattern: a course shifted by the bond
      // straddles the buffer edge, and an unwrapped index would tint its two
      // halves differently — a seam at every tile boundary.
      const brick = ((column % p.bricksPerCourse) + p.bricksPerCourse) % p.bricksPerCourse;
      const jitter = 1 + (hash2d(spec.seed + LAYER_C, brick, course) - 0.5) * 2 * p.colourJitter;
      const bevel = clamp01(Math.min(dx - p.mortarU, dy - p.mortarV) / p.bevel);
      const face = 1 - p.faceRelief * (1 - bevel);
      height[index] = p.mortarDepth + (1 - p.mortarDepth) * face * (0.94 + 0.06 * g);
      const shade =
        (0.82 + 0.32 * g) * jitter * (1 - p.wearStrength * w) * (0.85 + 0.15 * bevel);
      putScaled(albedo, index, spec.base, shade);
    }
  }
  return { albedo, height };
}

// Broad blotches, fine speckle and scattered pits: grey that reads as rock
// rather than as a flat fill.
function renderStone(spec: StoneSpec, size: number): RawMaterial {
  const p = spec.params;
  const { albedo, height } = blankSurface(size);
  const blotch = fbmField(spec.seed, size, {
    periodX: p.blotchPeriod,
    periodY: p.blotchPeriod,
    octaves: p.blotchOctaves,
  });
  const speckle = fbmField(spec.seed + LAYER_B, size, {
    periodX: p.specklePeriod,
    periodY: p.specklePeriod,
    octaves: p.speckleOctaves,
  });
  const pits = fbmField(spec.seed + LAYER_C, size, {
    periodX: p.pitPeriod,
    periodY: p.pitPeriod,
    octaves: 2,
  });
  for (let index = 0; index < size * size; index += 1) {
    const b = blotch[index] ?? 0;
    const s = speckle[index] ?? 0;
    const pit = pits[index] ?? 0;
    const sunk = pit > p.pitThreshold ? ((pit - p.pitThreshold) / (1 - p.pitThreshold)) : 0;
    const h = clamp01(
      0.62 + p.blotchStrength * (b - 0.5) + p.speckleStrength * (s - 0.5) - p.pitDepth * sunk,
    );
    height[index] = h;
    putMix(albedo, index, spec.accent, spec.base, clamp01(0.1 + h), 1 - 0.12 * sunk);
  }
  return { albedo, height };
}

// Vertical planks: warped grain rings across each plank, a fine streak layer
// running along it, and a recessed groove between planks.
function renderWood(spec: WoodSpec, size: number): RawMaterial {
  const p = spec.params;
  const { albedo, height } = blankSurface(size);
  const warp = fbmField(spec.seed, size, {
    periodX: p.warpPeriod,
    periodY: p.warpPeriod,
    octaves: p.warpOctaves,
  });
  const grain = fbmField(spec.seed + LAYER_B, size, {
    periodX: p.grainPeriodX,
    periodY: p.grainPeriodY,
    octaves: p.grainOctaves,
  });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const index = y * size + x;
      const plank = Math.floor(u * p.planks);
      const plankFrac = u * p.planks - plank;
      const toEdge = Math.min(plankFrac, 1 - plankFrac);
      const w = warp[index] ?? 0;
      const g = grain[index] ?? 0;
      const phase = u * p.rings + p.ringWobble * (w - 0.5) + hash2d(spec.seed + LAYER_C, plank, 0);
      const rings = 0.5 + 0.5 * Math.sin(TAU * phase);
      if (toEdge < p.grooveWidth) {
        const depth = 1 - p.grooveDepth * (1 - toEdge / p.grooveWidth);
        height[index] = clamp01(0.5 * depth);
        putMix(albedo, index, spec.accent, spec.base, 0.25 + 0.2 * g, depth);
        continue;
      }
      height[index] = clamp01(0.6 + 0.2 * (rings - 0.5) + p.grainStrength * (g - 0.5));
      putMix(albedo, index, spec.accent, spec.base, clamp01(0.5 + 0.42 * rings + 0.34 * (g - 0.5)), 1);
    }
  }
  return { albedo, height };
}

// Brushed plate: a noise layer tight across the brush direction and long along
// it, rolling sheen bands down the plate, and faint pitting.
function renderSteel(spec: SteelSpec, size: number): RawMaterial {
  const p = spec.params;
  const { albedo, height } = blankSurface(size);
  const brush = fbmField(spec.seed, size, {
    periodX: p.brushPeriodX,
    periodY: p.brushPeriodY,
    octaves: p.brushOctaves,
  });
  const pits = fbmField(spec.seed + LAYER_B, size, {
    periodX: p.pitPeriod,
    periodY: p.pitPeriod,
    octaves: 2,
  });
  for (let y = 0; y < size; y += 1) {
    const sheen = 0.5 + 0.5 * Math.sin(TAU * ((y + 0.5) / size) * p.sheenBands);
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const b = brush[index] ?? 0;
      const pit = pits[index] ?? 0;
      const pitted = pit > 0.62 ? (pit - 0.62) / 0.38 : 0;
      height[index] = clamp01(0.7 + p.relief * (b - 0.5) - p.pitStrength * pitted);
      const t = clamp01(0.6 + 1.1 * p.brushStrength * (b - 0.5) + p.sheenStrength * (sheen - 0.5));
      putMix(albedo, index, spec.accent, spec.base, t, 1 - p.pitStrength * pitted);
    }
  }
  return { albedo, height };
}

// Dark rock cut by ridged veins of brighter red, broken up by clots: the
// material that has to read as its own thing beside plain stone.
function renderBloodStone(spec: BloodStoneSpec, size: number): RawMaterial {
  const p = spec.params;
  const { albedo, height } = blankSurface(size);
  const bulk = fbmField(spec.seed, size, {
    periodX: p.basePeriod,
    periodY: p.basePeriod,
    octaves: p.baseOctaves,
  });
  const veins = fbmField(spec.seed + LAYER_B, size, {
    periodX: p.veinPeriod,
    periodY: p.veinPeriod,
    octaves: p.veinOctaves,
  });
  const clots = fbmField(spec.seed + LAYER_C, size, {
    periodX: p.clotPeriod,
    periodY: p.clotPeriod,
    octaves: 2,
  });
  for (let index = 0; index < size * size; index += 1) {
    const b = bulk[index] ?? 0;
    const crest = ridge(veins[index] ?? 0);
    const clot = clots[index] ?? 0;
    const vein = clamp01((crest - (1 - p.veinWidth)) / p.veinWidth);
    height[index] = clamp01(
      0.6 + p.baseStrength * (b - 0.5) - p.veinDepth * vein - p.clotStrength * (clot - 0.5),
    );
    const shade = 0.82 + 0.36 * b - p.clotStrength * (clot - 0.5);
    putMix(albedo, index, spec.base, spec.accent, vein, shade);
  }
  return { albedo, height };
}

/** The one entry point: a spec in, its raw height field and albedo out. */
export function renderMaterial(spec: MaterialSpec, size: number): RawMaterial {
  switch (spec.name) {
    case 'brick':
      return renderBrick(spec, size);
    case 'stone':
      return renderStone(spec, size);
    case 'wood':
      return renderWood(spec, size);
    case 'steel':
      return renderSteel(spec, size);
    case 'blood-stone':
      return renderBloodStone(spec, size);
  }
}
