// The live guard world: the records the running page holds and the tick that
// drives them (FR-006, FR-007, FR-011). Pure: no DOM, no three.js (FR-001), so
// the whole of the guards' behaviour is asserted under `npm run test` and the
// system in `src/systems/enemies/` is left with nothing but plumbing.
//
// The tick is fixed-step and *bounded*. Guard AI runs at `GUARD_TICK_MS`, and a
// frame that arrives late pays back at most `MAX_TICKS_PER_FRAME` steps before
// the rest of the backlog is dropped. That is the spec's negative goal stated as
// a constant: a stalled tab cannot come back and run four hundred ticks of A* in
// one frame, so a guard can never stall a frame.
//
// Two fields are held on the record rather than on the `Guard` the state machine
// returns, because neither belongs to one tick.
//
// `viewAngle` is declared here, initialised to zero, and written by US4's
// billboard system through `setViewAngle` — US3 cannot compute a bearing because
// there is no camera in a pure module, and US4 must not have to open this file to
// add one. The shared thing between the two stories is a data field, not a source
// file.
//
// `pathable` is the answer to "has this guard been told its route is impossible",
// which outlives the tick that asked. A guard whose chase path comes back
// unreachable is put back to `idle` on that same tick instead of being left
// standing in `chase` with an empty path, and stays reported unpathable until a
// later request actually returns a route (US4-S6, Edge Cases).

import { ENEMY_SPAWNS, LEVEL_GRID } from '../level';
import type { TileCoord } from '../level';
import { openTiles } from '../interaction/open-state';
import { getPlayerState } from '../player/state';
import type { OpenState } from '../player/tiles';
import { resolveShot } from './attack';
import type { Shot } from './attack';
import { createNavigator } from './nav';
import type { Navigator } from './nav';
import { spawnGuards } from './spawn';
import { stepGuard } from './step';
import type { Cell, Guard, Point } from './step';
import type { GuardState } from './states';
import { createRng } from './rng';
import type { Rng } from './rng';

/** The guard AI's fixed step. 20 Hz: fast enough that a chase reads as pursuit,
 *  slow enough that ten guards' pathing is a rounding error on a 60 Hz frame. */
export const GUARD_TICK_MS = 50;

/** The most steps one frame may pay back. Past this the backlog is dropped. */
export const MAX_TICKS_PER_FRAME = 4;

/** The seed each guard's own generator is derived from, so a run repeats. */
export const GUARD_WORLD_SEED = 0x77726c64;

/** One live guard. `guard` is US1's immutable record, replaced each tick; the
 *  rest is what the world keeps *about* it across ticks. */
export interface GuardRecord {
  readonly id: string;
  guard: Guard;
  readonly rng: Rng;
  /** 0..7 sprite bearing. Zero here; written each frame by US4 (US4-S6). */
  viewAngle: number;
  /** False once a path request came back unreachable, until one succeeds. */
  pathable: boolean;
  cell: Cell;
  health: number;
  state: GuardState;
}

/** The per-guard shape the page publishes as `__diag.enemies` (FR-011). */
export interface EnemyDiagnosticsRecord {
  state: GuardState;
  viewAngle: number;
  pathable: boolean;
}

/** What one call to `tickWorld` did. */
export interface TickReport {
  /** Fixed steps actually run, never more than `MAX_TICKS_PER_FRAME`. */
  readonly ticks: number;
  /** Every shot emitted across those steps, in guard order within each. */
  readonly shots: readonly Shot[];
  /** The damage those shots dealt, for whichever spec owns player health. */
  readonly damageToPlayer: number;
}

export interface EnemyWorldOptions {
  readonly grid?: string[];
  readonly markers?: readonly TileCoord[];
  /** Where the player is, in cell units. Read once per step. */
  readonly playerPos?: () => Point;
  /** The live open-tile set, re-read per step so a door counts at once. */
  readonly doorStates?: () => OpenState;
  /** The navigation port. Defaults to US2's, bound to the level. */
  readonly nav?: Navigator;
  readonly seed?: number;
}

export interface EnemyWorld {
  readonly records: readonly GuardRecord[];
  /** The named marker faults from spawn, verbatim (FR-006, US3-S7). */
  readonly spawnErrors: readonly string[];
  /** Advances the world by `deltaMs` of real time, in whole fixed steps. */
  tickWorld(deltaMs: number): TickReport;
  /** Records whose state is not `death` (FR-011). */
  enemiesAlive(): number;
  /** The stable array published as `__diag.enemies`; the same one every call. */
  enemyDiagnostics(): readonly EnemyDiagnosticsRecord[];
  /** US4's write-back: sets the bearing on the record and its diagnostics entry. */
  setViewAngle(id: string, viewAngle: number): void;
  /** Damage delivered to one guard, applied on the next step (US1-S7). */
  damageGuardById(id: string, amount: number): void;
}

/**
 * Returns a guard to `idle`, applying the same entry effects `step.ts` does for
 * that state. It is duplicated here rather than imported because `onEnter` is
 * private to US1's file and this story does not open it; the fields are the four
 * that make an idle guard idle, and `enemy-world.test.ts` pins the behaviour.
 */
function returnToIdle(guard: Guard, tick: number): Guard {
  if (guard.state === 'idle' || guard.state === 'death') return guard;
  return {
    ...guard,
    state: 'idle',
    stateEnteredTick: tick,
    ticksInState: 0,
    patrolHeading: guard.facing,
    path: [],
    pathGoal: null,
    pathable: true,
  };
}

function defaultPlayerPos(): Point {
  const state = getPlayerState();
  return { x: state.x, z: state.z };
}

export function createEnemyWorld(options: EnemyWorldOptions = {}): EnemyWorld {
  const grid = options.grid ?? LEVEL_GRID;
  const markers = options.markers ?? ENEMY_SPAWNS;
  const readPlayer = options.playerPos ?? defaultPlayerPos;
  const readDoors = options.doorStates ?? openTiles;
  const seed = options.seed ?? GUARD_WORLD_SEED;
  const nav = options.nav ?? createNavigator({ grid, doorStates: readDoors });

  const spawned = spawnGuards({ grid, markers });
  const records: GuardRecord[] = spawned.guards.map((guard, index) => ({
    id: guard.id,
    guard,
    // One generator per guard, derived from one seed: two guards never share a
    // stream, and the whole world still repeats from a single number.
    rng: createRng(seed + index * 0x9e3779b9),
    viewAngle: 0,
    pathable: true,
    cell: { x: Math.floor(guard.x), z: Math.floor(guard.z) },
    health: guard.health,
    state: guard.state,
  }));

  // Allocated once and mutated in place: `__diag.enemies` is read every frame by
  // the smoke harness and must not mint an array per frame to be read.
  const diagnostics: EnemyDiagnosticsRecord[] = records.map((record) => ({
    state: record.state,
    viewAngle: record.viewAngle,
    pathable: record.pathable,
  }));

  const pendingDamage = new Map<string, number>();
  let accumulatorMs = 0;
  let tick = -1;

  const stepOnce = (shots: Shot[]): number => {
    tick += 1;
    nav.beginTick(tick);
    const playerPos = readPlayer();
    const doorStates = readDoors();
    let damageToPlayer = 0;

    records.forEach((record, index) => {
      if (record.state === 'death') return;

      const before = record.guard;
      const damage = pendingDamage.get(record.id);
      if (damage !== undefined) pendingDamage.delete(record.id);

      const stepped = stepGuard(before, {
        tick,
        rng: record.rng,
        grid,
        doorStates,
        playerPos,
        world: nav.worldFor(record.id),
        damage,
      });

      // The shot is resolved from the guard as it fired, before any correction
      // below moves it: `shotsFired` rising is the emission (FR-007).
      if (stepped.shotsFired > before.shotsFired) {
        const shot = resolveShot(stepped, playerPos, grid, doorStates);
        if (shot !== null) {
          shots.push(shot);
          damageToPlayer += shot.damage;
        }
      }

      let next = stepped;
      if (!stepped.pathable) {
        record.pathable = false;
        next = returnToIdle(stepped, tick);
      } else if (stepped.state === 'chase' && stepped.path.length > 0) {
        record.pathable = true;
      }

      record.guard = next;
      record.state = next.state;
      record.health = next.health;
      record.cell = { x: Math.floor(next.x), z: Math.floor(next.z) };
      if (next.state === 'death') nav.releaseGuard(record.id);

      const entry = diagnostics[index]!;
      entry.state = record.state;
      entry.pathable = record.pathable;
    });

    return damageToPlayer;
  };

  return {
    records,
    spawnErrors: spawned.errors,

    tickWorld(deltaMs: number): TickReport {
      if (Number.isFinite(deltaMs) && deltaMs > 0) accumulatorMs += deltaMs;

      const shots: Shot[] = [];
      let ticks = 0;
      let damageToPlayer = 0;
      while (accumulatorMs >= GUARD_TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
        accumulatorMs -= GUARD_TICK_MS;
        ticks += 1;
        damageToPlayer += stepOnce(shots);
      }
      // Whatever is left over past one whole step is a backlog this frame chose
      // not to pay: it is dropped rather than carried, so the cap is a real cap.
      if (accumulatorMs >= GUARD_TICK_MS) accumulatorMs = 0;

      return { ticks, shots, damageToPlayer };
    },

    enemiesAlive(): number {
      let alive = 0;
      for (const record of records) if (record.state !== 'death') alive += 1;
      return alive;
    },

    enemyDiagnostics(): readonly EnemyDiagnosticsRecord[] {
      return diagnostics;
    },

    setViewAngle(id: string, viewAngle: number): void {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return;
      records[index]!.viewAngle = viewAngle;
      diagnostics[index]!.viewAngle = viewAngle;
    },

    damageGuardById(id: string, amount: number): void {
      pendingDamage.set(id, (pendingDamage.get(id) ?? 0) + amount);
    },
  };
}
