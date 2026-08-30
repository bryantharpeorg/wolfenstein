// The collision resolver: a capsule footprint of radius 0.3 resolved as an
// axis-aligned box swept against the grid, per axis, in a single call of any
// magnitude (FR-005, FR-006). Pure: no three.js, no DOM, grid as an argument.
//
// resolveMove(grid, position, displacement, openState) -> { position, blockedAxes, stuck }
//   - sweeps the AABB along x then z, stopping flush at a solid boundary within
//     BOUNDARY_EPSILON, sliding on the free axis in a corner (US2-S4);
//   - reports per-axis blocked flags (FR-008, US2-S8);
//   - depenetrates a start inside solid along the axis of least penetration,
//     setting `stuck` rather than throwing (FR-009, US2-S7).

import { COLLIDER_RADIUS } from './params';
import { isTileBlocking, isCircleWalkable, BOUNDARY_EPSILON, type OpenState } from './tiles';

const R = COLLIDER_RADIUS;

export interface Vec2 {
  x: number;
  z: number;
}

export interface BlockedAxes {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

export interface ResolveResult {
  position: Vec2;
  blockedAxes: BlockedAxes;
  stuck: boolean;
}

/** Whether tile (tx, tz) overlaps the AABB's z-range by more than epsilon. */
function overlapsZ(z: number, tz: number): boolean {
  return tz < z + R - BOUNDARY_EPSILON && tz + 1 > z - R + BOUNDARY_EPSILON;
}

/** Whether tile (tx, tz) overlaps the AABB's x-range by more than epsilon. */
function overlapsX(x: number, tx: number): boolean {
  return tx < x + R - BOUNDARY_EPSILON && tx + 1 > x - R + BOUNDARY_EPSILON;
}

function sweepEast(
  grid: string[],
  x: number,
  z: number,
  dx: number,
  openState: OpenState,
): { x: number; blocked: boolean } {
  const target = x + dx;
  const leading = target + R;
  let maxLeading = leading;
  const startTx = Math.floor(x + R - BOUNDARY_EPSILON) + 1;
  const endTx = Math.floor(leading);
  const minTz = Math.floor(z - R);
  const maxTz = Math.floor(z + R);
  for (let tz = minTz; tz <= maxTz; tz += 1) {
    if (!overlapsZ(z, tz)) continue;
    for (let tx = startTx; tx <= endTx; tx += 1) {
      if (isTileBlocking(grid, tx, tz, openState) && tx < maxLeading) {
        maxLeading = tx;
      }
    }
  }
  const newX = maxLeading - R;
  return { x: newX, blocked: newX < target - BOUNDARY_EPSILON };
}

function sweepWest(
  grid: string[],
  x: number,
  z: number,
  dx: number,
  openState: OpenState,
): { x: number; blocked: boolean } {
  const target = x + dx;
  const leading = target - R;
  let minLeading = leading;
  const startTx = Math.floor(x - R) - 1;
  const endTx = Math.floor(leading);
  const minTz = Math.floor(z - R);
  const maxTz = Math.floor(z + R);
  for (let tz = minTz; tz <= maxTz; tz += 1) {
    if (!overlapsZ(z, tz)) continue;
    for (let tx = endTx; tx <= startTx; tx += 1) {
      if (isTileBlocking(grid, tx, tz, openState) && tx + 1 > minLeading) {
        minLeading = tx + 1;
      }
    }
  }
  const newX = minLeading + R;
  return { x: newX, blocked: newX > target + BOUNDARY_EPSILON };
}

function sweepSouth(
  grid: string[],
  x: number,
  z: number,
  dz: number,
  openState: OpenState,
): { z: number; blocked: boolean } {
  const target = z + dz;
  const leading = target + R;
  let maxLeading = leading;
  const startTz = Math.floor(z + R - BOUNDARY_EPSILON) + 1;
  const endTz = Math.floor(leading);
  const minTx = Math.floor(x - R);
  const maxTx = Math.floor(x + R);
  for (let tx = minTx; tx <= maxTx; tx += 1) {
    if (!overlapsX(x, tx)) continue;
    for (let tz = startTz; tz <= endTz; tz += 1) {
      if (isTileBlocking(grid, tx, tz, openState) && tz < maxLeading) {
        maxLeading = tz;
      }
    }
  }
  const newZ = maxLeading - R;
  return { z: newZ, blocked: newZ < target - BOUNDARY_EPSILON };
}

function sweepNorth(
  grid: string[],
  x: number,
  z: number,
  dz: number,
  openState: OpenState,
): { z: number; blocked: boolean } {
  const target = z + dz;
  const leading = target - R;
  let minLeading = leading;
  const startTz = Math.floor(z - R) - 1;
  const endTz = Math.floor(leading);
  const minTx = Math.floor(x - R);
  const maxTx = Math.floor(x + R);
  for (let tx = minTx; tx <= maxTx; tx += 1) {
    if (!overlapsX(x, tx)) continue;
    for (let tz = endTz; tz <= startTz; tz += 1) {
      if (isTileBlocking(grid, tx, tz, openState) && tz + 1 > minLeading) {
        minLeading = tz + 1;
      }
    }
  }
  const newZ = minLeading + R;
  return { z: newZ, blocked: newZ > target + BOUNDARY_EPSILON };
}

/**
 * Pushes a position whose AABB overlaps solid tiles out to the nearest walkable
 * position along the axis of least penetration (FR-009).
 */
function depenetrate(
  grid: string[],
  x: number,
  z: number,
  openState: OpenState,
): Vec2 {
  const minTx = Math.floor(x - R);
  const maxTx = Math.floor(x + R);
  const minTz = Math.floor(z - R);
  const maxTz = Math.floor(z + R);

  let minSolidTx = Number.POSITIVE_INFINITY;
  let maxSolidTx = Number.NEGATIVE_INFINITY;
  let minSolidTz = Number.POSITIVE_INFINITY;
  let maxSolidTz = Number.NEGATIVE_INFINITY;
  let found = false;

  for (let tz = minTz; tz <= maxTz; tz += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!isTileBlocking(grid, tx, tz, openState)) continue;
      if (!overlapsX(x, tx) || !overlapsZ(z, tz)) continue;
      found = true;
      if (tx < minSolidTx) minSolidTx = tx;
      if (tx > maxSolidTx) maxSolidTx = tx;
      if (tz < minSolidTz) minSolidTz = tz;
      if (tz > maxSolidTz) maxSolidTz = tz;
    }
  }

  if (!found) return { x, z };

  const leftClear = x + R - minSolidTx;
  const rightClear = maxSolidTx + 1 - (x - R);
  const xPen = Math.min(leftClear, rightClear);

  const topClear = z + R - minSolidTz;
  const bottomClear = maxSolidTz + 1 - (z - R);
  const zPen = Math.min(topClear, bottomClear);

  if (xPen <= zPen) {
    if (leftClear <= rightClear) return { x: minSolidTx - R, z };
    return { x: maxSolidTx + 1 + R, z };
  }
  if (topClear <= bottomClear) return { x, z: minSolidTz - R };
  return { x, z: maxSolidTz + 1 + R };
}

export function resolveMove(
  grid: string[],
  position: Vec2,
  displacement: Vec2,
  openState: OpenState,
): ResolveResult {
  let x = position.x;
  let z = position.z;
  let stuck = false;

  if (!isCircleWalkable(grid, x, z, R, openState)) {
    const dep = depenetrate(grid, x, z, openState);
    x = dep.x;
    z = dep.z;
    stuck = true;
  }

  const dx = displacement.x;
  const dz = displacement.z;
  let blockedE = false;
  let blockedW = false;
  let blockedN = false;
  let blockedS = false;

  if (dx > 0) {
    const res = sweepEast(grid, x, z, dx, openState);
    x = res.x;
    blockedE = res.blocked;
  } else if (dx < 0) {
    const res = sweepWest(grid, x, z, dx, openState);
    x = res.x;
    blockedW = res.blocked;
  }

  if (dz > 0) {
    const res = sweepSouth(grid, x, z, dz, openState);
    z = res.z;
    blockedS = res.blocked;
  } else if (dz < 0) {
    const res = sweepNorth(grid, x, z, dz, openState);
    z = res.z;
    blockedN = res.blocked;
  }

  return {
    position: { x, z },
    blockedAxes: { n: blockedN, s: blockedS, e: blockedE, w: blockedW },
    stuck,
  };
}
