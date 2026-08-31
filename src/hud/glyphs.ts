// T033 (FR-016; US4-S1): the code-defined stroke table that makes HUD text possible without
// a typeface file. Constitution II forbids a `.ttf` or `.woff` at any path, and the
// Clarifications forbid a named system family too -- one renders at different widths in
// headless Chromium than on the target machine. A character with no entry here draws
// *nothing*: no fallback, because a silent substitution is how a missing glyph becomes a
// screenshot nobody reads twice.

import type { WeaponKind } from '../combat/weapons';
import type { KeyKind } from '../interaction/interaction-diag';

export type GlyphPoint = readonly [number, number];

export type GlyphStroke = readonly GlyphPoint[];

export type Glyph = { readonly strokes: readonly GlyphStroke[] };

export const GLYPH_GRID = { width: 4, height: 6 } as const;

export const GLYPH_TRACKING = 0.35;

/** The table: every character the HUD can draw is here and nowhere else. A glyph is its strokes,
 *  `|`-separated; a stroke is its points, each a digit of x on `GLYPH_GRID.width` then a digit
 *  of y on its height, origin top-left -- so `'0006|0343'` is a vertical bar with a crossbar.
 *  They are normalised into the unit square below (FR-016, US4-S1). */
const STROKE_SOURCE: Readonly<Record<string, string>> = {
  ' ': '',
  A: '0602204246|0444',
  C: '4130100105163645',
  D: '0006|003041453606',
  E: '40000646|0333',
  G: '41301001051636454323',
  H: '0006|4046|0343',
  I: '1030|2026|1636',
  K: '0006|401346',
  L: '000646',
  M: '0600224046',
  N: '06004640',
  O: '103041453616050110',
  P: '06003041423303',
  R: '06003041423303|2346',
  S: '413010010213334445361605',
  T: '0040|2026',
  U: '000516364540',
  V: '002640',
  Y: '002340|2326',
  0: '103041453616050110|0541',
  1: '112026|1636',
  2: '01103041420646',
  3: '004023|234445361605',
  4: '36300444',
  5: '400002324345361605',
  6: '4130100105163645443303',
  7: '004016',
  8: '130201103041423313|1304051636454433',
  9: '0516364541301001021343',
  ':': '2122|2425',
};

function decode(source: string): Glyph {
  const strokes = source
    .split('|')
    .filter((stroke) => stroke.length >= 4)
    .map((stroke) => {
      const points: GlyphPoint[] = [];
      for (let index = 0; index + 1 < stroke.length; index += 2) {
        points.push([
          Number(stroke[index]) / GLYPH_GRID.width,
          Number(stroke[index + 1]) / GLYPH_GRID.height,
        ]);
      }
      return points;
    });
  return { strokes };
}

export const GLYPH_TABLE: Readonly<Record<string, Glyph>> = Object.fromEntries(
  Object.entries(STROKE_SOURCE).map(([character, source]) => [character, decode(source)]),
);

export const DRAWABLE_CHARACTERS: readonly string[] = Object.keys(GLYPH_TABLE);

/** The readouts the HUD prints (FR-016), declared beside the table that must be able
 *  to spell them, so their coverage is one test's claim. */
export const HUD_LABELS = { health: 'HEALTH', ammo: 'AMMO', score: 'SCORE', keys: 'KEYS' } as const;

export const WEAPON_LABELS: Readonly<Record<WeaponKind, string>> = {
  pistol: 'PISTOL',
  smg: 'SMG',
  chaingun: 'CHAINGUN',
};

export const KEY_LABELS: Readonly<Record<KeyKind, string>> = { silver: 'SILVER', gold: 'GOLD' };

export const HUD_REQUIRED_CHARACTERS: readonly string[] = [...new Set([...Object.values(HUD_LABELS),
  ...Object.values(WEAPON_LABELS), ...Object.values(KEY_LABELS), '0123456789'].join(''))].sort();

/** The glyph, or null — the whole error path, with no substitute mark and no system
 *  typeface behind it (US4-S1). */
export function glyphFor(character: string): Glyph | null {
  if (character.length !== 1) return null;
  return GLYPH_TABLE[character] ?? null;
}

export function canDraw(character: string): boolean {
  return glyphFor(character) !== null;
}

const cellWidth = (size: number): number => (size * GLYPH_GRID.width) / GLYPH_GRID.height;
const advanceBy = (size: number): number => cellWidth(size) + GLYPH_TRACKING * size;

export function textWidth(text: string, size: number): number {
  if (text.length === 0) return 0;
  return text.length * cellWidth(size) + (text.length - 1) * GLYPH_TRACKING * size;
}

export function layoutText(text: string, x: number, y: number, size: number): readonly GlyphStroke[] {
  const advance = advanceBy(size);
  const cell = cellWidth(size);
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
