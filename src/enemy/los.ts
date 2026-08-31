// `hasLineOfSight`: can a guard at `a` see the point `b`? A cell-stepping DDA
// over the level grid, honouring 004's open-tile state (FR-005, US2-S5..S8).
// Pure: no DOM, no three.js (FR-001).
//
// Two properties are load-bearing and are asserted rather than assumed. It
// *allocates nothing* — only numbers on the stack, so ten guards asking every
// frame cost no garbage (US2-S8). And it is *bounded*: the walk gives up after
// `MAX_LOS_STEPS` cells, so no map can make sight hang a frame.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import type { Point } from './guard';

/** The declared step cap. 64x64 spans at most ~128 cells, so this is slack. */
export const MAX_LOS_STEPS = 512;

/** How close two boundary crossings must be to count as the same corner, as a
 *  fraction of the whole segment: far below any real gap, far above rounding. */
export const LOS_CORNER_EPSILON = 1e-9;

/** Where the last refused walk died: the cell that stopped it and how far along
 *  the segment that was, as a fraction of its length. Module scope so the walk
 *  still allocates nothing per call (US2-S8); `./attack` reads it immediately
 *  after the call that wrote it, to report a shot's termination distance. */
export const lastBlock = { x: 0, z: 0, fraction: 0 };

function blockedAt(x: number, z: number, fraction: number): false {
  lastBlock.x = x;
  lastBlock.z = z;
  lastBlock.fraction = fraction;
  return false;
}

/**
 * Whether `b` is visible from `a` through `grid`, given the tiles `doorStates`
 * marks open. Endpoints are exempt: a guard standing in a doorway can see out of
 * it, and a player standing in one can be seen. Two refusals the spec names: any
 * wall or closed door strictly between them (US2-S6), and a diagonal corner
 * whose two orthogonal neighbours both block (US2-S7). A refusal leaves the cell
 * that stopped it in `lastBlock`, which is the whole of what `./attack` needs a
 * ray for beyond this answer.
 */
export function hasLineOfSight(
  grid: string[],
  doorStates: OpenState,
  a: Point,
  b: Point,
): boolean {
  let x = Math.floor(a.x);
  let z = Math.floor(a.z);
  const goalX = Math.floor(b.x);
  const goalZ = Math.floor(b.z);
  if (x === goalX && z === goalZ) return true;

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Segment fractions: `deltaX` is what one whole cell of X costs, `nextX` how
  // much of the segment is left before the next X boundary.
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let nextX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - a.x : a.x - x) * deltaX;
  let nextZ = stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - a.z : a.z - z) * deltaZ;

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
      // Threading a corner: it may be passed only if one of the two flanking
      // cells is open; two walls close it (US2-S7).
      travelled = nextX;
      if (
        isTileBlocking(grid, x + stepX, z, doorStates) &&
        isTileBlocking(grid, x, z + stepZ, doorStates)
      ) {
        return blockedAt(x + stepX, z + stepZ, nextX);
      }
      x += stepX;
      z += stepZ;
      nextX += deltaX;
      nextZ += deltaZ;
    }
    if (x === goalX && z === goalZ) return true;
    if (isTileBlocking(grid, x, z, doorStates)) return blockedAt(x, z, travelled);
  }
  // Past the cap: refused rather than pursued, so the walk is O(1)-bounded.
  return blockedAt(x, z, 1);
}
