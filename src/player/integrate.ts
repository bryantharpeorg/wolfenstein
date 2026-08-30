// Movement integration: clamps the frame delta to the declared maximum, splits
// the resulting displacement into increments of at most SUBSTEP_SIZE, and calls
// resolveMove once per substep (FR-006, FR-010). Pure: no three.js, no DOM.
//
// A zero-length delta produces one zero-length substep — no division by zero, no
// NaN (US2-S5 edge case). Blocked flags and `stuck` are OR-ed across substeps so
// a single blocked substep is reported for the whole move.

import { DELTA_CLAMP_MS, SUBSTEP_SIZE } from './params';
import { resolveMove, type ResolveResult, type Vec2 } from './collide';
import type { OpenState } from './tiles';

export function integrate(
  grid: string[],
  position: Vec2,
  velX: number,
  velZ: number,
  deltaMs: number,
  openState: OpenState,
): ResolveResult {
  const clamped = Math.max(0, Math.min(deltaMs, DELTA_CLAMP_MS));
  const seconds = clamped / 1000;
  const dx = velX * seconds;
  const dz = velZ * seconds;
  const totalDist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(totalDist / SUBSTEP_SIZE));
  const stepDx = dx / steps;
  const stepDz = dz / steps;

  let x = position.x;
  let z = position.z;
  let blockedN = false;
  let blockedS = false;
  let blockedE = false;
  let blockedW = false;
  let stuck = false;

  for (let i = 0; i < steps; i += 1) {
    const result = resolveMove(grid, { x, z }, { x: stepDx, z: stepDz }, openState);
    x = result.position.x;
    z = result.position.z;
    blockedN = blockedN || result.blockedAxes.n;
    blockedS = blockedS || result.blockedAxes.s;
    blockedE = blockedE || result.blockedAxes.e;
    blockedW = blockedW || result.blockedAxes.w;
    stuck = stuck || result.stuck;
  }

  return {
    position: { x, z },
    blockedAxes: { n: blockedN, s: blockedS, e: blockedE, w: blockedW },
    stuck,
  };
}
