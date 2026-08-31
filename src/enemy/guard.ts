// The guard record: what a guard *is*, separately from what a tick *does* to it.
// Pure: no DOM, no three.js (FR-001).
//
// This module exists because `step.ts` reached the constitution's 400-line
// ceiling (Article IV). The split is on the seam the code already had — data and
// its constructors here, the tick and the state behaviour there — so `step.ts`
// still declares the `GuardWorld` port it is the point of, and still imports no
// pathfinder and no raycast.

import { GUARD_MAX_HEALTH, GUARD_SPAWN_STATE } from './states';
import type { GuardState } from './states';

/** A grid cell, integer-indexed. */
export interface Cell {
  readonly x: number;
  readonly z: number;
}

/** A continuous position on the grid, in cell units. */
export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface Guard {
  readonly id: string;
  readonly state: GuardState;
  /** Position in cell units; a guard stands at a cell's centre, e.g. 4.5. */
  readonly x: number;
  readonly z: number;
  /** Facing yaw in radians, three.js convention: at 0 the guard faces -Z. */
  readonly facing: number;
  readonly health: number;
  /** The tick this record was last stepped to; -1 before the first step. */
  readonly tick: number;
  readonly stateEnteredTick: number;
  readonly ticksInState: number;
  /** The heading the idle patrol script is currently turning toward. */
  readonly patrolHeading: number;
  /** The last cell the player was seen in, or null if never seen (US1-S3). */
  readonly lastKnownPlayer: Cell | null;
  readonly lastKnownTick: number;
  readonly cooldownTicks: number;
  readonly windupTicks: number;
  /** Whether a shot is wound up and not yet released; cancelled by death. */
  readonly pendingShot: boolean;
  readonly shotsFired: number;
  readonly path: readonly Cell[];
  /** The cell the current path was asked for; a change discards the path. */
  readonly pathGoal: Cell | null;
  readonly pathRequestTick: number;
  /** False once a path request came back unreachable (Edge Cases, FR-011). */
  readonly pathable: boolean;
  /** Whether this step drew from the PRNG — the seed only matters where true. */
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

/** Applies damage without transitioning: the table alone decides state (US1-S7).
 *  A guard already in `death` absorbs nothing, so no second death can fire. */
export function damageGuard(guard: Guard, amount: number): Guard {
  if (guard.state === 'death') return guard;
  return { ...guard, health: Math.max(0, guard.health - amount) };
}

