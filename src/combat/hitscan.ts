// The player's hitscan: one ray from the camera centre, resolved (FR-006). Pure —
// no DOM, no three.js (FR-001) — and it reads nothing: the level grid, the door
// state, the guard list, the range and the damage all arrive as arguments, so a
// test drives it against a three-row fixture and the running page drives it
// against the shipped level through exactly the same call.
//
// The walk is the cell-stepping DDA 006 already uses for sight and for guard
// fire, under the same corner rule: a diagonal whose two flanking cells both
// block is closed, so a bullet and a line of sight die at the same pinwheel. What
// this one adds is the *comparison*. A ray meets two kinds of thing — the first
// blocking cell and the nearest guard cylinder — and the outcome is whichever is
// nearer, which is why a guard standing in front of a wall is a `guard` and never
// a `wall` (Edge Cases), and why nothing is ever hit twice.
//
// There is no damage number and no range number in this file. Both are the
// weapon table's (FR-002), and they arrive as `damage` and `maxRange`.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';

/** The four outcomes FR-006 declares. `out-of-ammo` never traces; it is here
 *  because it is one of the shapes a resolved fire command can take. */
export type ShotOutcome = 'guard' | 'wall' | 'none' | 'out-of-ammo';

/** A position on the grid plane, in cell units. Height is not traced: the level
 *  is a right-angled maze of full-height cells, so a ray's vertical component
 *  cannot change which cell it crosses. */
export interface Point {
  readonly x: number;
  readonly z: number;
}

/** A guard as the hitscan sees it: a position and whether it can still be hit.
 *  `alive` defaults to true, so a caller holding only positions may omit it. */
export interface HitscanGuard {
  readonly x: number;
  readonly z: number;
  readonly alive?: boolean;
}

/** The single return shape of a resolved shot (FR-006): never empty, never
 *  undefined, and always all four fields. */
export interface ShotResult {
  readonly outcome: ShotOutcome;
  /** Distance along the ray, in cells, at which the shot ended. */
  readonly distance: number;
  /** Index into the guard list the trace was given, or `NO_GUARD`. */
  readonly guardIndex: number;
  /** What the shot dealt: the weapon's declared damage, or zero. */
  readonly damage: number;
}

/** The `guardIndex` of every result that named no guard. */
export const NO_GUARD = -1;

/** The declared guard hit box: a cylinder of this radius about the guard's
 *  position (Assumptions — no new collision system). */
export const GUARD_HIT_RADIUS = 0.35;

/** The declared step cap. A 64x64 grid spans at most ~128 cells, so the bound is
 *  unreachable in play and absolute in principle: no map can hang a frame. */
export const MAX_TRACE_STEPS = 512;

/** How close two boundary crossings must be to count as the same corner, in
 *  fractions of a cell — far below any real gap, far above rounding error. */
export const TRACE_CORNER_EPSILON = 1e-9;

export interface TraceOptions {
  readonly grid: string[];
  readonly doorStates: OpenState;
  readonly guards: readonly HitscanGuard[];
  /** The camera centre, in cell units — never the view-model (Clarifications). */
  readonly origin: Point;
  /** Need not be a unit vector; it is normalised here. */
  readonly direction: Point;
  readonly maxRange: number;
  readonly damage: number;
  /** Defaults to `GUARD_HIT_RADIUS`. */
  readonly hitRadius?: number;
}

/** The result of a fire command refused for ammo (FR-007): no ray was traced, so
 *  there is no distance and no guard to name. */
export function outOfAmmoResult(): ShotResult {
  return { outcome: 'out-of-ammo', distance: 0, guardIndex: NO_GUARD, damage: 0 };
}

/**
 * How far along a unit ray the first wall or closed door sits, or `Infinity`
 * when none does within `maxRange`. The origin's own cell is exempt, as it is
 * for 006's sight: a shot fired from a doorway is not blocked by that doorway.
 * Allocates nothing — only numbers on the stack.
 */
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

  // `deltaX` is the distance one whole cell of X costs; `nextX` the distance
  // still to run before the next X boundary.
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
      // Both boundaries at once — the ray is threading a corner, and passes only
      // if one of the two cells flanking it is open.
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
  // Past the cap: refused rather than pursued, so the walk is O(1)-bounded.
  return Infinity;
}

/** How far along a unit ray a guard's hit cylinder begins, or `Infinity` when
 *  the ray misses it or the guard is wholly behind the camera. */
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
  // Wholly behind the camera: the ray leaves the cylinder before it starts.
  if (along + half < 0) return Infinity;
  // A camera inside the cylinder is point blank, at zero rather than at a
  // negative distance.
  return Math.max(0, along - half);
}

/**
 * One shot, resolved (FR-006). Returns exactly one of `guard`, `wall` or `none`
 * — `out-of-ammo` belongs to the fire command, which never gets this far — with
 * the distance along the ray and the damage applied. The ray never penetrates:
 * whichever of the nearest guard and the first blocking cell comes first ends it.
 */
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
