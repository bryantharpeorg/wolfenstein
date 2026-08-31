// `stepGuard`: one tick of guard behaviour, as a pure function of the tick count,
// the seeded PRNG, the grid, the door states, the player position and an injected
// `GuardWorld` (FR-002). Pure: no DOM, no three.js (FR-001).
//
// The load-bearing line in this file is the `GuardWorld` interface below. Sight
// and pathing are *declared* here and *supplied* by the caller — US1's tests hand
// it a stub over a hand-drawn grid, US2 hands it the real nav binding over the
// level grid and the door state. That is why this module ships and is proven before a
// pathfinder exists, and why US2 never has to open this file: it imports neither
// `./pathing` nor `./los` nor `./nav`, and it never will.
//
// Which state a guard is in is decided in exactly one place — `firstTransition`
// over the table in `./states`. This file only assembles that table's input and
// carries out the behaviour of whichever state the table settled on.

import { isTileBlocking, tileKey } from '../player/tiles';
import { wrapYaw } from '../player/look';
import type { Rng } from './rng';
import {
  ATTACK_WINDUP_TICKS,
  GUARD_MAX_HEALTH,
  GUARD_SPAWN_STATE,
  IDLE_TURN_INTERVAL_TICKS,
  IDLE_TURN_JITTER_RADIANS,
  IDLE_TURN_RATE_RADIANS,
  LAST_KNOWN_ARRIVAL_CELLS,
  MOVE_SPEED_CELLS_PER_TICK,
  SHOT_COOLDOWN_TICKS,
  firstTransition,
} from './states';
import type { GuardState, TransitionInput } from './states';

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

/** A path A* found: adjacent cells from just after the start to the goal. */
export interface PathFound {
  readonly cells: readonly Cell[];
  readonly nodesExpanded: number;
}

/** The declared "no route" answer — never an empty array, never null (FR-003). */
export interface PathUnreachable {
  readonly unreachable: true;
  readonly nodesExpanded: number;
}

export type PathResult = PathFound | PathUnreachable;

export function isUnreachable(result: PathResult): result is PathUnreachable {
  return 'unreachable' in result;
}

/**
 * The port US2 fills. `stepGuard` asks these two questions and asks nothing else
 * of the world; a test satisfies it with two closures.
 */
export interface GuardWorld {
  /** Whether `b` is visible from `a` through the live grid and door state. */
  hasLineOfSight(a: Point, b: Point): boolean;
  /** A route from cell `from` to cell `to`, or the declared unreachable result. */
  findPath(from: Cell, to: Cell): PathResult;
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

export interface StepContext {
  readonly tick: number;
  readonly rng: Rng;
  readonly grid: string[];
  /** Keys of door and secret tiles that are open right now (004's open state). */
  readonly doorStates: ReadonlySet<string>;
  readonly playerPos: Point;
  readonly world: GuardWorld;
  /** Damage delivered to this guard on this tick, if any. */
  readonly damage?: number;
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

/** The yaw that looks from `from` toward `to`; unchanged when they coincide. */
function yawToward(from: Point, to: Point, fallback: number): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return fallback;
  return wrapYaw(Math.atan2(-dx, -dz));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** The centre of a cell — where a guard stands when it has arrived at one. */
function cellCentre(cell: Cell): Point {
  return { x: cell.x + 0.5, z: cell.z + 0.5 };
}

function blocked(context: StepContext, x: number, z: number): boolean {
  return isTileBlocking(context.grid, Math.floor(x), Math.floor(z), context.doorStates);
}

/**
 * Moves at most `MOVE_SPEED_CELLS_PER_TICK` toward `target`, refusing any step
 * whose destination cell blocks and sliding along the free axis instead, so a
 * guard is never pushed into a wall or through a closed door.
 */
function moveToward(guard: Guard, target: Point, context: StepContext): Point {
  const gap = distance(guard, target);
  if (gap === 0) return { x: guard.x, z: guard.z };
  const travel = Math.min(MOVE_SPEED_CELLS_PER_TICK, gap);
  const nx = guard.x + ((target.x - guard.x) / gap) * travel;
  const nz = guard.z + ((target.z - guard.z) / gap) * travel;
  if (!blocked(context, nx, nz)) return { x: nx, z: nz };
  if (!blocked(context, nx, guard.z)) return { x: nx, z: guard.z };
  if (!blocked(context, guard.x, nz)) return { x: guard.x, z: nz };
  return { x: guard.x, z: guard.z };
}

// `tileKey` is imported for callers binding real door state; re-exported so a
// caller assembling `doorStates` uses the same key shape 003 and 004 already do.
export { tileKey };

/** The idle patrol script (US1-S2): a seeded heading, turned toward, plus wobble.
 *
 * Both draws happen on every idle tick, whether or not the heading is due to be
 * refreshed, so the generator's position after N idle ticks depends only on N and
 * never on a branch — which is what makes US1-S9's trace comparison exact. */
function patrol(guard: Guard, tick: number, rng: Rng): { facing: number; heading: number } {
  const drawnHeading = wrapYaw(rng.nextRange(-Math.PI, Math.PI));
  const jitter = rng.nextSigned() * IDLE_TURN_JITTER_RADIANS;
  const due = (tick - guard.stateEnteredTick) % IDLE_TURN_INTERVAL_TICKS === 0;
  const heading = due ? drawnHeading : guard.patrolHeading;
  const toward = wrapYaw(heading - guard.facing);
  const turn = Math.max(-IDLE_TURN_RATE_RADIANS, Math.min(IDLE_TURN_RATE_RADIANS, toward));
  return { facing: wrapYaw(guard.facing + turn + jitter), heading };
}

/** Applies damage without transitioning: the table alone decides state (US1-S7).
 *  A guard already in `death` absorbs nothing, so no second death can fire. */
export function damageGuard(guard: Guard, amount: number): Guard {
  if (guard.state === 'death') return guard;
  return { ...guard, health: Math.max(0, guard.health - amount) };
}

function transitionInput(
  guard: Guard,
  context: StepContext,
  hasLineOfSight: boolean,
  lastKnownPlayer: Cell | null,
  lastKnownTick: number,
): TransitionInput {
  return {
    tick: context.tick,
    ticksInState: context.tick - guard.stateEnteredTick,
    hasLineOfSight,
    distanceToPlayer: distance(guard, context.playerPos),
    distanceToLastKnown:
      lastKnownPlayer === null ? Infinity : distance(guard, cellCentre(lastKnownPlayer)),
    ticksSinceLastKnown: lastKnownPlayer === null ? 0 : context.tick - lastKnownTick,
    hasLastKnown: lastKnownPlayer !== null,
    cooldownTicks: guard.cooldownTicks,
    lethalDamage: guard.health <= 0,
  };
}

/** The entry effects of arriving in a state, applied only on the tick it changes. */
function onEnter(guard: Guard, state: GuardState, tick: number): Guard {
  const entered: Guard = { ...guard, state, stateEnteredTick: tick, ticksInState: 0 };
  switch (state) {
    case 'idle':
      return { ...entered, patrolHeading: entered.facing, path: [], pathable: true };
    case 'chase':
      return { ...entered, path: [], pathRequestTick: -Infinity };
    case 'attack':
      return {
        ...entered,
        cooldownTicks: SHOT_COOLDOWN_TICKS,
        windupTicks: ATTACK_WINDUP_TICKS,
        pendingShot: true,
      };
    case 'death':
      // The pending shot is cancelled here, so no damage is dealt after death is
      // entered (US1-S7, Edge Cases).
      return { ...entered, cooldownTicks: 0, windupTicks: 0, pendingShot: false, path: [] };
    default:
      return entered;
  }
}

/**
 * Steps one guard by one tick, returning a new record. The guard passed in is
 * never mutated; the only thing this function advances in place is the PRNG in
 * `context.rng`, and only on a tick it reports as `randomConsumed` (FR-002).
 */
export function stepGuard(guard: Guard, context: StepContext): Guard {
  const { tick, world, playerPos } = context;

  // `death` is terminal: no perception, no table lookup, no PRNG draw (US1-S7).
  if (guard.state === 'death') {
    return { ...guard, tick, ticksInState: tick - guard.stateEnteredTick, randomConsumed: false };
  }

  const damaged = context.damage ? damageGuard(guard, context.damage) : guard;

  const hasLineOfSight = world.hasLineOfSight({ x: damaged.x, z: damaged.z }, playerPos);
  // US1-S3: the last known position is recorded on the same tick sight is gained.
  const lastKnownPlayer: Cell | null = hasLineOfSight
    ? { x: Math.floor(playerPos.x), z: Math.floor(playerPos.z) }
    : damaged.lastKnownPlayer;
  const lastKnownTick = hasLineOfSight ? tick : damaged.lastKnownTick;

  const input = transitionInput(damaged, context, hasLineOfSight, lastKnownPlayer, lastKnownTick);
  const edge = firstTransition(damaged.state, input);

  const seen: Guard = { ...damaged, lastKnownPlayer, lastKnownTick };
  const moved = edge === null ? seen : onEnter(seen, edge.to, tick);

  return act(moved, context, hasLineOfSight);
}

/** The behaviour of whichever state the table settled on, for this one tick. */
function act(guard: Guard, context: StepContext, hasLineOfSight: boolean): Guard {
  const { tick, rng, playerPos } = context;
  const base: Guard = {
    ...guard,
    tick,
    ticksInState: tick - guard.stateEnteredTick,
    randomConsumed: false,
  };

  if (base.state === 'death') return base;

  if (base.state === 'idle') {
    const { facing, heading } = patrol(base, tick, rng);
    return { ...base, facing, patrolHeading: heading, randomConsumed: true };
  }

  // Every other state looks at its target: the player when visible, otherwise the
  // last place it was seen. Facing is derived, never random (US1-S3).
  const target: Point | null = hasLineOfSight
    ? playerPos
    : base.lastKnownPlayer && cellCentre(base.lastKnownPlayer);
  const facing = target === null ? base.facing : yawToward(base, target, base.facing);

  if (base.state === 'alert') {
    // Sight held: the guard holds still and winds up. Sight lost: it walks to the
    // last known position, which is where US1-S4's return-to-idle is decided.
    if (hasLineOfSight || target === null) return { ...base, facing };
    if (distance(base, target) <= LAST_KNOWN_ARRIVAL_CELLS) return { ...base, facing };
    const { x, z } = moveToward(base, target, context);
    return { ...base, facing, x, z };
  }

  return { ...base, facing };
}
