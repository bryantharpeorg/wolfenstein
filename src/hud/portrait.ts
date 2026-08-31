// T034 (FR-016; US4-S4, US4-S5): the face portrait. *Which* portrait a reading selects is a
// pure question about the declared bands, gap-free so that every living health falls in
// exactly one and the death portrait is what is shown when there are none. *What* it looks
// like is a recipe of shapes computed from the index alone -- no image file, no randomness,
// so the same band is the same face on every call and every machine (US4-S5).

import type { GlyphPoint } from './glyphs';

export interface HealthBand {
  readonly index: number;
  readonly minHealth: number;
  readonly name: string;
}

/** The declared bands (FR-016), highest first. */
export const HEALTH_BANDS: readonly HealthBand[] = [
  { index: 0, minHealth: 85, name: 'unhurt' },
  { index: 1, minHealth: 70, name: 'grazed' },
  { index: 2, minHealth: 55, name: 'bloodied' },
  { index: 3, minHealth: 40, name: 'hurt' },
  { index: 4, minHealth: 25, name: 'wounded' },
  { index: 5, minHealth: 10, name: 'failing' },
  { index: 6, minHealth: 1, name: 'spent' },
];

export const DEATH_PORTRAIT_INDEX = HEALTH_BANDS.length;

export const PORTRAIT_COUNT = HEALTH_BANDS.length + 1;

export function bandForHealth(health: number): HealthBand | null {
  if (!Number.isNaN(health)) {
    for (const band of HEALTH_BANDS) {
      if (health >= band.minHealth) return band;
    }
  }
  return null;
}

/** The portrait index for a reading (US4-S4). A reading that is not a number at
 *  all reads as death rather than as the healthiest face. */
export function portraitIndexForHealth(health: number): number {
  return bandForHealth(health)?.index ?? DEATH_PORTRAIT_INDEX;
}

export interface PortraitShape {
  readonly kind: 'polygon' | 'stroke';
  readonly color: string;
  readonly width: number;
  readonly points: readonly GlyphPoint[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const at = (x: number, y: number): GlyphPoint => [clamp01(x), clamp01(y)];
const mix = (from: number, to: number, t: number): number => from + (to - from) * t;
const rgb = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')}`;
const fill = (color: string, points: readonly GlyphPoint[]): PortraitShape =>
  ({ kind: 'polygon', color, width: 0, points });
const line = (color: string, width: number, points: readonly GlyphPoint[]): PortraitShape =>
  ({ kind: 'stroke', color, width, points });

const FACE: readonly GlyphPoint[] = [at(0.5, 0.06), at(0.82, 0.2), at(0.86, 0.62),
  at(0.68, 0.92), at(0.32, 0.92), at(0.14, 0.62), at(0.18, 0.2)];
const PLATE: readonly GlyphPoint[] = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];

/** The portrait for `index`, drawn from code and from the index alone, so the same band is the
 *  same face on every call (US4-S5). An index no band declares draws nothing rather than the
 *  nearest face: a silent substitution would hide the bug. */
export function portraitShapes(index: number): readonly PortraitShape[] {
  if (!Number.isInteger(index) || index < 0 || index >= PORTRAIT_COUNT) return [];
  const dead = index === DEATH_PORTRAIT_INDEX;
  const hurt = dead ? 1 : index / Math.max(1, HEALTH_BANDS.length - 1);
  const eyeTop = 0.32 + 0.05 * hurt;
  const eyeLow = eyeTop + 0.12 - 0.06 * hurt;
  const mouth = 0.72 + 0.04 * hurt;

  const shapes: PortraitShape[] = [
    fill(rgb(mix(0.1, 0.16, hurt), mix(0.11, 0.04, hurt), mix(0.14, 0.05, hurt)), PLATE),
    fill(dead ? rgb(0.45, 0.42, 0.42)
      : rgb(mix(0.85, 0.7, hurt), mix(0.68, 0.42, hurt), mix(0.55, 0.36, hurt)), FACE),
  ];
  for (const centre of [0.35, 0.65]) {
    if (dead) {
      shapes.push(line(rgb(0.15, 0.1, 0.1), 0.04, [at(centre - 0.08, eyeTop), at(centre + 0.08, eyeLow)]));
      shapes.push(line(rgb(0.15, 0.1, 0.1), 0.04, [at(centre + 0.08, eyeTop), at(centre - 0.08, eyeLow)]));
    } else {
      shapes.push(fill(rgb(0.96, 0.96, 0.92), [at(centre - 0.09, eyeTop), at(centre + 0.09, eyeTop),
        at(centre + 0.09, eyeLow), at(centre - 0.09, eyeLow)]));
    }
  }
  shapes.push(dead
    ? fill(rgb(0.2, 0.08, 0.08), [at(0.38, mouth), at(0.62, mouth), at(0.58, mouth + 0.12), at(0.42, mouth + 0.12)])
    : line(rgb(0.35, 0.14, 0.14), 0.045, [at(0.34, mouth), at(0.5, mouth - 0.02 + 0.04 * hurt), at(0.66, mouth)]));

  return shapes;
}
