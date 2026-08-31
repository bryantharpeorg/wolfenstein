// The player's vitals: health, the one-way transition into `dead`, and the session
// death counter (FR-009, FR-010). Pure, and with no knowledge of where a shot came
// from — damage arrives as a number 006's falloff computed, applied not recomputed.
// `MAX_HEALTH` is declared here and nowhere else; `vitals.test.ts` scans every
// `src/**/*.ts` for a second declaration. The transition is one-way by construction:
// `applyDamage` refuses to spend health already gone, so a dead player takes no
// further damage and counts no second death.

export const MAX_HEALTH = 100;

/** The floor damage clamps to (FR-009). */
export const MIN_HEALTH = 0;

/** `dead` is the state FR-010 names. */
export const RUN_PHASES = ['alive', 'dead'] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

/** `deaths` is a *session* counter, not run state: `resetVitals` leaves it
 *  standing (US2-S8). */
export interface PlayerVitals {
  health: number;
  phase: RunPhase;
  deaths: number;
}

/** `applied` is what health actually lost, so an overkill reports what it took,
 *  not the shot's full value. */
export interface DamageReport {
  readonly applied: number;
  readonly health: number;
  /** True on the application that made the transition, never after. */
  readonly died: boolean;
}

export function createVitals(): PlayerVitals {
  return { health: MAX_HEALTH, phase: 'alive', deaths: 0 };
}

export function isDead(vitals: Readonly<PlayerVitals>): boolean {
  return vitals.phase === 'dead';
}

/** Applies one guard shot's damage (FR-009, FR-010). A shot dealing nothing, a
 *  nonsense amount, or one after death changes nothing — the transition is one-way. */
export function applyDamage(vitals: PlayerVitals, amount: number): DamageReport {
  const nothing: DamageReport = { applied: 0, health: vitals.health, died: false };
  if (!Number.isFinite(amount) || amount <= 0) return nothing;
  if (vitals.phase === 'dead') return nothing;

  // Clamped at the floor; the report says what was spent, not what was asked.
  const applied = Math.min(amount, vitals.health - MIN_HEALTH);
  vitals.health -= applied;

  if (vitals.health > MIN_HEALTH) return { applied, health: vitals.health, died: false };

  vitals.phase = 'dead';
  vitals.deaths += 1;
  return { applied, health: vitals.health, died: true };
}

/** The run returns to spawn; the counter does not. */
export function resetVitals(vitals: PlayerVitals): void {
  vitals.health = MAX_HEALTH;
  vitals.phase = 'alive';
}
