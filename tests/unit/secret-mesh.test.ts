import { describe, it, expect } from 'vitest';
import { emitFaces } from '../../src/geometry/faces';
import { LEVEL_GRID, WALL_MATERIALS, DEFAULT_WALL_MATERIAL } from '../../src/level';
import { buildSecretField } from '../../src/interaction/secret-field';
import { isSecretTileGeometry, secretWallColor } from '../../src/systems/secrets/secret-mesh';

const secrets = buildSecretField(LEVEL_GRID).secrets;

describe('recognising 002’s static secret faces (US3-S1)', () => {
  const faces = emitFaces(LEVEL_GRID);

  it('recognises the `S` wall group, so the system can hide it', () => {
    expect(faces.walls['S']).toBeDefined();
    expect(isSecretTileGeometry(faces.walls['S']!.positions, secrets)).toBe(true);
  });

  it('recognises no other group in the level, so nothing else is hidden with it', () => {
    for (const type of Object.keys(faces.walls)) {
      if (type === 'S') continue;
      expect(isSecretTileGeometry(faces.walls[type]!.positions, secrets), type).toBe(false);
    }
    expect(isSecretTileGeometry(faces.floor.positions, secrets)).toBe(false);
    expect(isSecretTileGeometry(faces.ceiling.positions, secrets)).toBe(false);
  });

  it('recognises nothing at all when there is nothing to recognise', () => {
    expect(isSecretTileGeometry(faces.walls['S']!.positions, [])).toBe(false);
    expect(isSecretTileGeometry(new Float32Array(0), secrets)).toBe(false);
  });
});

describe('an unpushed secret is indistinguishable from the wall it sits in (US3-S1)', () => {
  it('takes the colour of the wall type on either solid side', () => {
    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      const neighbours =
        secret.axis === 'x'
          ? [LEVEL_GRID[secret.z - 1]?.[secret.x], LEVEL_GRID[secret.z + 1]?.[secret.x]]
          : [LEVEL_GRID[secret.z]?.[secret.x - 1], LEVEL_GRID[secret.z]?.[secret.x + 1]];
      const expected = neighbours
        .map((cell) => (cell == null ? undefined : WALL_MATERIALS[cell]))
        .find((material) => material != null);
      expect(expected, `no wall material beside the secret at (${secret.x},${secret.z})`).toBeDefined();
      expect(secretWallColor(LEVEL_GRID, secret)).toBe(expected!.color);
    }
  });

  it('is never 002’s default grey, which is what would give a secret away', () => {
    for (const secret of secrets) {
      expect(secretWallColor(LEVEL_GRID, secret)).not.toBe(DEFAULT_WALL_MATERIAL.color);
    }
  });

  it('falls back to 002’s default when no neighbour declares a material', () => {
    const bare = ['   ', ' S ', '   '];
    const [only] = buildSecretField(bare).secrets;
    expect(only).toBeDefined();
    expect(secretWallColor(bare, only!)).toBe(DEFAULT_WALL_MATERIAL.color);
  });
});
