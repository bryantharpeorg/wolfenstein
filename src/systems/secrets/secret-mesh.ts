// The two geometry chores a push-wall creates, both consequences of 002 treating
// an `S` tile as solid: the merged wall group it drew there has to be recognised
// so the secrets system can hide it behind a moving block, and the floor, ceiling
// and jambs it never emitted have to be built, or a wall that slid away would
// reveal a hole rather than a passage.
//
// Mirrors `systems/doors/doorway-mesh.ts` in shape, and differs in one respect
// that matters: a door's leaf retreats *along* the wall it belongs to, while a
// push-wall retreats *out of* it, so the jambs stand on the other axis.

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { CEILING_Y, FLOOR_Y, TILE_SIZE, WALL_MATERIALS, DEFAULT_WALL_MATERIAL } from '../../level';
import type { Secret } from '../../interaction/secret';

const TILE_EPSILON = 1e-4;

function onSecretTile(x: number, z: number, secrets: readonly Secret[]): boolean {
  return secrets.some(
    (secret) =>
      x >= secret.x * TILE_SIZE - TILE_EPSILON &&
      x <= (secret.x + 1) * TILE_SIZE + TILE_EPSILON &&
      z >= secret.z * TILE_SIZE - TILE_EPSILON &&
      z <= (secret.z + 1) * TILE_SIZE + TILE_EPSILON,
  );
}

/** Whether every vertex of a merged geometry lies on a secret tile — true of
 * 002's `S` wall group and of no other group in the scene, so the recognition is
 * by the group's own vertices rather than by an index into 002's build order. An
 * empty geometry and an empty secret set are both false: nothing to hide. */
export function isSecretTileGeometry(positions: ArrayLike<number>, secrets: readonly Secret[]): boolean {
  if (secrets.length === 0 || positions.length === 0) return false;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (!onSecretTile(positions[i]!, positions[i + 2]!, secrets)) return false;
  }
  return true;
}

/** The colour of the wall the secret is embedded in, so an unpushed secret is
 * indistinguishable from the wall around it (US3-S1's premise: the player finds
 * it by pushing, not by looking). Falls back to 002's default for a wall type
 * with no material entry, exactly as `geometry/build.ts` does. */
export function secretWallColor(grid: readonly string[], secret: Secret): number {
  const neighbours =
    secret.axis === 'x'
      ? [
          { x: secret.x, z: secret.z - 1 },
          { x: secret.x, z: secret.z + 1 },
        ]
      : [
          { x: secret.x - 1, z: secret.z },
          { x: secret.x + 1, z: secret.z },
        ];
  for (const tile of neighbours) {
    const cell = grid[tile.z]?.[tile.x] ?? ' ';
    const material = WALL_MATERIALS[cell];
    if (material != null) return material.color;
  }
  return DEFAULT_WALL_MATERIAL.color;
}

/** One `BufferGeometry` carrying the recess behind every secret in the field, so
 * the whole shell costs a single draw call. Null when there are no secrets, so
 * the caller adds no empty mesh. Quads are wound to face inward; normals are
 * derived. The jambs stand on the two solid sides of the secret's own tile —
 * the faces 002 culled because both tiles were solid. */
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
    // The wall it sits in runs at right angles to the push, so its two solid
    // neighbours — and therefore the jambs — lie on the other axis.
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
