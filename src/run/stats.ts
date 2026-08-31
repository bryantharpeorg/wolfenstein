// [US2] The projection of the counters 004 and 007 maintain into the value the stats screen
// draws (FR-005, FR-006). Pure, so what the screen shows is asserted under `npm run test`.
// The discipline is one word of FR-006: the screen *reports* counters, so `RunCounters`
// comes back out untouched — clamping `kills` to `guardsTotal` would be a second opinion of
// a figure another spec owns. The only arithmetic is the three percentages.

/** What the screen prints for a percentage whose denominator is zero (FR-005, US2-S3),
 *  declared once so screen, tests and harness name one string. */
export const PERCENT_PLACEHOLDER = '--';

/** The heading and the play-again line, spelled from 007's stroke table (US2-S5). */
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

/** Every figure the screen shows, named for the counter it was read from: `kills`,
 *  `treasureFound` and `score` are `__diag.combat`'s, the secrets `__diag.interaction`'s,
 *  `guardsTotal` 006's roster (FR-006). */
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

/** The counters, unchanged, plus the three percentages drawn beside them; a `null`
 *  percentage is an axis the level does not offer (US2-S3). */
export interface RunStats extends RunCounters {
  readonly killPercent: number | null;
  readonly secretPercent: number | null;
  readonly treasurePercent: number | null;
}

export interface StatsLine {
  readonly label: string;
  readonly value: string;
}

/** `found` as a percentage of `total`, or `null` when the question has no answer (FR-005,
 *  US2-S3): a division declined rather than printed as `NaN`, which no canvas refuses. */
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

/** A whole number, or the placeholder. Truncated, so 99.6% is not a clean sweep. */
export function formatPercent(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return PERCENT_PLACEHOLDER;
  return `${Math.max(0, Math.floor(percent))}%`;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Minutes and seconds (FR-005), minutes unclamped so a two-hour run reads as one. */
export function formatElapsed(elapsedMs: number): string {
  const total = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.floor(elapsedMs / MS_PER_SECOND) : 0;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

/** A count over its total, both sides the counters themselves. */
export function formatRatio(found: number, total: number): string {
  const whole = (value: number): number => (Number.isFinite(value) ? Math.floor(value) : 0);
  return `${whole(found)}/${whole(total)}`;
}

const GAP = '  ';

/** The screen, as text (FR-005, US2-S1). The system draws these strokes and chooses none
 *  of these strings, which is why what it displays is a claim vitest can make. */
export function statsScreenLines(stats: RunStats, rating: string): readonly StatsLine[] {
  const axis = (found: number, total: number, percent: number | null): string =>
    `${formatRatio(found, total)}${GAP}${formatPercent(percent)}`;
  return [
    { label: STATS_LABELS.time, value: formatElapsed(stats.elapsedMs) },
    { label: STATS_LABELS.kills, value: axis(stats.kills, stats.guardsTotal, stats.killPercent) },
    { label: STATS_LABELS.secrets, value: axis(stats.secretsFound, stats.secretsTotal, stats.secretPercent) },
    { label: STATS_LABELS.treasure, value: axis(stats.treasureFound, stats.treasureTotal, stats.treasurePercent) },
    { label: STATS_LABELS.score, value: `${Number.isFinite(stats.score) ? Math.floor(stats.score) : 0}` },
    { label: STATS_LABELS.rating, value: rating },
  ];
}
