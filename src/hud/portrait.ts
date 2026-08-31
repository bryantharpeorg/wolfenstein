// T034 (FR-016; US4-S4, US4-S5): the face portrait. Two things live here, and the
// seam between them is the point.
//
// *Which* portrait a health reading selects is a pure question about the declared
// bands, answered by `portraitIndexForHealth`. The ladder is closed and gap-free,
// so every living health falls in exactly one band and zero falls in none of them
// — the death portrait is not a band, it is what is shown when there are none.
//
// *What* that portrait looks like is `portraitShapes`: a deterministic recipe of
// polygons and polylines in the unit square, computed from the index alone. There
// is no image file, no sprite sheet and no randomness, so the same band yields the
// same face on every call and on every machine (US4-S5, Constitution II). The HUD
// rasterises each recipe once at load and blits it thereafter; nothing here knows
// what a canvas is, which is what lets `npm run test` assert all of it.

import type { GlyphPoint } from './glyphs';

/** One rung of the ladder. `minHealth` is inclusive: a player *at* the threshold
 *  is still in this band, and the portrait changes on the first point below it. */
export interface HealthBand {
  readonly index: number;
  readonly minHealth: number;
  readonly name: string;
}

/**
 * The declared bands (FR-016), highest first. Thresholds are stated on the same
 * hundred-point scale `vitals.ts` declares its maximum on, but nothing here reads
 * that constant: a band is a health reading's rung, and a maximum raised later
 * should widen the top band rather than silently renumber every threshold below it.
 */
export const HEALTH_BANDS: readonly HealthBand[] = [
  { index: 0, minHealth: 85, name: 'unhurt' },
  { index: 1, minHealth: 70, name: 'grazed' },
  { index: 2, minHealth: 55, name: 'bloodied' },
  { index: 3, minHealth: 40, name: 'hurt' },
  { index: 4, minHealth: 25, name: 'wounded' },
  { index: 5, minHealth: 10, name: 'failing' },
  { index: 6, minHealth: 1, name: 'spent' },
];

/** The declared death portrait: one past the last band, shown at zero health. */
export const DEATH_PORTRAIT_INDEX = HEALTH_BANDS.length;

/** Every portrait the HUD can show, the death one included. */
export const PORTRAIT_COUNT = HEALTH_BANDS.length + 1;

/** The band a health reading falls in, or null when there is none — which is
 *  exactly the case the death portrait covers. */
export function bandForHealth(health: number): HealthBand | null {
  if (!Number.isNaN(health)) {
    for (const band of HEALTH_BANDS) {
      if (health >= band.minHealth) return band;
    }
  }
  return null;
}

/** The portrait index for a health reading (US4-S4). A reading that is not a
 *  number at all is read as death rather than as the healthiest face: a HUD that
 *  shows a grin for a broken reading is worse than one that shows a corpse. */
export function portraitIndexForHealth(health: number): number {
  return bandForHealth(health)?.index ?? DEATH_PORTRAIT_INDEX;
}

/** A filled outline or a drawn line, both in the unit square. */
export interface PortraitShape {
  readonly kind: 'polygon' | 'stroke';
  /** `#rrggbb`; the HUD passes it straight to the canvas. */
  readonly color: string;
  /** Line width as a fraction of the portrait's height. Ignored for a polygon. */
  readonly width: number;
  readonly points: readonly GlyphPoint[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const channel = (value: number): string =>
  Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0');

const rgb = (r: number, g: number, b: number): string => `#${channel(r)}${channel(g)}${channel(b)}`;

const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

const point = (x: number, y: number): GlyphPoint => [clamp01(x), clamp01(y)];

/** The face outline: one shape for every portrait, so the head does not change
 *  size as the player is hurt — only its colour and what is drawn on it. */
const FACE_OUTLINE: readonly GlyphPoint[] = [
  point(0.5, 0.06),
  point(0.82, 0.2),
  point(0.86, 0.62),
  point(0.68, 0.92),
  point(0.32, 0.92),
  point(0.14, 0.62),
  point(0.18, 0.2),
];

/**
 * The portrait for `index`, drawn from code (US4-S5). Out-of-range indices draw
 * nothing rather than the nearest face: a HUD asking for a portrait that does not
 * exist has a bug, and a silent substitution hides it.
 */
export function portraitShapes(index: number): readonly PortraitShape[] {
  if (!Number.isInteger(index) || index < 0 || index >= PORTRAIT_COUNT) return [];

  const dead = index === DEATH_PORTRAIT_INDEX;
  // How far down the ladder this face is, 0 at full health and 1 at death.
  const hurt = dead ? 1 : index / Math.max(1, HEALTH_BANDS.length - 1);

  const shapes: PortraitShape[] = [];

  // The plate behind the head, darkening as the run goes badly.
  shapes.push({
    kind: 'polygon',
    color: rgb(mix(0.1, 0.16, hurt), mix(0.11, 0.04, hurt), mix(0.14, 0.05, hurt)),
    width: 0,
    points: [point(0, 0), point(1, 0), point(1, 1), point(0, 1)],
  });

  // The face: colour drains and reddens with damage, and goes grey at death.
  shapes.push({
    kind: 'polygon',
    color: dead
      ? rgb(0.45, 0.42, 0.42)
      : rgb(mix(0.85, 0.7, hurt), mix(0.68, 0.42, hurt), mix(0.55, 0.36, hurt)),
    width: 0,
    points: FACE_OUTLINE,
  });

  // The brow, which lowers as the face hardens.
  const brow = 0.24 + 0.04 * hurt;
  shapes.push({
    kind: 'stroke',
    color: rgb(0.24, 0.16, 0.12),
    width: 0.05,
    points: [point(0.24, brow), point(0.76, brow)],
  });

  // The eyes. Alive they are quads that narrow with damage; dead they are two
  // crosses, which is the one shape no living band draws.
  const eyeTop = 0.32 + 0.05 * hurt;
  const eyeBottom = eyeTop + 0.12 - 0.06 * hurt;
  for (const centre of [0.35, 0.65]) {
    if (dead) {
      shapes.push({
        kind: 'stroke',
        color: rgb(0.15, 0.1, 0.1),
        width: 0.04,
        points: [point(centre - 0.08, eyeTop), point(centre + 0.08, eyeBottom)],
      });
      shapes.push({
        kind: 'stroke',
        color: rgb(0.15, 0.1, 0.1),
        width: 0.04,
        points: [point(centre + 0.08, eyeTop), point(centre - 0.08, eyeBottom)],
      });
      continue;
    }
    shapes.push({
      kind: 'polygon',
      color: rgb(0.96, 0.96, 0.92),
      width: 0,
      points: [
        point(centre - 0.09, eyeTop),
        point(centre + 0.09, eyeTop),
        point(centre + 0.09, eyeBottom),
        point(centre - 0.09, eyeBottom),
      ],
    });
    shapes.push({
      kind: 'polygon',
      color: rgb(0.12, 0.13, 0.18),
      width: 0,
      points: [
        point(centre - 0.045, eyeTop + 0.012),
        point(centre + 0.045, eyeTop + 0.012),
        point(centre + 0.045, eyeBottom - 0.012),
        point(centre - 0.045, eyeBottom - 0.012),
      ],
    });
  }

  // The mouth: a grimace whose corners drop with damage, and an open jaw at death.
  const mouth = 0.72;
  shapes.push(
    dead
      ? {
          kind: 'polygon',
          color: rgb(0.2, 0.08, 0.08),
          width: 0,
          points: [point(0.38, mouth - 0.03), point(0.62, mouth - 0.03), point(0.58, mouth + 0.1), point(0.42, mouth + 0.1)],
        }
      : {
          kind: 'stroke',
          color: rgb(0.35, 0.14, 0.14),
          width: 0.045,
          points: [
            point(0.34, mouth + 0.04 * hurt),
            point(0.5, mouth - 0.02 + 0.06 * hurt),
            point(0.66, mouth + 0.04 * hurt),
          ],
        },
  );

  // One streak of blood per rung descended, placed by arithmetic rather than by a
  // random draw, so the same band is the same face forever (US4-S5). They run down
  // the cheeks rather than the brow, where they would sit on top of the eyes and
  // make two bands hard to tell apart at portrait size.
  for (let streak = 0; streak < index; streak += 1) {
    const across = 0.22 + (0.56 * (streak + 1)) / (index + 1);
    const top = 0.46 + 0.05 * (streak % 3);
    const length = 0.1 + 0.04 * (streak % 2);
    shapes.push({
      kind: 'stroke',
      color: rgb(0.6, 0.06, 0.07),
      width: 0.035,
      points: [point(across, top), point(across + 0.02, top + length)],
    });
  }

  return shapes;
}
