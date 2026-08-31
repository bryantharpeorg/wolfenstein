// `stepGuard`: one tick of guard behaviour, as a pure function of tick count,
// seeded PRNG, grid, door states, player position and an injected `GuardWorld`
// (FR-002). Pure: no DOM, no three.js (FR-001).
//
// The load-bearing line is the `GuardWorld` interface: sight and pathing are
// declared here and supplied by the caller, so US1's tests satisfy it with a stub
// and US2 fills it for real without opening this file, which imports neither
// `./pathing` nor `./los` nor `./nav`. State is decided in one place only —
// `firstTransition` over the table in `./states`.

import { isTileBlocking, tileKey } from '../player/tiles';
import { wrapYaw } from '../player/look';
import type { Rng } from './rng';
import { damageGuard } from './guard';
import type { Cell, Guard, Point } from './guard';
import {
  ATTACK_WINDUP_TICKS,
  IDLE_TURN_INTERVAL_TICKS,
  IDLE_TURN_JITTER_RADIANS,
  IDLE_TURN_RATE_RADIANS,
  LAST_KNOWN_ARRIVAL_CELLS,
  MOVE_SPEED_CELLS_PER_TICK,
  PATH_NODE_ARRIVAL_CELLS,
  PATH_REQUEST_INTERVAL_TICKS,
  SHOT_COOLDOWN_TICKS,
  firstTransition,
} from './states';
import type { GuardState, TransitionInput } from './states';

// One import for the whole guard surface, `tileKey` included: `doorStates` is
// keyed the way 003 and 004 already key it.
export { createGuard, damageGuard, traceGuard } from './guard';
export type { Cell, CreateGuardOptions, Guard, Point } from './guard';
export { tileKey };

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

/** The port US2 fills. Two questions, and nothing else is asked of the world. */
export interface GuardWorld {
  /** Whether `b` is visible from `a` through the live grid and door state. */
  hasLineOfSight(a: Point, b: Point): boolean;
  /** A route from cell `from` to cell `to`, or the declared unreachable result. */
  findPath(from: Cell, to: Cell): PathResult;
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

/** Moves at most `MOVE_SPEED_CELLS_PER_TICK` toward `target`, refusing a step into
 *  a blocking cell and sliding along the free axis instead. */
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

/** The idle patrol script (US1-S2): a seeded heading, turned toward, plus wobble.
 *  Both draws happen every idle tick whether or not the heading is due, so the
 *  generator's position depends on the tick count and never on a branch — which
 *  is what makes US1-S9's trace comparison exact. */
function patrol(guard: Guard, tick: number, rng: Rng): { facing: number; heading: number } {
  const drawnHeading = wrapYaw(rng.nextRange(-Math.PI, Math.PI));
  const jitter = rng.nextSigned() * IDLE_TURN_JITTER_RADIANS;
  const due = (tick - guard.stateEnteredTick) % IDLE_TURN_INTERVAL_TICKS === 0;
  const heading = due ? drawnHeading : guard.patrolHeading;
  const toward = wrapYaw(heading - guard.facing);
  const turn = Math.max(-IDLE_TURN_RATE_RADIANS, Math.min(IDLE_TURN_RATE_RADIANS, toward));
  return { facing: wrapYaw(guard.facing + turn + jitter), heading };
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

/** The entry effects of a state, applied only on the tick it is arrived in. */
function onEnter(guard: Guard, state: GuardState, tick: number): Guard {
  const entered: Guard = { ...guard, state, stateEnteredTick: tick, ticksInState: 0 };
  switch (state) {
    case 'idle':
      return { ...entered, patrolHeading: entered.facing, path: [], pathGoal: null, pathable: true };
    case 'chase':
      return { ...entered, path: [], pathGoal: null, pathRequestTick: -Infinity };
    case 'attack':
      return {
        ...entered,
        cooldownTicks: SHOT_COOLDOWN_TICKS,
        windupTicks: ATTACK_WINDUP_TICKS,
        pendingShot: true,
      };
    case 'death':
      // The pending shot is cancelled, so none is dealt after death (US1-S7).
      return {
        ...entered,
        cooldownTicks: 0,
        windupTicks: 0,
        pendingShot: false,
        path: [],
        pathGoal: null,
      };
    default:
      return entered;
  }
}

/** Steps one guard by one tick, returning a new record. The argument is never
 *  mutated; only the PRNG in `context.rng` advances in place, and only on a tick
 *  reported as `randomConsumed` (FR-002). */
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

  // Every other state faces its target: the player when visible, else where it
  // was last seen. Facing is derived, never random (US1-S3).
  const target: Point | null = hasLineOfSight
    ? playerPos
    : base.lastKnownPlayer && cellCentre(base.lastKnownPlayer);
  const facing = target === null ? base.facing : yawToward(base, target, base.facing);

  if (base.state === 'alert') {
    // Sight held: hold still. Sight lost: walk to the last known position, where
    // US1-S4's return-to-idle is decided.
    if (hasLineOfSight || target === null) return { ...base, facing };
    if (distance(base, target) <= LAST_KNOWN_ARRIVAL_CELLS) return { ...base, facing };
    const { x, z } = moveToward(base, target, context);
    return { ...base, facing, x, z };
  }

  if (base.state === 'chase') return chase({ ...base, facing }, context);
  return attack({ ...base, facing }, hasLineOfSight);
}

/** True when `a` and `b` name the same cell, either or both possibly absent. */
function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.z === b.z;
}

/** Chase: follow a path the injected world returned, refreshed no more often than
 *  `PATH_REQUEST_INTERVAL_TICKS` (the declared throttle). A guard moves only along
 *  a path, never straight at the player, so a discarded stale path leaves it
 *  standing rather than walking somewhere wrong. */
function chase(guard: Guard, context: StepContext): Guard {
  const goal = guard.lastKnownPlayer;
  // The player moved cell: the path in hand leads to the old one, so it is
  // dropped on this tick rather than followed to it (Edge Cases).
  const stale = !sameCell(goal, guard.pathGoal);
  const path = stale ? [] : guard.path;
  const due = context.tick - guard.pathRequestTick >= PATH_REQUEST_INTERVAL_TICKS;

  let current: Guard = { ...guard, path, pathGoal: goal };
  if (goal !== null && due) {
    const result = context.world.findPath({ x: Math.floor(guard.x), z: Math.floor(guard.z) }, goal);
    current = {
      ...current,
      pathRequestTick: context.tick,
      pathable: !isUnreachable(result),
      path: isUnreachable(result) ? [] : result.cells,
    };
  }

  const next = current.path[0];
  if (next === undefined) return current;
  const { x, z } = moveToward(current, cellCentre(next), context);
  const arrived = distance({ x, z }, cellCentre(next)) <= PATH_NODE_ARRIVAL_CELLS;
  return { ...current, x, z, path: arrived ? current.path.slice(1) : current.path };
}

/** Attack: hold position, serve the cooldown a tick at a time, release the shot
 *  when its wind-up expires. The cooldown is not counted on the tick the state is
 *  entered — that tick *is* the arming — and its running out is what lets the
 *  table send the guard back to chase (US1-S6). */
function attack(guard: Guard, hasLineOfSight: boolean): Guard {
  if (guard.ticksInState === 0) return guard;

  // Sight broken mid-wind-up: the shot is never emitted (US3-S5).
  if (!hasLineOfSight && guard.pendingShot) {
    return { ...guard, pendingShot: false, cooldownTicks: Math.max(0, guard.cooldownTicks - 1) };
  }

  if (guard.cooldownTicks <= 0) {
    // Still in contact and off cooldown: wind up the next shot.
    return {
      ...guard,
      cooldownTicks: SHOT_COOLDOWN_TICKS,
      windupTicks: ATTACK_WINDUP_TICKS,
      pendingShot: true,
    };
  }

  const cooldownTicks = guard.cooldownTicks - 1;
  if (!guard.pendingShot) return { ...guard, cooldownTicks };
  const windupTicks = guard.windupTicks - 1;
  if (windupTicks > 0) return { ...guard, cooldownTicks, windupTicks };
  return {
    ...guard,
    cooldownTicks,
    windupTicks: 0,
    pendingShot: false,
    shotsFired: guard.shotsFired + 1,
  };
}
