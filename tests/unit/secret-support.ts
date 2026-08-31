// The fixture and stepping helpers the secret suite shares. Not a test file: vitest
// collects only `*.test.ts`. A push-wall is advanced the way a frame loop would, in
// ticks of a stated size, so a test names a duration — US1's `door-advance.ts` shape.

import { stepSecret, type Secret } from '../../src/interaction/secret';
import { secretAt, stepSecrets, type SecretField } from '../../src/interaction/secret-field';

// An 11x11 room with two push-walls, each in a one-tile-thick wall with solid tiles
// on two opposite sides — what 002's validator demands of an `S`. (3,3) lies in a
// wall running along x, so it is pushed along z; (3,7) is the other way round. Both
// have two clear tiles on either side, so every push travels its full two tiles.
export const SECRET_FIXTURE: string[] = [
  '11111111111',
  '10000000001',
  '10000000001',
  '101S1000001',
  '10000000001',
  '10000000001',
  '10010000001',
  '100S0000001',
  '10010000001',
  '10000000001',
  '11111111111',
];

/** Standing in the middle of a tile, which is where a player is. */
export const at = (x: number, z: number): [number, number] => [x + 0.5, z + 0.5];

function advance(totalMs: number, tickMs: number, step: (ms: number) => void): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const tick = Math.min(tickMs, remaining);
    step(tick);
    remaining -= tick;
  }
}

export function advanceSecret(secret: Secret, totalMs: number, tickMs = 100): void {
  advance(totalMs, tickMs, (ms) => stepSecret(secret, ms));
}

export function advanceField(field: SecretField, totalMs: number, tickMs = 100): void {
  advance(totalMs, tickMs, (ms) => stepSecrets(field, ms));
}

/** Every `S` tile of a grid, so a test finds the shipped secrets rather than
 * hard-coding coordinates a later layout edit would silently invalidate. */
export function secretTiles(grid: readonly string[]): Array<{ x: number; z: number }> {
  const tiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) if (row[x] === 'S') tiles.push({ x, z });
  }
  return tiles;
}

/** A tile the player can stand on to push this secret: the neighbour on the open
 * side of its wall. */
export function pushFrom(field: SecretField, x: number, z: number): [number, number] {
  return secretAt(field, x, z)!.axis === 'x' ? at(x - 1, z) : at(x, z - 1);
}
