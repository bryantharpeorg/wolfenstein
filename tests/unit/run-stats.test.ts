// T012 (FR-005, FR-006; US2-S1..S3, US2-S5) and T018 (FR-008; US2-S7). The projection is
// the screen's only arithmetic, so this is where "the screen reports counters, it does not
// recompute them" becomes a claim: every counter handed in comes back out identical, even
// counters that disagree with each other. The zero-denominator case is asserted on the
// formatted text too, because `NaN` is not a value the screen can refuse to draw.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  PERCENT_PLACEHOLDER, STATS_LABELS, STATS_RESTART_PROMPT, STATS_TITLE, formatElapsed,
  formatPercent, formatRatio, percentOf, projectRunStats, statsScreenLines, type RunCounters,
} from '../../src/run/stats';
import { RATING_BANDS } from '../../src/run/rating';
import { RUN_DIAGNOSTIC_FIELDS, ensureRunDiag, publishRunDiagnostics } from '../../src/run/diag';
import { RUN_STATES } from '../../src/run/state';
import { createDiagnostics } from '../../src/diag/diag';
import { ensureCombatDiag } from '../../src/combat/combat-diag';
import { ensureInteractionDiag } from '../../src/interaction/interaction-diag';
import { canDraw } from '../../src/hud/glyphs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const counters = (overrides: Partial<RunCounters> = {}): RunCounters => ({
  elapsedMs: 95_000, kills: 5, guardsTotal: 8, secretsFound: 1, secretsTotal: 2,
  treasureFound: 3, treasureTotal: 4, score: 1700, ...overrides,
});
const labelled = (stats: ReturnType<typeof projectRunStats>, rating: string): Map<string, string> =>
  new Map(statsScreenLines(stats, rating).map((line) => [line.label, line.value]));
const COPIED = ['elapsedMs', 'kills', 'guardsTotal', 'secretsFound', 'secretsTotal',
  'treasureFound', 'treasureTotal', 'score'] as const;

describe('the stats projection reports counters rather than recomputing them (FR-006)', () => {
  it('copies every counter it is handed, field for field', () => {
    const source = counters();
    const stats = projectRunStats(source);
    for (const field of COPIED) expect(stats[field], `${field} was not copied`).toBe(source[field]);
  });

  it('copies counters that disagree with each other rather than correcting them', () => {
    // Clamping or re-deriving any of these would be deciding the number rather than
    // reporting the one 004 and 007 published.
    const stats = projectRunStats(counters({
      kills: 11, guardsTotal: 8, secretsFound: 5, secretsTotal: 2, treasureFound: 9, score: 0,
    }));
    expect(stats.kills).toBe(11);
    expect(stats.secretsFound).toBe(5);
    expect(stats.treasureFound).toBe(9);
    expect(stats.score).toBe(0);
  });

  it('derives each percentage from its own pair of counters, 100 only on a clean axis', () => {
    const stats = projectRunStats(counters());
    expect(stats.killPercent).toBeCloseTo(62.5, 10);
    expect(stats.secretPercent).toBeCloseTo(50, 10);
    expect(stats.treasurePercent).toBeCloseTo(75, 10);
    const all = projectRunStats(counters({ kills: 8, secretsFound: 2, treasureFound: 4 }));
    expect([all.killPercent, all.secretPercent, all.treasurePercent]).toEqual([100, 100, 100]);
  });
});

describe('a zero denominator renders the declared placeholder (FR-005, US2-S3)', () => {
  it('answers null rather than NaN or a division error, on every axis', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(3, -1)).toBeNull();
    expect(percentOf(Number.NaN, 4)).toBeNull();
    expect(percentOf(3, Number.NaN)).toBeNull();
    expect(percentOf(3, Number.POSITIVE_INFINITY)).toBeNull();
    const stats = projectRunStats(counters({ guardsTotal: 0, secretsTotal: 0, treasureTotal: 0 }));
    expect([stats.killPercent, stats.secretPercent, stats.treasurePercent]).toEqual([null, null, null]);
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
    const text = statsScreenLines(stats, 'ROOKIE').map((l) => `${l.label} ${l.value}`).join(' ');
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    expect(text).toContain(PERCENT_PLACEHOLDER);
  });
});

describe('the readouts the screen prints (FR-005, US2-S1)', () => {
  it('formats elapsed time and found-over-total, and refuses nonsense in both', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(95_000)).toBe('1:35');
    expect(formatElapsed(3_723_000)).toBe('62:03');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
    expect(formatElapsed(-5)).toBe('0:00');
    expect(formatRatio(5, 8)).toBe('5/8');
    expect(formatRatio(0, 0)).toBe('0/0');
    expect(formatRatio(Number.NaN, 4)).toBe('0/4');
  });

  it('lists elapsed time, kills, secrets, treasure, score and a rating (US2-S1)', () => {
    const byLabel = labelled(projectRunStats(counters()), 'VETERAN');
    expect(byLabel.get(STATS_LABELS.time)).toBe('1:35');
    expect(byLabel.get(STATS_LABELS.kills)).toBe('5/8  62%');
    expect(byLabel.get(STATS_LABELS.secrets)).toBe('1/2  50%');
    expect(byLabel.get(STATS_LABELS.treasure)).toBe('3/4  75%');
    expect(byLabel.get(STATS_LABELS.score)).toBe('1700');
    expect(byLabel.get(STATS_LABELS.rating)).toBe('VETERAN');
    expect(byLabel.size).toBe(6);
  });

  it('prints the counter it was handed, not one it re-derived (US2-S2)', () => {
    const byLabel = labelled(projectRunStats(counters({ kills: 7, score: 4242 })), 'ACE');
    expect(byLabel.get(STATS_LABELS.kills)?.startsWith('7/8')).toBe(true);
    expect(byLabel.get(STATS_LABELS.score)).toBe('4242');
  });
});

describe("the screen's glyphs come from 007's stroke table (US2-S5)", () => {
  it('can draw every character the screen is able to spell', () => {
    const spelled = [STATS_TITLE, STATS_RESTART_PROMPT, ...Object.values(STATS_LABELS),
      ...RATING_BANDS.map((band) => band.name), PERCENT_PLACEHOLDER, '0123456789',
      formatElapsed(3_723_000), formatRatio(5, 8), formatPercent(62.5)].join('');
    for (const character of spelled) {
      expect(canDraw(character), `the screen spells ${character} but cannot draw it`).toBe(true);
    }
  });

  // Asked of the gate's own walker rather than a second one written here (Constitution II).
  it('has no font file at any path', async () => {
    const { walkAndReport } = await import('../../tools/check-no-binaries');
    expect(walkAndReport(ROOT).filter((finding) => /\.(ttf|otf|woff2?|eot)\b/i.test(finding))).toEqual([]);
  });
});

// "Additive over the 001-007 contracts" is a claim about the whole published object: every
// field those specs own is still present, spelled the same, meaning what it meant.
describe('__diag.run carries FR-008 in full (US2-S7)', () => {
  it('carries every declared field, typed as the harness reads it', () => {
    const run = ensureRunDiag(createDiagnostics('webgl'));
    expect(Object.keys(run).sort()).toEqual([...RUN_DIAGNOSTIC_FIELDS].sort());
    expect(RUN_STATES).toContain(run.state);
    for (const field of [...COPIED, 'completions'] as const) {
      expect(Number.isFinite(run[field]), `${field} is not a number`).toBe(true);
    }
    expect(RATING_BANDS.map((band) => band.name)).toContain(run.rating);
    // Ensured idempotently, so a second reader clears nothing the first wrote.
    const diag = createDiagnostics('webgl');
    const first = ensureRunDiag(diag);
    first.completions = 3;
    expect(ensureRunDiag(diag)).toBe(first);
    expect(diag.run!.completions).toBe(3);
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
    // The slices coexist: `run` is a fourth object beside them, not a rename.
    expect(diag.combat).toBeDefined();
    expect(diag.interaction).toBeDefined();
    expect(diag.run).toBeDefined();
  });

  it('publishes the projection field for field, recomputing none of it (FR-006)', () => {
    const run = ensureRunDiag(createDiagnostics('webgl'));
    const stats = projectRunStats(counters());
    publishRunDiagnostics(run, 'complete', stats, 'ACE', 2);
    expect(run.state).toBe('complete');
    expect(run.rating).toBe('ACE');
    expect(run.completions).toBe(2);
    for (const field of COPIED) {
      expect(run[field], `${field} disagrees with the projection`).toBe(stats[field]);
    }
  });
});
