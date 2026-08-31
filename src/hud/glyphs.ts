// T033 (FR-016; US4-S1): the code-defined stroke table that makes HUD text
// possible without a typeface file. Pure — no DOM, no three.js — so the layout it
// produces is asserted under `npm run test` rather than by looking at a screen.
//
// Constitution II forbids a `.ttf` or a `.woff` anywhere in the tree, and the
// spec's Clarifications forbid leaning on a named system family too: a system
// typeface renders at different widths in headless Chromium than on the target
// machine, so a HUD assertion made against one is unstable by construction. The
// answer to both is the same — every mark the HUD can draw is a polyline declared
// below, and a character with no entry draws *nothing*. There is deliberately no
// fallback: a silent substitution is how a missing glyph becomes a screenshot
// nobody reads twice.
//
// Glyphs are declared on a 4x6 integer grid, origin top-left, and normalised into
// the unit square on the way into the table. The grid keeps the declarations
// readable as shapes; the unit square keeps every consumer free of a pixel size.

import type { WeaponKind } from '../combat/weapons';
import type { KeyKind } from '../interaction/interaction-diag';

/** `[x, y]` in the unit square, y running downward as a canvas does. */
export type GlyphPoint = readonly [number, number];

/** A polyline of at least two points: one pen-down, several pen-moves. */
export type GlyphStroke = readonly GlyphPoint[];

export interface Glyph {
  readonly strokes: readonly GlyphStroke[];
}

/** The integer grid the declarations below are written on. */
export const GLYPH_GRID = { width: 4, height: 6 } as const;

/** The gap between two cells, as a fraction of the glyph height. */
export const GLYPH_TRACKING = 0.35;

/** One glyph from flat `[x0, y0, x1, y1, ...]` strokes on `GLYPH_GRID`. */
function glyph(...strokes: readonly (readonly number[])[]): Glyph {
  return {
    strokes: strokes.map((flat) => {
      const points: GlyphPoint[] = [];
      for (let index = 0; index + 1 < flat.length; index += 2) {
        points.push([flat[index]! / GLYPH_GRID.width, flat[index + 1]! / GLYPH_GRID.height]);
      }
      return points;
    }),
  };
}

/**
 * The table. Every character the HUD can draw is here and nowhere else.
 *
 * The full alphabet is declared rather than only the letters today's readouts
 * spell: `008` adds an end-of-level stats screen, and a table that covers A-Z
 * once is cheaper than a table that grows a letter at a time and is asserted
 * complete each time.
 */
export const GLYPH_TABLE: Readonly<Record<string, Glyph>> = {
  ' ': glyph(),

  A: glyph([0, 6, 0, 2, 2, 0, 4, 2, 4, 6], [0, 4, 4, 4]),
  B: glyph([0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 0, 6]),
  C: glyph([4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]),
  D: glyph([0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 4, 5, 3, 6, 0, 6]),
  E: glyph([4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]),
  F: glyph([4, 0, 0, 0, 0, 6], [0, 3, 3, 3]),
  G: glyph([4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]),
  H: glyph([0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]),
  I: glyph([1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]),
  J: glyph([3, 0, 3, 5, 2, 6, 1, 6, 0, 5]),
  K: glyph([0, 0, 0, 6], [4, 0, 1, 3, 4, 6]),
  L: glyph([0, 0, 0, 6, 4, 6]),
  M: glyph([0, 6, 0, 0, 2, 2, 4, 0, 4, 6]),
  N: glyph([0, 6, 0, 0, 4, 6, 4, 0]),
  O: glyph([1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]),
  P: glyph([0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]),
  Q: glyph([1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [2, 4, 4, 6]),
  R: glyph([0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [2, 3, 4, 6]),
  S: glyph([4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]),
  T: glyph([0, 0, 4, 0], [2, 0, 2, 6]),
  U: glyph([0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]),
  V: glyph([0, 0, 2, 6, 4, 0]),
  W: glyph([0, 0, 1, 6, 2, 3, 3, 6, 4, 0]),
  X: glyph([0, 0, 4, 6], [4, 0, 0, 6]),
  Y: glyph([0, 0, 2, 3, 4, 0], [2, 3, 2, 6]),
  Z: glyph([0, 0, 4, 0, 0, 6, 4, 6]),

  0: glyph([1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [0, 5, 4, 1]),
  1: glyph([1, 1, 2, 0, 2, 6], [1, 6, 3, 6]),
  2: glyph([0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]),
  3: glyph([0, 0, 4, 0, 2, 3], [2, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]),
  4: glyph([3, 6, 3, 0, 0, 4, 4, 4]),
  5: glyph([4, 0, 0, 0, 0, 2, 3, 2, 4, 3, 4, 5, 3, 6, 1, 6, 0, 5]),
  6: glyph([4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]),
  7: glyph([0, 0, 4, 0, 1, 6]),
  8: glyph(
    [1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3],
    [1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3],
  ),
  9: glyph([0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 4, 3]),

  '-': glyph([1, 3, 3, 3]),
  '.': glyph([2, 5, 2, 6]),
  ':': glyph([2, 1, 2, 2], [2, 4, 2, 5]),
  '/': glyph([4, 0, 0, 6]),
};

/** Every character the table can draw, in declaration order. */
export const DRAWABLE_CHARACTERS: readonly string[] = Object.keys(GLYPH_TABLE);

/** The readout labels the HUD prints (FR-016). Declared here, beside the table
 *  that has to be able to spell them, so "the table covers what the HUD needs" is
 *  a claim one test can make without knowing the layout. */
export const HUD_LABELS = {
  health: 'HEALTH',
  ammo: 'AMMO',
  score: 'SCORE',
  keys: 'KEYS',
} as const;

/** The active weapon's name, per kind 001 declares. */
export const WEAPON_LABELS: Readonly<Record<WeaponKind, string>> = {
  pistol: 'PISTOL',
  smg: 'SMG',
  chaingun: 'CHAINGUN',
};

/** 004's key kinds, spelled out: a coloured pip alone is not a *count*. */
export const KEY_LABELS: Readonly<Record<KeyKind, string>> = {
  silver: 'SILVER',
  gold: 'GOLD',
};

/** Derived, never restated: every character the labels spell, plus every digit,
 *  because every value the HUD shows is a number. */
export const HUD_REQUIRED_CHARACTERS: readonly string[] = [
  ...new Set(
    [
      ...Object.values(HUD_LABELS),
      ...Object.values(WEAPON_LABELS),
      ...Object.values(KEY_LABELS),
      '0123456789',
    ]
      .join('')
      .split(''),
  ),
].sort();

/** The glyph for one character, or null. Null is the whole error path: there is
 *  no substitute mark and no system typeface behind it (US4-S1). */
export function glyphFor(character: string): Glyph | null {
  if (character.length !== 1) return null;
  return GLYPH_TABLE[character] ?? null;
}

export function canDraw(character: string): boolean {
  return glyphFor(character) !== null;
}

/** The cell width for a glyph drawn `size` pixels tall. */
export function glyphCellWidth(size: number): number {
  return (size * GLYPH_GRID.width) / GLYPH_GRID.height;
}

/** The advance from one cell's left edge to the next. */
export function glyphAdvance(size: number): number {
  return glyphCellWidth(size) + GLYPH_TRACKING * size;
}

/** The width `text` occupies at `size`, so a caller can right-align without
 *  asking anything to measure a string for it. */
export function textWidth(text: string, size: number): number {
  if (text.length === 0) return 0;
  return text.length * glyphCellWidth(size) + (text.length - 1) * GLYPH_TRACKING * size;
}

/**
 * `text` as absolute polylines, its top-left corner at `(x, y)` and its cells
 * `size` pixels tall. A character the table cannot draw contributes no strokes
 * and still advances, so an unknown character leaves a gap rather than a mark
 * something else drew.
 */
export function layoutText(text: string, x: number, y: number, size: number): readonly GlyphStroke[] {
  const advance = glyphAdvance(size);
  const cell = glyphCellWidth(size);
  const laid: GlyphStroke[] = [];

  [...text].forEach((character, index) => {
    const found = glyphFor(character);
    if (found == null) return;
    const left = x + index * advance;
    for (const stroke of found.strokes) {
      laid.push(stroke.map(([px, py]): GlyphPoint => [left + px * cell, y + py * size]));
    }
  });

  return laid;
}
