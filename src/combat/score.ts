// The one score table and the accumulator that reads it (FR-012). Pure. No call
// site writes a point value — `addScore` is the only way in, and takes a number the
// table produced. Two properties are structural: score cannot decrease, because
// `addScore` drops anything not a positive finite number, and it returns to zero on
// restart, because `resetScore` is a registered resettable, not a scattered call.

/** A record, so a second treasure kind is one entry, not a second table. */
export const TREASURE_KINDS = ['treasure'] as const;

export type TreasureKind = (typeof TREASURE_KINDS)[number];

export interface ScoreTable {
    readonly guardKill: number;
  readonly treasure: Readonly<Record<TreasureKind, number>>;
}

/** The single declared table (FR-012). */
export const SCORE_TABLE: ScoreTable = {
  guardKill: 100,
  treasure: { treasure: 500 },
};

export interface ScoreState {
  points: number;
}

export function createScore(): ScoreState {
  return { points: 0 };
}

/** Ignores anything that would lower the total (FR-012). */
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

/** Zero, and only here (FR-012, US2-S10). */
export function resetScore(state: ScoreState): void {
  state.points = 0;
}
