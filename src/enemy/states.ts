// The guard's behaviour as data: the five states, the tuning constants each edge
// reads, and the transition table that is the single source of truth for which
// edges are legal (FR-001, US1-S1). Pure: no DOM, no three.js.
//
// Nothing here knows how a guard moves or how it sees. A predicate is a total
// function of one plain `TransitionInput` record, which `src/enemy/step.ts`
// assembles once per tick. That is what makes the machine a lookup over data
// rather than a nest of conditionals: to change when a guard attacks, edit the
// constant or the predicate below, never a branch at a call site.

/** The five states, in the order the spec declares them (US1-S1). */
export const GUARD_STATES = ['idle', 'alert', 'chase', 'attack', 'death'] as const;

export type GuardState = (typeof GUARD_STATES)[number];

/** The state a guard spawns in. US1-S8's "spawn state" is named, not implied. */
export const GUARD_SPAWN_STATE: GuardState = 'idle';

// --- Tuning constants -------------------------------------------------------
//
// Declared here once, read by the predicates below and by `step.ts`, so tuning
// never chases literals across files (the arrangement `interaction/params.ts`
// established). The spec fixes relationships, not values (Assumptions).

/** Ticks a guard spends in `alert` before it commits to the chase (US1-S4). */
export const ALERT_DURATION_TICKS = 12;

/** Cells: at or inside this range, with sight, a chasing guard attacks (US1-S5). */
export const ATTACK_RANGE_CELLS = 6;

/** Ticks between shots; `attack` will not release the guard mid-cooldown (US1-S6). */
export const SHOT_COOLDOWN_TICKS = 8;

/** Ticks of wind-up before a shot leaves the barrel; cancelled by death. */
export const ATTACK_WINDUP_TICKS = 3;

/** Cells travelled per tick when moving toward a path node or a last known spot. */
export const MOVE_SPEED_CELLS_PER_TICK = 0.15;

/** Ticks a guard hunts a last known position before giving up on it (US1-S4). */
export const LAST_KNOWN_TIMEOUT_TICKS = 60;

/** Cells: within this of the last known spot counts as having reached it. */
export const LAST_KNOWN_ARRIVAL_CELLS = 0.3;

/** Ticks between path requests per guard — the declared throttle (Edge Cases). */
export const PATH_REQUEST_INTERVAL_TICKS = 8;

/** Ticks between fresh idle patrol headings; the jitter is drawn every tick. */
export const IDLE_TURN_INTERVAL_TICKS = 15;

/** Radians per tick a patrolling guard turns toward its current heading. */
export const IDLE_TURN_RATE_RADIANS = 0.08;

/** Radians of per-tick wobble on top of that turn, so idle is never frozen. */
export const IDLE_TURN_JITTER_RADIANS = 0.02;

// --- The edge predicates ----------------------------------------------------

/**
 * Everything a transition predicate is allowed to look at. `step.ts` computes it
 * once per tick from the tick count, the PRNG, the grid, the door states, the
 * player position and the injected `GuardWorld`; the predicates themselves touch
 * none of those directly, which is why they are trivially testable (FR-002).
 */
export interface TransitionInput {
  /** The tick being stepped. */
  readonly tick: number;
  /** Ticks the guard has already spent in its current state. */
  readonly ticksInState: number;
  /** Whether the injected world reports line of sight to the player this tick. */
  readonly hasLineOfSight: boolean;
  /** Cells between guard and player, straight-line. */
  readonly distanceToPlayer: number;
  /** Cells between guard and the last known player position. */
  readonly distanceToLastKnown: number;
  /** Ticks since the last known player position was recorded. */
  readonly ticksSinceLastKnown: number;
  /** Whether a last known player position has ever been recorded. */
  readonly hasLastKnown: boolean;
  /** Ticks left on the current shot cooldown. */
  readonly cooldownTicks: number;
  /** Whether damage taken has brought the guard to or below zero health. */
  readonly lethalDamage: boolean;
}

/** A predicate guarding one edge. Named, so the table reads as prose (US1-S1). */
export type TransitionGuard = (input: TransitionInput) => boolean;

export interface Transition {
  readonly from: GuardState;
  readonly to: GuardState;
  readonly guard: TransitionGuard;
}

function lethalDamage(input: TransitionInput): boolean {
  return input.lethalDamage;
}

function sightAcquired(input: TransitionInput): boolean {
  return input.hasLineOfSight;
}

function alertElapsedWithSight(input: TransitionInput): boolean {
  return input.hasLineOfSight && input.ticksInState >= ALERT_DURATION_TICKS;
}

// US1-S4's second half: sight lost, so hunt the last known spot and go home once
// it is reached or the declared timeout expires. Sight held is the other edge's
// business, so it is excluded here rather than left to table order.
function searchExhausted(input: TransitionInput): boolean {
  if (input.hasLineOfSight) return false;
  if (!input.hasLastKnown) return true;
  return (
    input.distanceToLastKnown <= LAST_KNOWN_ARRIVAL_CELLS ||
    input.ticksSinceLastKnown >= LAST_KNOWN_TIMEOUT_TICKS
  );
}

function targetInAttackRange(input: TransitionInput): boolean {
  return input.hasLineOfSight && input.distanceToPlayer <= ATTACK_RANGE_CELLS;
}

function sightLostInChase(input: TransitionInput): boolean {
  return !input.hasLineOfSight;
}

// US1-S6: the player leaving range or breaking sight does not release the guard
// mid-shot — the cooldown it is already serving has to end first.
function shotCooldownEndedOutOfContact(input: TransitionInput): boolean {
  if (input.cooldownTicks > 0) return false;
  return !input.hasLineOfSight || input.distanceToPlayer > ATTACK_RANGE_CELLS;
}

/**
 * The transition table (FR-001, US1-S1). Order matters exactly once: the death
 * edges come first, so lethal damage outranks every other edge from every state
 * (US1-S7). `death` appears only as a `to`, never as a `from`.
 */
export const GUARD_TRANSITIONS: readonly Transition[] = [
  { from: 'idle', to: 'death', guard: lethalDamage },
  { from: 'alert', to: 'death', guard: lethalDamage },
  { from: 'chase', to: 'death', guard: lethalDamage },
  { from: 'attack', to: 'death', guard: lethalDamage },

  { from: 'idle', to: 'alert', guard: sightAcquired },
  { from: 'alert', to: 'chase', guard: alertElapsedWithSight },
  { from: 'alert', to: 'idle', guard: searchExhausted },
  { from: 'chase', to: 'attack', guard: targetInAttackRange },
  { from: 'chase', to: 'alert', guard: sightLostInChase },
  { from: 'attack', to: 'chase', guard: shotCooldownEndedOutOfContact },
];

/** Every edge leaving `state`, in table order. Empty for `death` (US1-S7). */
export function transitionsFrom(state: GuardState): readonly Transition[] {
  return GUARD_TRANSITIONS.filter((edge) => edge.from === state);
}

/**
 * The edge that fires this tick, or `null` for "stay put" — the whole of the
 * machine's decision-making, and the only place a state change is decided.
 */
export function firstTransition(state: GuardState, input: TransitionInput): Transition | null {
  for (const edge of GUARD_TRANSITIONS) {
    if (edge.from !== state) continue;
    if (edge.guard(input)) return edge;
  }
  return null;
}
