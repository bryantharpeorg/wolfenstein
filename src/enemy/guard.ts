// The guard record: what a guard *is*, separately from what a tick *does* to it.
// Pure: no DOM, no three.js (FR-001). Split out of `step.ts` at the 400-line
// ceiling (Article IV), on the seam the code already had.

import { GUARD_MAX_HEALTH, GUARD_SPAWN_STATE } from './states';
import type { GuardState } from './states';

/** A grid cell, integer-indexed. */
export interface Cell {
  readonly x: number;
  readonly z: number;
}

/** A continuous position on the grid, in cell units. */
export type Point = Cell;

/**
 * A guard, as a value. `x`/`z` are cell units (a guard stands at a centre, 4.5);
 * `facing` is a yaw, 0 looking down -Z; `tick` is the tick last stepped to, -1
 * before the first; `pendingShot` is a shot wound up and not yet released,
 * cancelled by death; `pathGoal` is the cell the path was asked for, so a change
 * discards it; `pathable` goes false on an unreachable request (FR-011); and
 * `randomConsumed` marks the ticks where the seed can matter at all (US1-S9).
 */
export interface Guard {
  readonly id: string;
  readonly state: GuardState;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly health: number;
  readonly tick: number;
  readonly stateEnteredTick: number;
  readonly ticksInState: number;
  /** The heading the idle patrol turns toward. */
  readonly patrolHeading: number;
  /** The last cell the player was seen in, or null if never seen (US1-S3). */
  readonly lastKnownPlayer: Cell | null;
  readonly lastKnownTick: number;
  readonly cooldownTicks: number;
  readonly windupTicks: number;
  readonly pendingShot: boolean;
  readonly shotsFired: number;
  readonly path: readonly Cell[];
  readonly pathGoal: Cell | null;
  readonly pathRequestTick: number;
  readonly pathable: boolean;
  readonly randomConsumed: boolean;
}

export interface CreateGuardOptions {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly facing?: number;
  readonly health?: number;
}

export function createGuard(options: CreateGuardOptions): Guard {
  return {
    id: options.id,
    state: GUARD_SPAWN_STATE,
    x: options.x,
    z: options.z,
    facing: options.facing ?? 0,
    health: options.health ?? GUARD_MAX_HEALTH,
    tick: -1,
    stateEnteredTick: 0,
    ticksInState: 0,
    patrolHeading: options.facing ?? 0,
    lastKnownPlayer: null,
    lastKnownTick: -1,
    cooldownTicks: 0,
    windupTicks: 0,
    pendingShot: false,
    shotsFired: 0,
    path: [],
    pathGoal: null,
    pathRequestTick: -Infinity,
    pathable: true,
    randomConsumed: false,
  };
}

/** One line of the recorded state trace (US1-S9). Stable field order by design. */
export function traceGuard(guard: Guard): string {
  return (
    `${guard.tick} ${guard.state} f=${guard.facing.toFixed(6)}` +
    ` p=${guard.x.toFixed(4)},${guard.z.toFixed(4)}` +
    ` hp=${guard.health} cd=${guard.cooldownTicks} shots=${guard.shotsFired}`
  );
}

/** Applies damage without transitioning — the table alone decides state (US1-S7).
 *  A guard already in `death` absorbs nothing, so no second death can fire. */
export function damageGuard(guard: Guard, amount: number): Guard {
  if (guard.state === 'death') return guard;
  return { ...guard, health: Math.max(0, guard.health - amount) };
}
