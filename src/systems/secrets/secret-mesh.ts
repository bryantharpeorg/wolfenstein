// The two geometry chores a push-wall creates, both consequences of 002 treating an
// `S` tile as solid: its merged wall group has to be recognised so the system can
// hide it behind a moving block, and the floor, ceiling and jambs it never emitted
// have to be built, or a wall that slid away would reveal a hole, not a passage.

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { CEILING_Y, FLOOR_Y, TILE_SIZE, WALL_MATERIALS, DEFAULT_WALL_MATERIAL } from '../../level';
import type { Secret } from '../../interaction/secret';

const EPSILON = 1e-4;

/** Whether every vertex of a merged geometry lies on a secret tile — true of 002's
 * `S` wall group and no other, so recognition is by the group's own vertices rather
 * than an index into 002's build order. Empty inputs are false: nothing to hide. */
export function isSecretTileGeometry(positions: ArrayLike<number>, secrets: readonly Secret[]): boolean {
  if (secrets.length === 0 || positions.length === 0) return false;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!;
    const z = positions[i + 2]!;
    const onTile = secrets.some(
      (s) =>
        x >= s.x * TILE_SIZE - EPSILON &&
        x <= (s.x + 1) * TILE_SIZE + EPSILON &&
        z >= s.z * TILE_SIZE - EPSILON &&
        z <= (s.z + 1) * TILE_SIZE + EPSILON,
    );
    if (!onTile) return false;
  }
  return true;
}

/** The colour of the wall the secret is embedded in, so an unpushed secret is
 * indistinguishable from it (US3-S1's premise: found by pushing, not by looking).
 * Falls back to 002's default, exactly as `geometry/build.ts` does. */
export function secretWallColor(grid: readonly string[], secret: Secret): number {
  const neighbours: Array<[number, number]> =
    secret.axis === 'x'
      ? [
          [secret.x, secret.z - 1],
          [secret.x, secret.z + 1],
        ]
      : [
          [secret.x - 1, secret.z],
          [secret.x + 1, secret.z],
        ];
  for (const [x, z] of neighbours) {
    const material = WALL_MATERIALS[grid[z]?.[x] ?? ' '];
    if (material != null) return material.color;
  }
  return DEFAULT_WALL_MATERIAL.color;
}

/** One `BufferGeometry` carrying the recess behind every secret, so the whole shell
 * costs a single draw call; null when there are none. Quads face inward, normals are
 * derived, and the jambs lie on the axis at right angles to the push. */
export function buildSecretShell(secrets: readonly Secret[]): BufferGeometry | null {
  if (secrets.length === 0) return null;

  const positions: number[] = [];
  const quad = (q: readonly number[]): void => {
    for (const i of [0, 1, 2, 0, 2, 3]) positions.push(q[i * 3]!, q[i * 3 + 1]!, q[i * 3 + 2]!);
  };

  for (const secret of secrets) {
    const x0 = secret.x * TILE_SIZE;
    const x1 = x0 + TILE_SIZE;
    const z0 = secret.z * TILE_SIZE;
    const z1 = z0 + TILE_SIZE;
    const [y0, y1] = [FLOOR_Y, CEILING_Y];

    quad([x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0]);
    quad([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1]);
    if (secret.axis === 'x') {
      quad([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0]);
      quad([x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1]);
    } else {
      quad([x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1]);
      quad([x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0]);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
