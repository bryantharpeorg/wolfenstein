// Reading the level's guard markers into guard records (FR-006). Pure: no DOM,
// no three.js (FR-001).
//
// One guard per marker, so the live count is the marker count; that count
// asserted between `MIN_GUARDS` and `MAX_GUARDS`; and a marker landing on a wall
// cell *named*, with its coordinates, rather than dropped or thrown (US3-S7).
// Neither fault throws and neither drops a guard: a throw during `setup` would
// tell a reader "something crashed" when the truth is "the marker table
// disagrees with the grid", so faults are returned as strings, published through
// `__diag.enemySpawnErrors`, and it is `tools/smoke-checks/enemies.mjs` that
// fails the gate on them.

import { ENEMY_SPAWNS, LEVEL_GRID } from '../level';
import type { TileCoord } from '../level';
import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import { createGuard } from './guard';
import type { Guard } from './guard';
import { createRng } from './rng';

/** The declared bounds on the live guard count (FR-006). */
export const MIN_GUARDS = 6;
export const MAX_GUARDS = 10;

/** The seed the spawn facings are drawn from, so a run is reproducible. */
export const GUARD_SPAWN_SEED = 0x6e656d79;

/** Markers are checked against the closed level: a guard is placed before any
 *  door opens, so a marker in a doorway is a fault whatever 004 does later. */
const CLOSED: OpenState = new Set<string>();

export interface SpawnOptions {
  /** Defaults to 002's level grid and marker table. */
  readonly grid?: string[];
  readonly markers?: readonly TileCoord[];
  readonly seed?: number;
}

export interface SpawnResult {
  /** One guard per marker, in marker order — including any faulted marker. */
  readonly guards: readonly Guard[];
  /** Named faults, empty when the level is sound. Never thrown (US3-S7). */
  readonly errors: readonly string[];
  readonly markerCount: number;
}

/** The id of the guard spawned from marker `index` — stable across runs, and the
 *  key the navigation throttle and claims are held under. */
export function guardIdFor(index: number): string {
  return `guard-${index}`;
}

/** One guard per marker. Facings are drawn from a seeded generator rather than
 *  left at zero, so the guards do not all stare down -Z at startup. */
export function spawnGuards(options: SpawnOptions = {}): SpawnResult {
  const grid = options.grid ?? LEVEL_GRID;
  const markers = options.markers ?? ENEMY_SPAWNS;
  const rng = createRng(options.seed ?? GUARD_SPAWN_SEED);

  const guards: Guard[] = [];
  const errors: string[] = [];

  markers.forEach((marker, index) => {
    const facing = rng.nextRange(-Math.PI, Math.PI);
    if (isTileBlocking(grid, marker.x, marker.z, CLOSED)) {
      const cell = grid[marker.z]?.[marker.x] ?? 'out of bounds';
      errors.push(
        `enemy spawn marker ${index} at (${marker.x}, ${marker.z}) lies on a wall cell '${cell}'`,
      );
    }
    guards.push(createGuard({ id: guardIdFor(index), x: marker.x + 0.5, z: marker.z + 0.5, facing }));
  });

  if (guards.length < MIN_GUARDS) {
    errors.push(
      `enemy spawn markers: ${guards.length} guards is fewer than the required minimum of ${MIN_GUARDS}`,
    );
  } else if (guards.length > MAX_GUARDS) {
    errors.push(
      `enemy spawn markers: ${guards.length} guards exceeds the permitted maximum of ${MAX_GUARDS}`,
    );
  }

  return { guards, errors, markerCount: markers.length };
}
