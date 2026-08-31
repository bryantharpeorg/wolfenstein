// T030 (FR-016; US4-S1): the HUD's text source. Every character the table can draw resolves
// to strokes declared in that table, nothing resolves to anything else, and the table covers
// what the HUD's own declared readouts spell. T037's score clamp is asserted here too: it is
// a fact about the HUD's rendered text, decided by the pure half of `compose.ts`.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { DRAWABLE_CHARACTERS, GLYPH_TABLE, HUD_LABELS, HUD_REQUIRED_CHARACTERS, KEY_LABELS,
  WEAPON_LABELS, canDraw, glyphFor, layoutText, textWidth } from '../../src/hud/glyphs';
import { HUD_DIGITS, formatScore } from '../../src/hud/compose';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HUD_DIR = fileURLToPath(new URL('../../src/hud/', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);

const allFiles = (dir: string = ROOT): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    SKIP.has(entry.name) ? []
      : entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)]);

describe('the HUD glyph table is the only source of a character (US4-S1)', () => {
  it('draws every character it claims to draw from strokes in the table', () => {
    expect(DRAWABLE_CHARACTERS.length).toBeGreaterThan(0);
    for (const character of DRAWABLE_CHARACTERS) {
      const glyph = glyphFor(character);
      expect(glyph, `no glyph for ${JSON.stringify(character)}`).toBe(GLYPH_TABLE[character]);
      if (character === ' ') expect(glyph!.strokes).toHaveLength(0);
      else expect(glyph!.strokes.length, `${character} draws nothing`).toBeGreaterThan(0);
      for (const stroke of glyph!.strokes) {
        expect(stroke.length, `degenerate stroke in ${character}`).toBeGreaterThanOrEqual(2);
        for (const v of stroke.flat()) expect(Number.isFinite(v) && v >= 0 && v <= 1).toBe(true);
      }
    }
  });

  it('refuses a character it has no strokes for rather than falling back', () => {
    for (const character of ['é', '中', '~', 'AB', '']) {
      expect(canDraw(character)).toBe(false);
      expect(glyphFor(character)).toBeNull();
    }
    expect(layoutText('é', 0, 0, 16)).toHaveLength(0);
  });

  it('covers every character the HUD readouts spell', () => {
    const spelled = [...Object.values(HUD_LABELS), ...Object.values(WEAPON_LABELS),
      ...Object.values(KEY_LABELS), '0123456789'].join('');
    for (const character of spelled) {
      expect(canDraw(character), `the HUD spells ${character} but cannot draw it`).toBe(true);
      expect(HUD_REQUIRED_CHARACTERS).toContain(character);
    }
    const width = textWidth('AZ09', 20) + 1e-9;
    for (const [x, y] of layoutText('AZ09', 100, 40, 20).flat()) {
      expect(x >= 100 && x <= 100 + width && y >= 40 && y <= 60).toBe(true);
    }
    expect(layoutText(' ', 0, 0, 20)).toHaveLength(0);
    expect(textWidth('A A', 20)).toBeGreaterThan(textWidth('AA', 20));
  });

  it('has no font file at any path, and reaches for no system family in src/hud', () => {
    expect(allFiles().filter((path) => /\.(ttf|otf|woff2?|eot)$/i.test(path))
      .map((path) => relative(ROOT, path))).toEqual([]);
    const banned = /(\.font\s*=|fillText|strokeText|measureText|sans-serif|monospace|\bserif\b|Arial|Helvetica|Verdana|Courier|@font-face|FontFace)/;
    for (const entry of readdirSync(HUD_DIR).filter((name) => name.endsWith('.ts'))) {
      expect(banned.test(readFileSync(join(HUD_DIR, entry), 'utf8')), `${entry}`).toBe(false);
    }
  });

  it('clamps the score to its declared width without changing it (T037)', () => {
    const width = HUD_DIGITS.score;
    const overflow = 10 ** width;
    expect(formatScore(0)).toBe('0'.repeat(width));
    expect(formatScore(1234)).toHaveLength(width);
    expect(formatScore(1234).endsWith('1234')).toBe(true);
    expect(formatScore(overflow)).toBe('9'.repeat(width));
    expect(formatScore(overflow * 1000)).toBe('9'.repeat(width));
    expect(formatScore(overflow - 2)).toBe(`${overflow - 2}`);
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(formatScore(score)).toBe('0'.repeat(width));
    }
    for (const character of formatScore(12.7) + formatScore(overflow)) expect(canDraw(character)).toBe(true);
  });
});
