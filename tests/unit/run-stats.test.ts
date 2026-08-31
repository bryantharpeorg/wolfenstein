// T012 (FR-005, FR-006; US2-S1, US2-S2, US2-S3, US2-S5). The stats projection is the
// screen's only arithmetic, so this is where "the screen reports counters, it does not
// recompute them" is made a claim rather than a comment: every counter handed in comes
// back out identical, including counters that disagree with each other, because a
// projection that quietly corrected `kills > guardsTotal` would be recomputing.
//
// The zero-denominator case is asserted on the *formatted* text and not only on the
// number, because `NaN` is not a value the screen can refuse to draw — it is a value it
// draws. And US2-S5 is asserted here too: the screen's whole vocabulary resolves through
// 007's stroke table, and no font file exists at any path.

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  PERCENT_PLACEHOLDER,
  STATS_LABELS,
  STATS_RESTART_PROMPT,
  STATS_TITLE,
  formatElapsed,
  formatPercent,
  formatRatio,
  percentOf,
  projectRunStats,
  statsScreenLines,
  type RunCounters,
} from '../../src/run/stats';
import { RATING_BANDS } from '../../src/run/rating';
import {
  RUN_DIAGNOSTIC_FIELDS,
  ensureRunDiag,
  publishRunDiagnostics,
} from '../../src/run/diag';
import { RUN_STATES } from '../../src/run/state';
import { createDiagnostics } from '../../src/diag/diag';
import { ensureCombatDiag } from '../../src/combat/combat-diag';
import { ensureInteractionDiag } from '../../src/interaction/interaction-diag';
import { canDraw } from '../../src/hud/glyphs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);

const allFiles = (dir: string = ROOT): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    SKIP.has(entry.name)
      ? []
      : entry.isDirectory()
        ? allFiles(join(dir, entry.name))
        : [join(dir, entry.name)],
  );

const counters = (overrides: Partial<RunCounters> = {}): RunCounters => ({
  elapsedMs: 95_000,
  kills: 5,
  guardsTotal: 8,
  secretsFound: 1,
  secretsTotal: 2,
  treasureFound: 3,
  treasureTotal: 4,
  score: 1700,
  ...overrides,
});

describe('the stats projection reports counters rather than recomputing them (FR-006)', () => {
  it('copies every counter it is handed, field for field', () => {
    const source = counters();
    const stats = projectRunStats(source);
    for (const field of Object.keys(source) as (keyof RunCounters)[]) {
      expect(stats[field], `${field} was not copied verbatim`).toBe(source[field]);
    }
  });

  it('copies counters that disagree with each other rather than correcting them', () => {
    // A projection that clamped, capped or re-derived any of these would be deciding
    // the number instead of reporting the one 004 and 007 published.
    const wrong = counters({
      kills: 11,
      guardsTotal: 8,
      secretsFound: 5,
      secretsTotal: 2,
      treasureFound: 9,
      treasureTotal: 4,
      score: 0,
    });
    const stats = projectRunStats(wrong);
    expect(stats.kills).toBe(11);
    expect(stats.secretsFound).toBe(5);
    expect(stats.treasureFound).toBe(9);
    expect(stats.score).toBe(0);
  });

  it('derives each percentage from its own pair of counters (US2-S1)', () => {
    const stats = projectRunStats(counters());
    expect(stats.killPercent).toBeCloseTo(62.5, 10);
    expect(stats.secretPercent).toBeCloseTo(50, 10);
    expect(stats.treasurePercent).toBeCloseTo(75, 10);
  });

  it('reaches 100 on each axis only when the run took all of it', () => {
    const stats = projectRunStats(
      counters({ kills: 8, secretsFound: 2, treasureFound: 4 }),
    );
    expect(stats.killPercent).toBe(100);
    expect(stats.secretPercent).toBe(100);
    expect(stats.treasurePercent).toBe(100);
  });
});

describe('a zero denominator renders the declared placeholder (FR-005, US2-S3)', () => {
  it('answers null rather than NaN or a division error', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(3, -1)).toBeNull();
    expect(percentOf(Number.NaN, 4)).toBeNull();
    expect(percentOf(3, Number.NaN)).toBeNull();
    expect(percentOf(3, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('carries the null through the projection on every axis', () => {
    const stats = projectRunStats(
      counters({ guardsTotal: 0, secretsTotal: 0, treasureTotal: 0 }),
    );
    expect(stats.killPercent).toBeNull();
    expect(stats.secretPercent).toBeNull();
    expect(stats.treasurePercent).toBeNull();
  });

  it('formats the placeholder, and never the string NaN', () => {
    expect(formatPercent(null)).toBe(PERCENT_PLACEHOLDER);
    expect(formatPercent(Number.NaN)).toBe(PERCENT_PLACEHOLDER);
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe(PERCENT_PLACEHOLDER);
    expect(formatPercent(62.5)).toBe('62%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('shows no NaN anywhere on a screen whose every denominator is zero', () => {
    const stats = projectRunStats(
      counters({ guardsTotal: 0, secretsTotal: 0, treasureTotal: 0, elapsedMs: Number.NaN }),
    );
    const text = statsScreenLines(stats, 'ROOKIE')
      .map((line) => `${line.label} ${line.value}`)
      .join(' ');
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    expect(text).toContain(PERCENT_PLACEHOLDER);
  });
});

describe('the readouts the screen prints (FR-005, US2-S1)', () => {
  it('formats elapsed time as minutes and seconds, and refuses nonsense', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(95_000)).toBe('1:35');
    expect(formatElapsed(3_723_000)).toBe('62:03');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('formats a found-over-total as a ratio of the counters themselves', () => {
    expect(formatRatio(5, 8)).toBe('5/8');
    expect(formatRatio(0, 0)).toBe('0/0');
    expect(formatRatio(Number.NaN, 4)).toBe('0/4');
  });

  it('lists elapsed time, kills, secrets, treasure, score and a rating (US2-S1)', () => {
    const stats = projectRunStats(counters());
    const lines = statsScreenLines(stats, 'VETERAN');
    const byLabel = new Map(lines.map((line) => [line.label, line.value]));

    expect(byLabel.get(STATS_LABELS.time)).toBe('1:35');
    expect(byLabel.get(STATS_LABELS.kills)).toBe('5/8  62%');
    expect(byLabel.get(STATS_LABELS.secrets)).toBe('1/2  50%');
    expect(byLabel.get(STATS_LABELS.treasure)).toBe('3/4  75%');
    expect(byLabel.get(STATS_LABELS.score)).toBe('1700');
    expect(byLabel.get(STATS_LABELS.rating)).toBe('VETERAN');
    expect(lines).toHaveLength(6);
  });

  it('prints the counter it was handed, not one it re-derived (US2-S2)', () => {
    const stats = projectRunStats(counters({ kills: 7, score: 4242 }));
    const byLabel = new Map(statsScreenLines(stats, 'ACE').map((l) => [l.label, l.value]));
    expect(byLabel.get(STATS_LABELS.kills)?.startsWith('7/8')).toBe(true);
    expect(byLabel.get(STATS_LABELS.score)).toBe('4242');
  });
});

describe("the screen's glyphs come from 007's stroke table (US2-S5)", () => {
  it('can draw every character the screen is able to spell', () => {
    const spelled = [
      STATS_TITLE,
      STATS_RESTART_PROMPT,
      ...Object.values(STATS_LABELS),
      ...RATING_BANDS.map((band) => band.name),
      PERCENT_PLACEHOLDER,
      '0123456789',
      formatElapsed(3_723_000),
      formatRatio(5, 8),
      formatPercent(62.5),
    ].join('');
    for (const character of spelled) {
      expect(canDraw(character), `the stats screen spells ${character} but cannot draw it`).toBe(
        true,
      );
    }
  });

  it('has no font file at any path', () => {
    expect(
      allFiles()
        .filter((path) => /\.(ttf|otf|woff2?|eot)$/i.test(path))
        .map((path) => relative(ROOT, path)),
    ).toEqual([]);
  });
});

// T018 (FR-008; US2-S7). The `run` slice is declared by module augmentation from
// `src/run/diag.ts`, so the claim "additive over the 001-007 contracts" is a claim
// about the whole published object, not just about the new one: every field those
// specs own is still present, still spelled the same way, and still means what it
// meant.
describe('__diag.run carries FR-008 in full (US2-S7)', () => {
  it('carries every declared field, typed as the harness reads it', () => {
    const run = ensureRunDiag(createDiagnostics('webgl'));
    expect(Object.keys(run).sort()).toEqual([...RUN_DIAGNOSTIC_FIELDS].sort());
    expect(RUN_STATES).toContain(run.state);
    for (const field of ['elapsedMs', 'kills', 'guardsTotal', 'secretsFound', 'secretsTotal',
      'treasureFound', 'treasureTotal', 'score', 'completions'] as const) {
      expect(Number.isFinite(run[field]), `${field} is not a number`).toBe(true);
    }
    expect(typeof run.rating).toBe('string');
    expect(RATING_BANDS.map((band) => band.name)).toContain(run.rating);
  });

  it('is additive: 001-007 keep every field they declared', () => {
    const diag = createDiagnostics('webgl');
    const before = Object.keys(diag).sort();
    ensureRunDiag(diag);
    ensureCombatDiag(diag);
    ensureInteractionDiag(diag);
    expect(before.every((field) => field in diag)).toBe(true);
    for (const field of ['ready', 'renderer', 'fps', 'frameTimeMs', 'drawCalls', 'errors',
      'level', 'enemies', 'enemiesAlive'] as const) {
      expect(field in diag, `001-006 field ${field} went missing`).toBe(true);
    }
    // The three slices coexist: `run` is a fourth object beside them, not a rename.
    expect(diag.combat).toBeDefined();
    expect(diag.interaction).toBeDefined();
    expect(diag.run).toBeDefined();
  });

  it('is ensured idempotently, so a second reader clears nothing', () => {
    const diag = createDiagnostics('webgl');
    const first = ensureRunDiag(diag);
    first.completions = 3;
    expect(ensureRunDiag(diag)).toBe(first);
    expect(diag.run!.completions).toBe(3);
  });

  it('publishes the projection field for field, recomputing none of it (FR-006)', () => {
    const run = ensureRunDiag(createDiagnostics('webgl'));
    const stats = projectRunStats(counters());
    publishRunDiagnostics(run, 'complete', stats, 'ACE', 2);

    expect(run.state).toBe('complete');
    expect(run.rating).toBe('ACE');
    expect(run.completions).toBe(2);
    for (const field of ['elapsedMs', 'kills', 'guardsTotal', 'secretsFound', 'secretsTotal',
      'treasureFound', 'treasureTotal', 'score'] as const) {
      expect(run[field], `${field} disagrees with the projection`).toBe(stats[field]);
    }
  });
});
