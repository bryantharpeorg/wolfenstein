// The fixture every secret test shares: an 11x11 room with two push-walls, each
// sitting in a one-tile-thick wall with solid tiles on exactly two opposite sides
// — the arrangement 002's validator already demands of an `S`.
//
//   (3,3) lies in a wall running along x, so it is pushed along z.
//   (3,7) lies in a wall running along z, so it is pushed along x.
//
// Both have two clear tiles on either side, so either direction of push travels
// its full two tiles and neither is blocked by the fixture itself.

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
