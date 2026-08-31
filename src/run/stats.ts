// [US2] The projection of the counters 004 and 007 already maintain into the value the
// stats screen draws (FR-005, FR-006). Pure: no DOM, no three.js, so what the screen
// shows is asserted under `npm run test` and `src/systems/stats-screen/` is left with a
// canvas and a quad.
//
// The whole discipline of this file is in one word of FR-006: the screen *reports*
// counters. So `RunCounters` comes in and comes back out untouched — a projection that
// clamped `kills` to `guardsTotal`, or re-derived `score` from a kill count and the
// score table, would be a second opinion of a figure another spec owns, and the run
// would have two answers for what it was worth. The only arithmetic here is the three
// percentages the screen shows, which are not counters and belong to nobody else.
//
// The other discipline is US2-S3's. A percentage over a zero denominator has no value,
// so `percentOf` answers `null` rather than `NaN`, and every formatter that can be
// handed a `null` prints `PERCENT_PLACEHOLDER`. `NaN` is not a value a canvas can
// refuse to draw — it is a value it draws, in the middle of the screen, forever.

/** What the screen prints in place of a percentage whose denominator is zero
 *  (FR-005, US2-S3). Declared once, so the screen, the tests and the harness name
 *  the same string. */
export const PERCENT_PLACEHOLDER = '--';

/** The heading over the readout, and the line that says how to play again. Both are
 *  spelled from 007's stroke table and nothing else (US2-S5). */
export const STATS_TITLE = 'LEVEL COMPLETE';

export const STATS_RESTART_PROMPT = 'PRESS R TO RESTART';

/** The six rows FR-005 names, in the order they are drawn. */
export const STATS_LABELS = {
  time: 'TIME',
  kills: 'KILLS',
  secrets: 'SECRETS',
  treasure: 'TREASURE',
  score: 'SCORE',
  rating: 'RATING',
} as const;

/** Every figure the screen shows, each named for the counter it was read from:
 *  `kills` is `__diag.combat.kills`, `secretsFound` is
 *  `__diag.interaction.secretsFound`, `treasureFound` and `score` are combat's, and
 *  `guardsTotal` is the length of the guard roster 006 publishes (FR-006). */
export interface RunCounters {
  readonly elapsedMs: number;
  readonly kills: number;
  readonly guardsTotal: number;
  readonly secretsFound: number;
  readonly secretsTotal: number;
  readonly treasureFound: number;
  readonly treasureTotal: number;
  readonly score: number;
}

/** The counters, unchanged, plus the three percentages drawn beside them. A `null`
 *  percentage is an axis the level does not offer (US2-S3). */
export interface RunStats extends RunCounters {
  readonly killPercent: number | null;
  readonly secretPercent: number | null;
  readonly treasurePercent: number | null;
}

/** One row of the screen: what it is called and what it reads. */
export interface StatsLine {
  readonly label: string;
  readonly value: string;
}

/**
 * `found` as a percentage of `total`, or `null` when the question has no answer
 * (FR-005, US2-S3).
 *
 * A zero, negative or non-finite denominator has no percentage, and neither has a
 * non-finite numerator: each of those is a division this file declines to perform
 * rather than one it performs and prints the result of.
 */
export function percentOf(found: number, total: number): number | null {
  if (!Number.isFinite(found) || !Number.isFinite(total)) return null;
  if (total <= 0) return null;
  return (found / total) * 100;
}

/** The projection (FR-006). Every counter is copied; only the percentages are new. */
export function projectRunStats(counters: RunCounters): RunStats {
  return {
    elapsedMs: counters.elapsedMs,
    kills: counters.kills,
    guardsTotal: counters.guardsTotal,
    secretsFound: counters.secretsFound,
    secretsTotal: counters.secretsTotal,
    treasureFound: counters.treasureFound,
    treasureTotal: counters.treasureTotal,
    score: counters.score,
    killPercent: percentOf(counters.kills, counters.guardsTotal),
    secretPercent: percentOf(counters.secretsFound, counters.secretsTotal),
    treasurePercent: percentOf(counters.treasureFound, counters.treasureTotal),
  };
}

/** A whole number, or the placeholder. Truncated rather than rounded, so 99.6% of the
 *  guards is not reported as a clean sweep. */
export function formatPercent(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return PERCENT_PLACEHOLDER;
  return `${Math.max(0, Math.floor(percent))}%`;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Minutes and seconds (FR-005). Minutes are not clamped to two digits: a run that
 *  took two hours reports two hours rather than wrapping to look like eleven minutes. */
export function formatElapsed(elapsedMs: number): string {
  const total = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.floor(elapsedMs / MS_PER_SECOND) : 0;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

/** A count over its total. Both sides are the counters themselves, so this cannot
 *  disagree with `__diag`; a non-finite counter prints as zero rather than as `NaN`. */
export function formatRatio(found: number, total: number): string {
  const whole = (value: number): number => (Number.isFinite(value) ? Math.floor(value) : 0);
  return `${whole(found)}/${whole(total)}`;
}

const GAP = '  ';

/** The screen, as text (FR-005, US2-S1). The system below draws these strokes; it
 *  chooses none of these strings, which is why "what the screen displays" is a claim
 *  vitest can make without a canvas. */
export function statsScreenLines(stats: RunStats, rating: string): readonly StatsLine[] {
  return [
    { label: STATS_LABELS.time, value: formatElapsed(stats.elapsedMs) },
    {
      label: STATS_LABELS.kills,
      value: `${formatRatio(stats.kills, stats.guardsTotal)}${GAP}${formatPercent(stats.killPercent)}`,
    },
    {
      label: STATS_LABELS.secrets,
      value: `${formatRatio(stats.secretsFound, stats.secretsTotal)}${GAP}${formatPercent(stats.secretPercent)}`,
    },
    {
      label: STATS_LABELS.treasure,
      value: `${formatRatio(stats.treasureFound, stats.treasureTotal)}${GAP}${formatPercent(stats.treasurePercent)}`,
    },
    { label: STATS_LABELS.score, value: `${Number.isFinite(stats.score) ? Math.floor(stats.score) : 0}` },
    { label: STATS_LABELS.rating, value: rating },
  ];
}
