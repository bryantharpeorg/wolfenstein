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
// The blocking verdict is `./los`'s and not a second opinion: sight and the
// bullet stop at the same cells because they are the same walk. What a shot
// needs beyond a boolean is *where* the ray died, which `./los` leaves in
// `lastBlock` for `lastHit` below to turn into a distance.

import type { OpenState } from '../player/tiles';
import { damageAtDistance } from './falloff';
import { hasLineOfSight, lastBlock } from './los';
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

/** Where the ray died, derived from the walk `./los` just refused: the same
 *  traversal, the same corner rule, the same cap, and one definition of what
 *  blocks. The endpoints are exempt, as they are for sight. */
function lastHit(from: Point, to: Point): RayHit {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  return { cell: { x: lastBlock.x, z: lastBlock.z }, distance: lastBlock.fraction * length };
}

/** The first blocking cell along `from` -> `to`, or `null` when it is clear. */
export function firstBlockingHit(
  grid: string[],
  doorStates: OpenState,
  from: Point,
  to: Point,
): RayHit | null {
  return hasLineOfSight(grid, doorStates, from, to) ? null : lastHit(from, to);
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

  const hit = lastHit(origin, playerPos);
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
