// The `Navigator`: the adapter that binds 002's level grid and 004's open-tile
// state into the `GuardWorld` port `./step` declares, and adds the three things a
// *live* world needs that a pure search does not (FR-003, FR-004, Edge Cases).
// Pure: no DOM, no three.js (FR-001).
//
// One, a throttle. `findPath` is cheap but not free, and ten guards asking every
// tick is the failure mode this spec exists to make impossible. Each guard gets
// at most one search per `PATH_REQUEST_INTERVAL_TICKS`; every suppressed request
// returns the cached answer and is *counted*, so a regression shows up in the
// report rather than in the frame time.
//
// Two, invalidation. A throttle that held a stale answer would be worse than no
// throttle, so two events cut through it and force a fresh search on the very
// next tick: the goal cell changing (the player moved, or teleported), and a door
// the held path traverses closing under it.
//
// Three, claims. Two guards converging on one corridor cell would otherwise both
// path to it and grind against each other. Each guard claims the cell it is
// actually pathing to; a claimed cell sends the next guard to the nearest free
// unclaimed one, so no two share a destination, no claim lands in a wall, and
// nobody is left with nowhere to go.

import { LEVEL_GRID } from '../level';
import { openTiles } from '../interaction/open-state';
import { isTileBlocking, tileKey } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import { hasLineOfSight } from './los';
import { MAX_NODE_EXPANSIONS, findPath } from './pathing';
import { PATH_REQUEST_INTERVAL_TICKS } from './states';
import type { Cell, GuardWorld, PathResult, Point } from './step';

/** How far from the cell it was asked for a guard's claim may be displaced,
 *  in Manhattan steps. Three rings is enough for a one-wide corridor to seat a
 *  small crowd and small enough that a guard never targets somewhere unrelated. */
export const CLAIM_SEARCH_RADIUS = 3;

/** Claim candidates, nearest ring first, in a fixed order — the displacement a
 *  guard takes must not depend on iteration accidents. Built once at load. */
const CLAIM_OFFSETS: ReadonlyArray<Cell> = (() => {
  const offsets: Cell[] = [];
  for (let radius = 0; radius <= CLAIM_SEARCH_RADIUS; radius += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      const span = radius - Math.abs(z);
      for (const x of span === 0 ? [0] : [-span, span]) offsets.push({ x, z });
    }
  }
  return offsets;
})();

export interface NavigatorOptions {
  /** The grid to path over. Defaults to 002's level. */
  readonly grid?: string[];
  /** The live open-tile set, re-read per query so a door opening counts at once.
   *  Defaults to 004's registry. */
  readonly doorStates?: () => OpenState;
  readonly pathRequestIntervalTicks?: number;
  readonly maxNodeExpansions?: number;
}

/** What the `Navigator` did, so the throttle and the cap are visible rather than
 *  merely applied (FR-004, Edge Cases). US3 publishes these through `__diag`. */
export interface NavReport {
  /** The declared throttle interval, echoed so a regression names itself. */
  readonly intervalTicks: number;
  readonly maxNodeExpansions: number;
  /** Searches actually run. */
  readonly searches: number;
  /** Requests answered from the cache because the throttle had not elapsed. */
  readonly throttled: number;
  /** Searches forced early because the goal cell had changed. */
  readonly staleGoals: number;
  /** Searches forced early because a door on the held path had closed. */
  readonly doorInvalidations: number;
  readonly nodesExpanded: number;
  readonly maxNodesExpanded: number;
  /** Guards currently holding a claimed cell. */
  readonly claims: number;
}

export interface Navigator {
  /** Moves the `Navigator` to `tick`; the throttle is measured against it. */
  beginTick(tick: number): void;
  /** The port for one guard — sight is shared, pathing is per guard. */
  worldFor(guardId: string): GuardWorld;
  /** The cell this guard is actually pathing to, after claiming (T017). */
  claimedCell(guardId: string): Cell | null;
  /** Forgets a guard: its claim is freed and its cached path dropped. */
  releaseGuard(guardId: string): void;
  report(): NavReport;
}

/** Everything the `Navigator` remembers about one guard between ticks. */
interface GuardNav {
  lastRequestTick: number;
  result: PathResult | null;
  /** The cell the caller asked for, so a change is detectable. */
  requestedGoal: Cell | null;
  /** The door and secret tiles the held path crosses, open when it was found. */
  doorsOnPath: string[];
  claim: Cell | null;
  world: GuardWorld | null;
}

function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.z === b.z;
}

export function createNavigator(options: NavigatorOptions = {}): Navigator {
  const grid = options.grid ?? LEVEL_GRID;
  const readDoors = options.doorStates ?? openTiles;
  const intervalTicks = options.pathRequestIntervalTicks ?? PATH_REQUEST_INTERVAL_TICKS;
  const maxNodeExpansions = options.maxNodeExpansions ?? MAX_NODE_EXPANSIONS;

  const guards = new Map<string, GuardNav>();
  let tick = 0;
  let searches = 0;
  let throttled = 0;
  let staleGoals = 0;
  let doorInvalidations = 0;
  let nodesExpanded = 0;
  let maxNodesExpanded = 0;

  const stateFor = (guardId: string): GuardNav => {
    const existing = guards.get(guardId);
    if (existing !== undefined) return existing;
    const created: GuardNav = {
      lastRequestTick: Number.NEGATIVE_INFINITY,
      result: null,
      requestedGoal: null,
      doorsOnPath: [],
      claim: null,
      world: null,
    };
    guards.set(guardId, created);
    return created;
  };

  /** Whether any other guard already holds this cell. */
  const heldByAnother = (guardId: string, cell: Cell): boolean => {
    for (const [id, state] of guards) {
      if (id === guardId) continue;
      if (sameCell(state.claim, cell)) return true;
    }
    return false;
  };

  /** The cell this guard will actually path to: the one asked for when it is
   *  passable and free, else the nearest passable unclaimed cell to it. Null
   *  when the neighbourhood is full or solid, which is reported as unreachable
   *  rather than as a guard standing on a wall (T017). */
  const claimFor = (guardId: string, goal: Cell, doors: OpenState): Cell | null => {
    const state = stateFor(guardId);
    state.claim = null;
    for (const offset of CLAIM_OFFSETS) {
      const candidate = { x: goal.x + offset.x, z: goal.z + offset.z };
      if (isTileBlocking(grid, candidate.x, candidate.z, doors)) continue;
      if (heldByAnother(guardId, candidate)) continue;
      state.claim = candidate;
      return candidate;
    }
    return null;
  };

  /** The door and secret tiles a found path crosses that are open right now — the
   *  exact set whose closing must invalidate it. */
  const doorsOn = (result: PathResult, doors: OpenState): string[] => {
    if ('unreachable' in result) return [];
    const keys: string[] = [];
    for (const cell of result.cells) {
      const tile = grid[cell.z]?.[cell.x];
      if (tile !== 'D' && tile !== 'S') continue;
      const key = tileKey(cell.x, cell.z);
      if (doors.has(key)) keys.push(key);
    }
    return keys;
  };

  const search = (guardId: string, from: Cell, goal: Cell, doors: OpenState): PathResult => {
    const state = stateFor(guardId);
    const claim = claimFor(guardId, goal, doors);
    const result: PathResult =
      claim === null
        ? { unreachable: true, nodesExpanded: 0 }
        : findPath(grid, doors, from, claim, maxNodeExpansions);

    searches += 1;
    nodesExpanded += result.nodesExpanded;
    maxNodesExpanded = Math.max(maxNodesExpanded, result.nodesExpanded);
    state.lastRequestTick = tick;
    state.requestedGoal = { x: goal.x, z: goal.z };
    state.result = result;
    state.doorsOnPath = doorsOn(result, doors);
    return result;
  };

  const requestPath = (guardId: string, from: Cell, goal: Cell): PathResult => {
    const state = stateFor(guardId);
    const doors = readDoors();

    // The player moved cell — or teleported. The held path leads to the old one
    // and is dropped now rather than walked to (Edge Cases).
    const stale = state.requestedGoal !== null && !sameCell(state.requestedGoal, goal);
    // A door the held path traverses has shut under it: the next path must
    // exclude that tile, and must be computed on this tick (Edge Cases).
    const shut = state.doorsOnPath.some((key) => !doors.has(key));

    if (state.result !== null && !stale && !shut && tick - state.lastRequestTick < intervalTicks) {
      throttled += 1;
      return state.result;
    }
    if (stale) staleGoals += 1;
    if (shut) doorInvalidations += 1;
    return search(guardId, from, goal, doors);
  };

  return {
    beginTick(next: number): void {
      tick = next;
    },

    worldFor(guardId: string): GuardWorld {
      const state = stateFor(guardId);
      if (state.world !== null) return state.world;
      const world: GuardWorld = {
        hasLineOfSight: (a: Point, b: Point): boolean =>
          hasLineOfSight(grid, readDoors(), a, b),
        findPath: (from: Cell, to: Cell): PathResult => requestPath(guardId, from, to),
      };
      state.world = world;
      return world;
    },

    claimedCell(guardId: string): Cell | null {
      return guards.get(guardId)?.claim ?? null;
    },

    releaseGuard(guardId: string): void {
      guards.delete(guardId);
    },

    report(): NavReport {
      let claims = 0;
      for (const state of guards.values()) if (state.claim !== null) claims += 1;
      return {
        intervalTicks,
        maxNodeExpansions,
        searches,
        throttled,
        staleGoals,
        doorInvalidations,
        nodesExpanded,
        maxNodesExpanded,
        claims,
      };
    },
  };
}
