// The one table this spec's five materials are declared in: a name, a seed, a
// base and accent colour, a roughness range and that material's own generation
// parameters (FR-002, US1-S2). Every later story reads this table; nothing
// tunes a material at a call site.

export type MaterialName = 'brick' | 'stone' | 'wood' | 'steel' | 'blood-stone';

/** The five names in declaration order — the single list to iterate. */
export const MATERIAL_NAMES: readonly MaterialName[] = [
  'brick',
  'stone',
  'wood',
  'steel',
  'blood-stone',
];

export type Rgb = readonly [number, number, number];

export interface RoughnessRange {
  readonly min: number;
  readonly max: number;
}

interface SpecBase<N extends MaterialName, P> {
  readonly name: N;
  /** This material's own seed: the `seed` half of FR-003's `(seed, size)`. */
  readonly seed: number;
  /** The colour the surface reads as overall. */
  readonly base: Rgb;
  /** The colour its mortar, grain, pits or veins read as. */
  readonly accent: Rgb;
  /** The band US2's roughness map decodes into (FR-006). */
  readonly roughness: RoughnessRange;
  readonly params: P;
}

export interface BrickParams {
  /** Courses of brick per texture edge, and bricks per course. */
  readonly courses: number;
  readonly bricksPerCourse: number;
  /** Mortar half-width, as a fraction of a brick's width and of its height. */
  readonly mortarU: number;
  readonly mortarV: number;
  /** Running-bond shift of every other course, in brick widths. */
  readonly bond: number;
  /** Width of the bevel from mortar up to the brick face, in brick widths. */
  readonly bevel: number;
  /** How far the mortar sits below the face, in height-field units. */
  readonly mortarDepth: number;
  readonly faceRelief: number;
  readonly grainPeriod: number;
  readonly grainOctaves: number;
  readonly wearPeriod: number;
  readonly wearStrength: number;
  /** Per-brick tint spread, so a wall is not one flat red (US1-S5). */
  readonly colourJitter: number;
}

export interface StoneParams {
  readonly blotchPeriod: number;
  readonly blotchOctaves: number;
  readonly blotchStrength: number;
  readonly specklePeriod: number;
  readonly speckleOctaves: number;
  readonly speckleStrength: number;
  readonly pitPeriod: number;
  readonly pitThreshold: number;
  readonly pitDepth: number;
}

export interface WoodParams {
  /** Vertical planks per texture edge, and the groove between them. */
  readonly planks: number;
  readonly grooveWidth: number;
  readonly grooveDepth: number;
  /** Grain rings across the texture, and how far the warp bends them. */
  readonly rings: number;
  readonly ringWobble: number;
  readonly warpPeriod: number;
  readonly warpOctaves: number;
  /** The fine streak layer: long in v, tight in u. */
  readonly grainPeriodX: number;
  readonly grainPeriodY: number;
  readonly grainOctaves: number;
  readonly grainStrength: number;
}

export interface SteelParams {
  /** The brush layer: tight across the brush direction, long along it. */
  readonly brushPeriodX: number;
  readonly brushPeriodY: number;
  readonly brushOctaves: number;
  readonly brushStrength: number;
  /** Rolling bands of sheen down the plate, and how far they darken it. */
  readonly sheenBands: number;
  readonly sheenStrength: number;
  /** Speckled pitting, so a plate is not a flat grey (US1-S6). */
  readonly pitPeriod: number;
  readonly pitStrength: number;
  readonly relief: number;
}

export interface BloodStoneParams {
  readonly basePeriod: number;
  readonly baseOctaves: number;
  readonly baseStrength: number;
  /** The vein layer: a ridged fold, thresholded to a width. */
  readonly veinPeriod: number;
  readonly veinOctaves: number;
  readonly veinWidth: number;
  readonly veinDepth: number;
  /** Dark clots that break the veins up. */
  readonly clotPeriod: number;
  readonly clotStrength: number;
}

export type BrickSpec = SpecBase<'brick', BrickParams>;
export type StoneSpec = SpecBase<'stone', StoneParams>;
export type WoodSpec = SpecBase<'wood', WoodParams>;
export type SteelSpec = SpecBase<'steel', SteelParams>;
export type BloodStoneSpec = SpecBase<'blood-stone', BloodStoneParams>;

export type MaterialSpec = BrickSpec | StoneSpec | WoodSpec | SteelSpec | BloodStoneSpec;

export type MaterialTable = {
  readonly [K in MaterialName]: Extract<MaterialSpec, { name: K }>;
};

export const MATERIAL_TABLE: MaterialTable = {
  brick: {
    name: 'brick',
    seed: 0x51a7b1,
    base: [138, 58, 44],
    accent: [138, 132, 122],
    roughness: { min: 0.62, max: 0.94 },
    params: {
      courses: 8,
      bricksPerCourse: 4,
      mortarU: 0.035,
      mortarV: 0.07,
      bond: 0.5,
      bevel: 0.06,
      mortarDepth: 0.22,
      faceRelief: 0.35,
      grainPeriod: 32,
      grainOctaves: 3,
      wearPeriod: 4,
      wearStrength: 0.22,
      colourJitter: 0.12,
    },
  },
  stone: {
    name: 'stone',
    seed: 0x2c9f13,
    base: [172, 170, 162],
    accent: [104, 102, 98],
    roughness: { min: 0.7, max: 1 },
    params: {
      blotchPeriod: 5,
      blotchOctaves: 4,
      blotchStrength: 0.5,
      specklePeriod: 40,
      speckleOctaves: 2,
      speckleStrength: 0.34,
      pitPeriod: 12,
      pitThreshold: 0.74,
      pitDepth: 0.3,
    },
  },
  wood: {
    name: 'wood',
    seed: 0x7ed309,
    base: [188, 134, 76],
    accent: [88, 54, 26],
    roughness: { min: 0.45, max: 0.78 },
    params: {
      planks: 4,
      grooveWidth: 0.035,
      grooveDepth: 0.4,
      rings: 9,
      ringWobble: 0.55,
      warpPeriod: 3,
      warpOctaves: 3,
      grainPeriodX: 64,
      grainPeriodY: 6,
      grainOctaves: 3,
      grainStrength: 0.42,
    },
  },
  steel: {
    name: 'steel',
    seed: 0x1b60d7,
    base: [196, 200, 208],
    accent: [150, 154, 164],
    roughness: { min: 0.12, max: 0.34 },
    params: {
      brushPeriodX: 6,
      brushPeriodY: 96,
      brushOctaves: 3,
      brushStrength: 0.26,
      sheenBands: 3,
      sheenStrength: 0.08,
      pitPeriod: 48,
      pitStrength: 0.1,
      relief: 0.16,
    },
  },
  'blood-stone': {
    name: 'blood-stone',
    seed: 0x3f0d45,
    base: [96, 26, 30],
    accent: [166, 44, 38],
    roughness: { min: 0.55, max: 0.9 },
    params: {
      basePeriod: 6,
      baseOctaves: 4,
      baseStrength: 0.45,
      veinPeriod: 7,
      veinOctaves: 3,
      veinWidth: 0.16,
      veinDepth: 0.32,
      clotPeriod: 24,
      clotStrength: 0.26,
    },
  },
};

/**
 * The same material under a different seed — FR-003's "distinct seeds SHALL
 * produce differing buffers" made callable without editing the table. The
 * switch is what keeps each spec's parameters tied to its own name.
 */
export function reseed(spec: MaterialSpec, seed: number): MaterialSpec {
  switch (spec.name) {
    case 'brick':
      return { ...spec, seed };
    case 'stone':
      return { ...spec, seed };
    case 'wood':
      return { ...spec, seed };
    case 'steel':
      return { ...spec, seed };
    case 'blood-stone':
      return { ...spec, seed };
  }
}
