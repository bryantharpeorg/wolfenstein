// `resolveShot`: one guard's hitscan attack, resolved (FR-007). Pure: no DOM,
// no three.js (FR-001).
//
// A shot is a ray from the guard to the player. It terminates at the first
// blocking cell — a wall, or a door not currently open — and then reports
// `blocked`, the distance along the ray at which it died, and zero damage.
// Otherwise it pays out `damageAtDistance` for the distance it measured; there
// is no damage literal in this file, and the test reads the source back to keep
// it that way (FR-008).
//
// The walk below is this module's own, because a shot needs something sight
// does not: *where* the ray died, to report a termination distance. It steps
// the same cells `./los` does, under the same corner rule and the same cap, so
// bullet and sight stop together — a property `enemy-attack.test.ts` asserts
// against `hasLineOfSight` directly rather than leaving it to comment.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import { damageAtDistance } from './falloff';
import { MAX_LOS_STEPS, LOS_CORNER_EPSILON } from './los';
import type { Cell, Guard, Point } from './guard';

/** The state a guard must be in for a ray to be cast at all. */
const FIRING_STATE = 'attack';

export type ShotOutcome = 'hit' | 'blocked';

/** Where a ray died: the cell that stopped it and how far along it that was. */
export interface RayHit {
  readonly cell: Cell;
  readonly distance: number;
}

/** One resolved shot. `distance` is the whole flight on a hit and the truncated
 *  flight when blocked, so it always names where the bullet ended up. */
export interface Shot {
  readonly guardId: string;
  readonly outcome: ShotOutcome;
  /** Zero on a blocked shot, always (FR-007). */
  readonly damage: number;
  readonly distance: number;
  /** The cell that stopped the ray, or null when nothing did. */
  readonly blockedAt: Cell | null;
}

/**
 * The first blocking cell along `from` -> `to`, or `null` when the ray is
 * clear. A cell-stepping DDA carrying its state in locals; the only allocation
 * is the `RayHit` a blocked ray returns, and a clear ray allocates nothing.
 * Endpoints are exempt, as they are for sight: a guard firing from a doorway is
 * not blocked by the doorway it stands in.
 */
export function firstBlockingHit(
  grid: string[],
  doorStates: OpenState,
  from: Point,
  to: Point,
): RayHit | null {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const hit = (x: number, z: number, fraction: number): RayHit => ({
    cell: { x, z },
    distance: fraction * length,
  });

  let x = Math.floor(from.x);
  let z = Math.floor(from.z);
  const goalX = Math.floor(to.x);
  const goalZ = Math.floor(to.z);
  if (x === goalX && z === goalZ) return null;

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Segment fractions: `deltaX` is how much of the ray one whole cell of X
  // costs, `nextX` how much of it is left before the next X boundary.
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let nextX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - from.x : from.x - x) * deltaX;
  let nextZ = stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - from.z : from.z - z) * deltaZ;

  for (let steps = 0; steps < MAX_LOS_STEPS; steps += 1) {
    const lead = nextX - nextZ;
    // How far along the ray the boundary about to be crossed sits.
    let travelled: number;
    if (lead < -LOS_CORNER_EPSILON) {
      travelled = nextX;
      x += stepX;
      nextX += deltaX;
    } else if (lead > LOS_CORNER_EPSILON) {
      travelled = nextZ;
      z += stepZ;
      nextZ += deltaZ;
    } else {
      // Both boundaries at once — the ray is threading a corner, and may pass
      // only if one of the two cells flanking it is open (US2-S7).
      travelled = nextX;
      if (
        isTileBlocking(grid, x + stepX, z, doorStates) &&
        isTileBlocking(grid, x, z + stepZ, doorStates)
      ) {
        return hit(x + stepX, z + stepZ, travelled);
      }
      x += stepX;
      z += stepZ;
      nextX += deltaX;
      nextZ += deltaZ;
    }
    if (x === goalX && z === goalZ) return null;
    if (isTileBlocking(grid, x, z, doorStates)) return hit(x, z, travelled);
  }
  // Past the cap: stopped rather than pursued, so the walk is O(1)-bounded.
  return hit(x, z, 1);
}

/**
 * One guard's shot at `playerPos`, or `null` when this guard emits none. `null`
 * is the answer for every state but `attack` — including `death`, so a guard
 * killed mid-wind-up never fires (US1-S7), and including a guard that never saw
 * the player at all (US3-S5). A guard that *is* in `attack` always produces a
 * `Shot`; whether it lands is the ray's business.
 */
export function resolveShot(
  guard: Guard,
  playerPos: Point,
  grid: string[],
  doorStates: OpenState,
): Shot | null {
  if (guard.state !== FIRING_STATE) return null;

  const origin: Point = { x: guard.x, z: guard.z };
  const hit = firstBlockingHit(grid, doorStates, origin, playerPos);

  if (hit === null) {
    // Clear: the whole flight is paid out at the curve's value for it (FR-008).
    const distance = Math.hypot(playerPos.x - origin.x, playerPos.z - origin.z);
    return {
      guardId: guard.id,
      outcome: 'hit',
      damage: damageAtDistance(distance),
      distance,
      blockedAt: null,
    };
  }

  return {
    guardId: guard.id,
    outcome: 'blocked',
    damage: 0,
    distance: hit.distance,
    blockedAt: hit.cell,
  };
}

/**
 * Every shot emitted by `guards` on one tick, in the order given. Guards that
 * emit nothing are dropped rather than reported as a zero shot, and each shot is
 * resolved from its own guard's position — which is US3-S8.
 */
export function resolveShots(
  guards: readonly Guard[],
  playerPos: Point,
  grid: string[],
  doorStates: OpenState,
): Shot[] {
  const shots: Shot[] = [];
  for (const guard of guards) {
    const shot = resolveShot(guard, playerPos, grid, doorStates);
    if (shot !== null) shots.push(shot);
  }
  return shots;
}
