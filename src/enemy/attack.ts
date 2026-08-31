// `resolveShot`: one guard's hitscan attack, resolved (FR-007). Pure: no DOM, no
// three.js (FR-001).
//
// A shot is a ray from the guard to the player. It terminates at the first
// blocking cell — a wall, or a door not currently open — and when it does it
// reports `blocked`, the distance along the ray at which it died, and zero
// damage. Otherwise it pays out `damageAtDistance` for the distance it actually
// measured; there is no damage literal in this file, and the test reads the
// source back to keep it that way (FR-008).
//
// The blocking verdict is `./los`'s `hasLineOfSight` and not a second opinion:
// one definition of "can this guard see that", shared by the state machine and
// the bullet. What this module adds on top is *where* the ray stopped, which a
// boolean cannot carry — so `firstBlockingHit` walks the same DDA to find it,
// and `enemy-attack.test.ts` runs a battery of rays through both to hold them
// together.
//
// "No shot emitted" is a state question, not a geometry one. A wall between
// guard and player makes a shot `blocked`; not being in `attack` at all makes it
// nothing, and `resolveShot` answers `null`. That is US3-S5: a guard behind cover
// never enters `attack`, so no ray is ever cast for it.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import { damageAtDistance } from './falloff';
import { LOS_CORNER_EPSILON, MAX_LOS_STEPS, hasLineOfSight } from './los';
import type { Cell, Guard, Point } from './guard';

/** The state a guard must be in for a ray to be cast at all. */
const FIRING_STATE = 'attack';

export type ShotOutcome = 'hit' | 'blocked';

/** Where a ray died: the cell that stopped it and how far along it that was. */
export interface RayHit {
  readonly cell: Cell;
  /** Distance from the muzzle to the point the ray entered `cell`, in cells. */
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
 * The first cell along the segment `from` -> `to` that blocks, or `null` when the
 * segment is clear. Mirrors `./los`'s traversal exactly — same stepping, same
 * corner rule, same step cap — and allocates only the one result object it
 * returns, on the cold path where a shot was actually stopped.
 *
 * The endpoints are exempt, as they are for sight: a guard firing from a doorway
 * is not blocked by the doorway it stands in, and a player standing in one is
 * still hittable.
 */
export function firstBlockingHit(
  grid: string[],
  doorStates: OpenState,
  from: Point,
  to: Point,
): RayHit | null {
  let x = Math.floor(from.x);
  let z = Math.floor(from.z);
  const goalX = Math.floor(to.x);
  const goalZ = Math.floor(to.z);
  if (x === goalX && z === goalZ) return null;

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Segment fractions, as in `./los`: `delta` is a whole cell's worth of the
  // segment, `next` how much of the segment is left before the next boundary.
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let nextX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - from.x : from.x - x) * deltaX;
  let nextZ = stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - from.z : from.z - z) * deltaZ;

  for (let steps = 0; steps < MAX_LOS_STEPS; steps += 1) {
    const lead = nextX - nextZ;
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
      // Threading a corner: two blocking flanks close it, one open flank lets the
      // bullet by, exactly as they do sight (US2-S7).
      travelled = nextX;
      if (
        isTileBlocking(grid, x + stepX, z, doorStates) &&
        isTileBlocking(grid, x, z + stepZ, doorStates)
      ) {
        return { cell: { x: x + stepX, z: z + stepZ }, distance: travelled * length };
      }
      x += stepX;
      z += stepZ;
      nextX += deltaX;
      nextZ += deltaZ;
    }
    if (x === goalX && z === goalZ) return null;
    if (isTileBlocking(grid, x, z, doorStates)) {
      return { cell: { x, z }, distance: travelled * length };
    }
  }
  // Past the cap the ray is declared spent where it stands, rather than pursued.
  return { cell: { x, z }, distance: length };
}

/**
 * One guard's shot at `playerPos`, or `null` when this guard emits none.
 *
 * `null` is the answer for every state but `attack` — including `death`, so a
 * guard killed mid-wind-up never fires (US1-S7). A guard that *is* in `attack`
 * always produces a `Shot`; whether it lands is the ray's business.
 */
export function resolveShot(
  guard: Guard,
  playerPos: Point,
  grid: string[],
  doorStates: OpenState,
): Shot | null {
  if (guard.state !== FIRING_STATE) return null;

  const origin: Point = { x: guard.x, z: guard.z };
  const distance = Math.hypot(playerPos.x - origin.x, playerPos.z - origin.z);

  if (hasLineOfSight(grid, doorStates, origin, playerPos)) {
    return {
      guardId: guard.id,
      outcome: 'hit',
      damage: damageAtDistance(distance),
      distance,
      blockedAt: null,
    };
  }

  const hit = firstBlockingHit(grid, doorStates, origin, playerPos);
  return {
    guardId: guard.id,
    outcome: 'blocked',
    damage: 0,
    distance: hit === null ? distance : hit.distance,
    blockedAt: hit === null ? null : hit.cell,
  };
}

/**
 * Every shot emitted by `guards` on one tick, in the order they were given.
 * Guards that emit nothing are dropped rather than reported as a zero shot, and
 * each shot is resolved from its own guard's position — which is US3-S8: two
 * guards firing together at different ranges deal different damage.
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
