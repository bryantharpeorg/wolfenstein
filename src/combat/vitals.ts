// The player's vitals: health, the one-way transition into `dead`, and the
// session death counter (FR-009, FR-010). Pure: no DOM, no three.js, and no
// knowledge of where a shot came from — damage arrives as a number, already
// computed by 006's falloff curve, because this spec applies that result rather
// than recomputing it (Assumptions).
//
// `MAX_HEALTH` is declared here and nowhere else in the tree; `vitals.test.ts`
// scans every `src/**/*.ts` for a second declaration and fails the gate on one.
// The transition is one-way by construction: `applyDamage` refuses to spend
// health that is already gone, so a dead player takes no further damage, fires
// no second transition, and increments `deaths` exactly once for that death.

/** What the player spawns with, and what a restart returns them to. */
export const MAX_HEALTH = 100;

/** The floor damage clamps to (FR-009): health is never negative. */
export const MIN_HEALTH = 0;

/** The two declared phases of a run. `dead` is the state FR-010 names. */
export const RUN_PHASES = ['alive', 'dead'] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

/** The whole of what a run's vitals are. `deaths` is a *session* counter and is
 *  deliberately not run state: `resetVitals` leaves it standing (US2-S8). */
export interface PlayerVitals {
  health: number;
  phase: RunPhase;
  deaths: number;
}

/** What one application of damage did. `applied` is what health actually lost,
 *  so an overkill reports the health it took and not the shot's full value. */
export interface DamageReport {
  readonly applied: number;
  readonly health: number;
  /** True on the one application that made the transition, never after. */
  readonly died: boolean;
}

export function createVitals(): PlayerVitals {
  return { health: MAX_HEALTH, phase: 'alive', deaths: 0 };
}

export function isDead(vitals: Readonly<PlayerVitals>): boolean {
  return vitals.phase === 'dead';
}

/**
 * Applies one guard shot's damage (FR-009, FR-010). A shot that deals nothing,
 * or a nonsense amount, changes nothing; a shot that arrives after death changes
 * nothing either, which is what makes the transition one-way.
 */
export function applyDamage(vitals: PlayerVitals, amount: number): DamageReport {
  const nothing: DamageReport = { applied: 0, health: vitals.health, died: false };
  if (!Number.isFinite(amount) || amount <= 0) return nothing;
  if (vitals.phase === 'dead') return nothing;

  // Clamped at the floor, and the report says what was spent rather than what
  // was asked for, so `applied` never exceeds the health that existed.
  const applied = Math.min(amount, vitals.health - MIN_HEALTH);
  vitals.health -= applied;

  if (vitals.health > MIN_HEALTH) return { applied, health: vitals.health, died: false };

  vitals.phase = 'dead';
  vitals.deaths += 1;
  return { applied, health: vitals.health, died: true };
}

/** What restart calls: the run returns to spawn, the session counter does not. */
export function resetVitals(vitals: PlayerVitals): void {
  vitals.health = MAX_HEALTH;
  vitals.phase = 'alive';
}
