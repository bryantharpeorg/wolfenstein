// The player's hitscan: one ray from the camera centre, resolved (FR-006). Pure
// — no DOM, no three.js — and it reads nothing: grid, door state, guard list,
// range and damage all arrive as arguments (FR-001). The walk is the DDA 006 uses
// for sight, under the same corner rule; what this adds is the comparison of
// first blocking cell against nearest guard cylinder, nearer wins, so a guard in
// front of a wall is a `guard`.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';

/** The four outcomes FR-006 declares; `out-of-ammo` never traces. */
export type ShotOutcome = 'guard' | 'wall' | 'none' | 'out-of-ammo';

/** A position on the grid plane, in cell units. Height is not traced. */
export interface Point {
  readonly x: number;
  readonly z: number;
}

/** A guard as the hitscan sees it. `alive` defaults to true. */
export interface HitscanGuard {
  readonly x: number;
  readonly z: number;
  readonly alive?: boolean;
}

/** A resolved shot (FR-006): never empty, never undefined, all four fields. */
export interface ShotResult {
  readonly outcome: ShotOutcome;
  readonly distance: number; // along the ray, in cells
  readonly guardIndex: number; // into the guard list given, or NO_GUARD
  readonly damage: number; // the weapon's declared damage, or zero
}

/** The `guardIndex` of every result that named no guard. */
export const NO_GUARD = -1;

/** The guard hit box: a cylinder about the guard (Assumptions). */
export const GUARD_HIT_RADIUS = 0.35;

/** The step cap: unreachable on a 64x64 grid, so no map hangs a frame. */
export const MAX_TRACE_STEPS = 512;

/** How close two crossings must be to count as one corner. */
export const TRACE_CORNER_EPSILON = 1e-9;

export interface TraceOptions {
  readonly grid: string[];
  readonly doorStates: OpenState;
  readonly guards: readonly HitscanGuard[];
  readonly origin: Point; // the camera centre, never the view-model
  readonly direction: Point; // need not be unit length; normalised here
  readonly maxRange: number;
  readonly damage: number;
  readonly hitRadius?: number; // defaults to GUARD_HIT_RADIUS
}

/** A fire command refused for ammo (FR-007): no ray traced. */
export function outOfAmmoResult(): ShotResult {
  return { outcome: 'out-of-ammo', distance: 0, guardIndex: NO_GUARD, damage: 0 };
}

/** Where a unit ray meets the first wall or closed door, or `Infinity` within
 *  `maxRange`. The origin's own cell is exempt, as for 006's sight. */
export function firstBlockerDistance(
  grid: string[],
  doorStates: OpenState,
  origin: Point,
  dirX: number,
  dirZ: number,
  maxRange: number,
): number {
  let x = Math.floor(origin.x);
  let z = Math.floor(origin.z);
  const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
  const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;
  if (stepX === 0 && stepZ === 0) return Infinity;

  // `delta*` is what a whole cell of that axis costs, `next*` what is left.
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dirZ);
  let nextX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - origin.x : origin.x - x) * deltaX;
  let nextZ = stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ;

  for (let steps = 0; steps < MAX_TRACE_STEPS; steps += 1) {
    const lead = nextX - nextZ;
    const corner = Math.abs(lead) <= TRACE_CORNER_EPSILON;
    const travelled = corner || lead < 0 ? nextX : nextZ;
    if (!(travelled <= maxRange)) return Infinity;

    if (corner) {
      // Threading a corner: passes only if a flanking cell is open.
      if (
        isTileBlocking(grid, x + stepX, z, doorStates) &&
        isTileBlocking(grid, x, z + stepZ, doorStates)
      ) {
        return travelled;
      }
      x += stepX;
      z += stepZ;
      nextX += deltaX;
      nextZ += deltaZ;
    } else if (lead < 0) {
      x += stepX;
      nextX += deltaX;
    } else {
      z += stepZ;
      nextZ += deltaZ;
    }

    if (isTileBlocking(grid, x, z, doorStates)) return travelled;
  }
  return Infinity;
}

/** Where a unit ray enters a guard's cylinder, or `Infinity` on a miss. */
function guardEntryDistance(
  guard: HitscanGuard,
  origin: Point,
  dirX: number,
  dirZ: number,
  radius: number,
): number {
  const offsetX = guard.x - origin.x;
  const offsetZ = guard.z - origin.z;
  const along = offsetX * dirX + offsetZ * dirZ;
  const perpendicularSq = offsetX * offsetX + offsetZ * offsetZ - along * along;
  const radiusSq = radius * radius;
  if (perpendicularSq > radiusSq) return Infinity;

  const half = Math.sqrt(Math.max(0, radiusSq - perpendicularSq));
  if (along + half < 0) return Infinity; // wholly behind the camera
  return Math.max(0, along - half); // a camera inside it is point blank, not behind
}

/** One shot, resolved (FR-006): exactly one of `guard`, `wall` or `none` —
 *  `out-of-ammo` belongs to the fire command — with the distance and the damage
 *  applied. The ray never penetrates past the first blocker. */
export function traceShot(options: TraceOptions): ShotResult {
  const { grid, doorStates, guards, origin, direction, maxRange, damage } = options;
  const length = Math.hypot(direction.x, direction.z);
  if (!(length > 0) || !(maxRange > 0)) {
    return { outcome: 'none', distance: 0, guardIndex: NO_GUARD, damage: 0 };
  }
  const dirX = direction.x / length;
  const dirZ = direction.z / length;
  const radius = options.hitRadius ?? GUARD_HIT_RADIUS;

  let nearestGuard = Infinity;
  let guardIndex = NO_GUARD;
  for (let index = 0; index < guards.length; index += 1) {
    const guard = guards[index]!;
    if (guard.alive === false) continue;
    const entry = guardEntryDistance(guard, origin, dirX, dirZ, radius);
    if (entry < nearestGuard) {
      nearestGuard = entry;
      guardIndex = index;
    }
  }

  const wall = firstBlockerDistance(grid, doorStates, origin, dirX, dirZ, maxRange);

  if (guardIndex !== NO_GUARD && nearestGuard <= maxRange && nearestGuard <= wall) {
    return { outcome: 'guard', distance: nearestGuard, guardIndex, damage };
  }
  if (wall <= maxRange) {
    return { outcome: 'wall', distance: wall, guardIndex: NO_GUARD, damage: 0 };
  }
  return { outcome: 'none', distance: maxRange, guardIndex: NO_GUARD, damage: 0 };
}
