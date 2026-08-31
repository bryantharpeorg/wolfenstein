// T030 (FR-016; US4-S1): the HUD's text source. Constitution II forbids a `.ttf`
// or a `.woff` at any path, and the spec's Clarifications forbid a named system
// family too — a system font renders differently in headless Chromium than on the
// target machine, so an assertion made against one is unstable by construction.
//
// Three claims, in the order they matter. *Every* character the table can draw
// resolves to strokes declared in that table; *no* character resolves to anything
// else, so there is no fallback path a missing glyph could take; and the table
// covers what the HUD's own declared readouts spell, read from the module that
// declares them rather than restated here.
//
// T037's score clamp is asserted here too: it is a fact about the HUD's rendered
// text, and `formatScore` is the pure half of `compose.ts` that decides it.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  DRAWABLE_CHARACTERS,
  GLYPH_GRID,
  GLYPH_TABLE,
  GLYPH_TRACKING,
  HUD_LABELS,
  HUD_REQUIRED_CHARACTERS,
  KEY_LABELS,
  WEAPON_LABELS,
  canDraw,
  glyphFor,
  layoutText,
  textWidth,
} from '../../src/hud/glyphs';
import { HUD_SCORE_DIGITS, formatScore } from '../../src/hud/compose';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HUD_DIR = fileURLToPath(new URL('../../src/hud/', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

/** Every file in the tree, so a font cannot hide in a directory this test did not
 *  think to name. */
function allFiles(dir = ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...allFiles(path));
    else found.push(path);
  }
  return found;
}

function hudSources(): { name: string; text: string }[] {
  return readdirSync(HUD_DIR)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => ({ name: entry, text: readFileSync(join(HUD_DIR, entry), 'utf8') }));
}

/** Characters no stroke table here has any business carrying — an accented Latin
 *  letter, a CJK ideograph and a tilde. Asking for one must yield nothing rather
 *  than a substitute drawn by something other than this table. */
const UNDRAWABLE = ['é', '中', '~'];

describe('the HUD glyph table is the only source of a character', () => {
  it('draws every character it claims to draw from strokes in the table', () => {
    expect(DRAWABLE_CHARACTERS.length).toBeGreaterThan(0);
    for (const character of DRAWABLE_CHARACTERS) {
      const glyph = glyphFor(character);
      expect(glyph, `no glyph for ${JSON.stringify(character)}`).not.toBeNull();
      expect(GLYPH_TABLE[character]).toBe(glyph);
      expect(Array.isArray(glyph!.strokes)).toBe(true);
      for (const stroke of glyph!.strokes) {
        // A stroke is a polyline: one point is not a mark anything can draw.
        expect(stroke.length, `degenerate stroke in ${character}`).toBeGreaterThanOrEqual(2);
        for (const [x, y] of stroke) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives every visible character at least one stroke, and the space none', () => {
    for (const character of DRAWABLE_CHARACTERS) {
      const strokes = glyphFor(character)!.strokes;
      if (character === ' ') expect(strokes).toHaveLength(0);
      else expect(strokes.length, `${character} draws nothing`).toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses a character it has no strokes for rather than falling back', () => {
    for (const character of UNDRAWABLE) {
      expect(canDraw(character)).toBe(false);
      expect(glyphFor(character)).toBeNull();
    }
    // A multi-character string is not a glyph key either.
    expect(glyphFor('AB')).toBeNull();
    expect(glyphFor('')).toBeNull();
  });

  it('covers every character the HUD readouts spell', () => {
    const spelled = [
      ...Object.values(HUD_LABELS),
      ...Object.values(WEAPON_LABELS),
      ...Object.values(KEY_LABELS),
      '0123456789',
    ].join('');
    for (const character of spelled) {
      expect(canDraw(character), `the HUD spells ${character} but cannot draw it`).toBe(true);
      expect(HUD_REQUIRED_CHARACTERS).toContain(character);
    }
    for (const character of HUD_REQUIRED_CHARACTERS) {
      expect(canDraw(character)).toBe(true);
    }
    // Every digit, because every readout the HUD shows is a number.
    for (const digit of '0123456789') expect(HUD_REQUIRED_CHARACTERS).toContain(digit);
  });
});

describe('no font file and no named system family', () => {
  it('has no font file anywhere in the tree', () => {
    const fonts = allFiles().filter((path) => /\.(ttf|otf|woff2?|eot)$/i.test(path));
    expect(fonts.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it('names no system font family and calls no canvas text API in src/hud', () => {
    // `ctx.font = '16px monospace'` and `fillText` are the two ways a HUD quietly
    // acquires a system font; both are refused here rather than in review.
    const banned =
      /(\.font\s*=|fillText|strokeText|measureText|sans-serif|monospace|\bserif\b|Arial|Helvetica|Verdana|Courier|@font-face|FontFace)/;
    for (const { name, text } of hudSources()) {
      expect(banned.test(text), `${name} reaches for a system font`).toBe(false);
    }
  });
});

describe('laying text out with the table', () => {
  it('places strokes inside the box it was asked for', () => {
    const size = 20;
    const laid = layoutText('AZ09', 100, 40, size);
    expect(laid.length).toBeGreaterThan(0);
    // `textWidth` and the layout reach the right-hand edge by summing the same
    // terms in a different order, so the last cell can land an ulp outside it.
    const width = textWidth('AZ09', size) + 1e-9;
    for (const stroke of laid) {
      for (const [x, y] of stroke) {
        expect(x).toBeGreaterThanOrEqual(100);
        expect(x).toBeLessThanOrEqual(100 + width);
        expect(y).toBeGreaterThanOrEqual(40);
        expect(y).toBeLessThanOrEqual(40 + size);
      }
    }
  });

  it('advances over a space without drawing one', () => {
    const size = 12;
    expect(layoutText(' ', 0, 0, size)).toHaveLength(0);
    expect(textWidth('A A', size)).toBeGreaterThan(textWidth('AA', size));
    // The advance is the cell plus the declared tracking, in both measurements.
    const cell = size * (GLYPH_GRID.width / GLYPH_GRID.height);
    expect(textWidth('AA', size)).toBeCloseTo(2 * cell + GLYPH_TRACKING * size, 10);
  });

  it('lays nothing out for an empty string', () => {
    expect(layoutText('', 0, 0, 16)).toHaveLength(0);
    expect(textWidth('', 16)).toBe(0);
  });

  it('skips a character it cannot draw instead of substituting one', () => {
    expect(layoutText(UNDRAWABLE[0]!, 0, 0, 16)).toHaveLength(0);
  });
});

describe('the score readout is clamped to its declared width', () => {
  it('renders the declared number of digits', () => {
    expect(HUD_SCORE_DIGITS).toBeGreaterThan(0);
    expect(formatScore(0)).toHaveLength(HUD_SCORE_DIGITS);
    expect(formatScore(1234)).toHaveLength(HUD_SCORE_DIGITS);
    expect(formatScore(0)).toBe('0'.repeat(HUD_SCORE_DIGITS));
    expect(formatScore(1234).endsWith('1234')).toBe(true);
  });

  it('clamps an overflowing score to the width without changing it', () => {
    const overflow = 10 ** HUD_SCORE_DIGITS;
    expect(formatScore(overflow)).toBe('9'.repeat(HUD_SCORE_DIGITS));
    expect(formatScore(overflow * 1000)).toBe('9'.repeat(HUD_SCORE_DIGITS));
    // The largest in-range value still reads as itself.
    expect(formatScore(overflow - 1)).toBe('9'.repeat(HUD_SCORE_DIGITS));
    expect(formatScore(overflow - 2)).toBe(`${overflow - 2}`);
  });

  it('renders a nonsense score as zero rather than as text', () => {
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(formatScore(score)).toBe('0'.repeat(HUD_SCORE_DIGITS));
    }
    for (const rendered of [formatScore(12.7), formatScore(0), formatScore(999)]) {
      expect(rendered).toMatch(/^[0-9]+$/);
      expect(rendered).toHaveLength(HUD_SCORE_DIGITS);
    }
  });

  it('draws every character the clamp can produce', () => {
    for (const character of formatScore(10 ** HUD_SCORE_DIGITS) + formatScore(0)) {
      expect(canDraw(character)).toBe(true);
    }
  });
});
