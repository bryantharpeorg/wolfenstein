// The one score table and the accumulator that reads it (FR-012). Pure: no DOM,
// no three.js. No call site may write a point value — `addScore` is the only way
// in, and it takes a number the table produced.
//
// Two properties are structural rather than tested-into: score cannot decrease,
// because `addScore` drops anything that is not a positive finite number; and it
// returns to zero on restart, because `resetScore` is registered as a resettable
// rather than called from a dozen places.

/** The treasure kinds 002's item table declares. Keyed as a record so a second
 *  kind is one entry here rather than a second table (spec Key Entities). */
export const TREASURE_KINDS = ['treasure'] as const;

export type TreasureKind = (typeof TREASURE_KINDS)[number];

export interface ScoreTable {
  /** Points for putting a guard down, whatever weapon did it. */
  readonly guardKill: number;
  readonly treasure: Readonly<Record<TreasureKind, number>>;
}

/** The single declared table (FR-012). Every point in the game comes from here. */
export const SCORE_TABLE: ScoreTable = {
  guardKill: 100,
  treasure: { treasure: 500 },
};

/** The run's total. A value, not a global: two runs never share one. */
export interface ScoreState {
  points: number;
}

export function createScore(): ScoreState {
  return { points: 0 };
}

/** Adds `amount`, ignoring anything that would lower the total (FR-012).
 *  Returns the new total, so a caller need not read the field back. */
export function addScore(state: ScoreState, amount: number): number {
  if (Number.isFinite(amount) && amount > 0) state.points += amount;
  return state.points;
}

export function scoreGuardKill(state: ScoreState): number {
  return addScore(state, SCORE_TABLE.guardKill);
}

export function scoreTreasure(state: ScoreState, kind: TreasureKind): number {
  return addScore(state, SCORE_TABLE.treasure[kind]);
}

/** What restart calls: zero, and only here (FR-012, US2-S10). */
export function resetScore(state: ScoreState): void {
  state.points = 0;
}
