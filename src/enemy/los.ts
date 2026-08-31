// `hasLineOfSight`: can a guard standing at `a` see the point `b`? A cell-stepping
// DDA over the level grid, honouring 004's open-tile state (FR-005, US2-S5..S8).
// Pure: no DOM, no three.js (FR-001).
//
// Two properties are load-bearing and are asserted rather than assumed.
//
// *It allocates nothing.* No array, no object, no closure is created per call —
// only numbers on the stack. Ten guards asking every frame must cost no garbage
// (US2-S8), so the traversal carries its state in locals and the blocking test is
// 003's `isTileBlocking`, which takes coordinates rather than a cell object.
//
// *It is bounded.* The walk gives up after `MAX_LOS_STEPS` cells and answers
// `false`. A segment that long cannot occur on a 64x64 grid, so the bound is
// unreachable in play and absolute in principle: no map can make sight hang a
// frame.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import type { Point } from './guard';

/** The declared step cap. 64x64 spans at most ~128 cells, so this is slack. */
export const MAX_LOS_STEPS = 512;

/** How close two boundary crossings must be to count as the same corner. The
 *  units are fractions of the whole segment, so this is far below any real gap
 *  and far above the rounding error of a 45-degree ray between two cell centres. */
export const LOS_CORNER_EPSILON = 1e-9;

/**
 * Whether `b` is visible from `a` through `grid`, given the tiles `doorStates`
 * marks open. Endpoints are exempt: a guard standing in a doorway can see out of
 * it, and a player standing in one can be seen.
 *
 * The two refusals the spec names explicitly:
 *  - any wall, or any door not in `doorStates`, strictly between them (US2-S6);
 *  - a diagonal corner whose two orthogonal neighbours both block, which is the
 *    pinwheel a guard must not shoot through (US2-S7).
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

  // Segment fractions: `deltaX` is how much of the segment one whole cell of X
  // costs, `nextX` how much of it is left before the next X boundary.
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let nextX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - a.x : a.x - x) * deltaX;
  let nextZ = stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - a.z : a.z - z) * deltaZ;

  for (let steps = 0; steps < MAX_LOS_STEPS; steps += 1) {
    const lead = nextX - nextZ;
    if (lead < -LOS_CORNER_EPSILON) {
      x += stepX;
      nextX += deltaX;
    } else if (lead > LOS_CORNER_EPSILON) {
      z += stepZ;
      nextZ += deltaZ;
    } else {
      // The ray crosses both boundaries at once — it is threading a corner. It
      // may only pass if at least one of the two cells flanking that corner is
      // open; two walls close it (US2-S7).
      if (
        isTileBlocking(grid, x + stepX, z, doorStates) &&
        isTileBlocking(grid, x, z + stepZ, doorStates)
      ) {
        return false;
      }
      x += stepX;
      z += stepZ;
      nextX += deltaX;
      nextZ += deltaZ;
    }
    if (x === goalX && z === goalZ) return true;
    if (isTileBlocking(grid, x, z, doorStates)) return false;
  }
  // Past the cap: refused rather than pursued, so the walk is O(1)-bounded.
  return false;
}
