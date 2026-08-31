// The guard's behaviour as data: the five states, the tuning constants each edge
// reads, and the transition table that is the single source of truth for which
// edges are legal (FR-001, US1-S1). Pure: no DOM, no three.js.
//
// Nothing here knows how a guard moves or sees. A predicate is a total function
// of one plain `TransitionInput`, which `./step` assembles once per tick — which
// is what makes the machine a lookup over data rather than a nest of
// conditionals: to change when a guard attacks, edit a constant or predicate
// here, never a branch at a call site.

/** The five states, in the order the spec declares them (US1-S1). */
export const GUARD_STATES = ['idle', 'alert', 'chase', 'attack', 'death'] as const;

export type GuardState = (typeof GUARD_STATES)[number];

/** The state a guard spawns in. US1-S8's "spawn state" is named, not implied. */
export const GUARD_SPAWN_STATE: GuardState = 'idle';

// --- Tuning constants -------------------------------------------------------
//
// Declared once here and read by the predicates below and by `step.ts`, so tuning
// never chases literals across files. The spec fixes the relationships, not the
// values (Assumptions).

/** Health at spawn; damage past it enters `death`. */
export const GUARD_MAX_HEALTH = 100;
/** Ticks in `alert` before the guard commits to the chase (US1-S4). */
export const ALERT_DURATION_TICKS = 12;
/** Cells: at or inside this, with sight, a chaser attacks (US1-S5). */
export const ATTACK_RANGE_CELLS = 6;
/** Ticks between shots; no release mid-cooldown (US1-S6). */
export const SHOT_COOLDOWN_TICKS = 8;
/** Ticks of wind-up before a shot leaves; cancelled by death. */
export const ATTACK_WINDUP_TICKS = 3;
/** Cells travelled per tick toward a node or a last known spot. */
export const MOVE_SPEED_CELLS_PER_TICK = 0.15;
/** Ticks a guard hunts a last known position before giving up (US1-S4). */
export const LAST_KNOWN_TIMEOUT_TICKS = 60;
export const LAST_KNOWN_ARRIVAL_CELLS = 0.3;
export const PATH_NODE_ARRIVAL_CELLS = 0.2;
/** Ticks between path requests per guard — the throttle (Edge Cases). */
export const PATH_REQUEST_INTERVAL_TICKS = 8;
/** Ticks between fresh idle headings, and the turn and wobble per tick. */
export const IDLE_TURN_INTERVAL_TICKS = 15;
export const IDLE_TURN_RATE_RADIANS = 0.08;
/** Radians of per-tick wobble, so idle is never frozen. */
export const IDLE_TURN_JITTER_RADIANS = 0.02;

// --- The edge predicates ----------------------------------------------------

/** Everything a transition predicate may look at. `step.ts` computes it once per
 *  tick from the tick count, PRNG, grid, door states, player position and the
 *  injected `GuardWorld`; the predicates touch none of those directly, which is
 *  why they are trivially testable (FR-002). */
export interface TransitionInput {
  readonly tick: number;
  /** Ticks already spent in the current state. */
  readonly ticksInState: number;
  /** What the injected world reports about sight this tick. */
  readonly hasLineOfSight: boolean;
  /** Cells to the player, straight-line. */
  readonly distanceToPlayer: number;
  /** Cells to the last known player position; Infinity when there is none. */
  readonly distanceToLastKnown: number;
  readonly ticksSinceLastKnown: number;
  readonly hasLastKnown: boolean;
  /** Ticks left on the current shot cooldown. */
  readonly cooldownTicks: number;
  /** Whether damage has brought the guard to or below zero health. */
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

// US1-S4's second half: sight lost, so hunt the last known spot and go home on
// reaching it or on the declared timeout. Sight held is the other edge's
// business, excluded here rather than left to table order.
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

/** The transition table (FR-001, US1-S1). Order matters exactly once: the death
 *  edges come first, so lethal damage outranks every other edge from every state
 *  (US1-S7). `death` appears only as a `to`, never as a `from`. */
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

/** The edge that fires this tick, or `null` for "stay put" — the whole of the
 *  machine's decision-making, and the only place a state change is decided. */
export function firstTransition(state: GuardState, input: TransitionInput): Transition | null {
  for (const edge of GUARD_TRANSITIONS) {
    if (edge.from !== state) continue;
    if (edge.guard(input)) return edge;
  }
  return null;
}
