import { describe, it, expect } from 'vitest';
import { SECRET_TRAVEL_TILES } from '../../src/interaction/params';
import {
  SECRET_TRAVEL_MS,
  secretOccupiedTile,
  secretRemainingTiles,
} from '../../src/interaction/secret';
import {
  buildSecretField,
  interactWithSecrets,
  openSecretTiles,
  secretAt,
  secretsFound,
  setSecretRemainingTiles,
} from '../../src/interaction/secret-field';
import { createInteractionDiagnostics } from '../../src/interaction/interaction-diag';
import { advanceField } from './secret-advance';
import { SECRET_FIXTURE, at } from './secret-fixture';

// (3,3) is a secret in a wall running along x, so it is pushed along z. Each
// fixture obstructs that path at a different distance.
const rows = (...body: string[]): string[] => [
  '11111111111',
  '10000000001',
  '10000000001',
  '101S1000001',
  ...body,
  '10000000001',
  '11111111111',
];

/** A solid wall one tile behind the secret: nothing may move at all. */
const BLOCKED_AT_ONE = rows('10010000001', '10000000001', '10000000001', '10000000001', '10000000001');

/** A solid wall two tiles behind: the first tile is free, the second is not. */
const BLOCKED_AT_TWO = rows('10000000001', '10010000001', '10000000001', '10000000001', '10000000001');

/** Another secret two tiles behind, which blocks just as a wall does. */
const SECRET_IN_PATH = rows('10000000001', '101S1000001', '10000000001', '10000000001', '10000000001');

const cellAt = (grid: readonly string[], x: number, z: number): string => grid[z]?.[x] ?? ' ';
const isSolid = (cell: string): boolean => cell !== '0' && cell !== 'E';

describe('a secret halts at the first blocked position (FR-014, US3-S6)', () => {
  it('refuses with `blocked-geometry` and moves nothing when the first tile is solid', () => {
    const field = buildSecretField(BLOCKED_AT_ONE);
    const resolution = interactWithSecrets(field, ...at(3, 2));
    const secret = secretAt(field, 3, 3)!;

    expect(resolution.outcome).toBe('blocked-geometry');
    expect(resolution.remainingTiles).toBe(SECRET_TRAVEL_TILES);
    expect(secret.travelLimit).toBe(0);

    advanceField(field, SECRET_TRAVEL_MS * 4);
    expect(secret.displacement).toBe(0);
    expect(secretRemainingTiles(secret)).toBe(2);
  });

  it('travels one tile and stops when the second tile is solid', () => {
    const field = buildSecretField(BLOCKED_AT_TWO);
    const resolution = interactWithSecrets(field, ...at(3, 2));
    const secret = secretAt(field, 3, 3)!;

    expect(resolution.outcome).toBe('blocked-geometry');
    expect(resolution.remainingTiles).toBe(1);

    advanceField(field, SECRET_TRAVEL_MS * 4);
    expect(secret.displacement).toBe(1);
    expect(secret.state).toBe('blocked');
    expect(secretRemainingTiles(secret)).toBe(1);
  });

  it('treats another secret in the path exactly as it treats solid rock', () => {
    const field = buildSecretField(SECRET_IN_PATH);
    const resolution = interactWithSecrets(field, ...at(3, 2));
    const secret = secretAt(field, 3, 3)!;

    expect(resolution.outcome).toBe('blocked-geometry');
    expect(resolution.remainingTiles).toBe(1);

    advanceField(field, SECRET_TRAVEL_MS * 4);
    expect(secret.displacement).toBe(1);
    expect(secretOccupiedTile(secret)).toEqual({ x: 3, z: 4 });
  });

  it('never displaces a tile into solid rock, in any fixture or at any moment', () => {
    for (const grid of [BLOCKED_AT_ONE, BLOCKED_AT_TWO, SECRET_IN_PATH]) {
      const field = buildSecretField(grid);
      interactWithSecrets(field, ...at(3, 2));
      for (let tick = 0; tick < 40; tick += 1) {
        advanceField(field, 100);
        for (const secret of field.secrets) {
          const tile = secretOccupiedTile(secret);
          const cell = cellAt(grid, tile.x, tile.z);
          // The wall's own origin is an `S`, which is the one solid cell it may
          // occupy; anything else it stands in must be open floor.
          if (tile.x === secret.x && tile.z === secret.z) continue;
          expect(isSolid(cell)).toBe(false);
        }
      }
    }
  });

  it('keeps a blocked secret out of the open-tile set and out of the found count', () => {
    const field = buildSecretField(BLOCKED_AT_ONE);
    interactWithSecrets(field, ...at(3, 2));
    advanceField(field, SECRET_TRAVEL_MS * 4);

    expect(openSecretTiles(field)).toEqual([]);
    expect(secretsFound(field)).toBe(0);
  });

  it('answers `blocked-geometry` again on every further push, without moving', () => {
    const field = buildSecretField(BLOCKED_AT_TWO);
    interactWithSecrets(field, ...at(3, 2));
    advanceField(field, SECRET_TRAVEL_MS * 4);
    const secret = secretAt(field, 3, 3)!;

    for (let i = 0; i < 10; i += 1) {
      const again = interactWithSecrets(field, ...at(3, 2));
      expect(again.outcome).toBe('blocked-geometry');
      expect(again.remainingTiles).toBe(1);
      advanceField(field, SECRET_TRAVEL_MS);
      expect(secret.displacement).toBe(1);
    }
  });

  it('reports the remaining distance through the interaction diagnostics', () => {
    const interaction = createInteractionDiagnostics();
    const field = buildSecretField(BLOCKED_AT_TWO);
    const resolution = interactWithSecrets(field, ...at(3, 2));

    setSecretRemainingTiles(interaction, resolution.remainingTiles);
    expect(interaction.secretRemainingTiles).toBe(1);

    // A clear push reports nothing owed.
    const clear = buildSecretField(SECRET_FIXTURE);
    setSecretRemainingTiles(interaction, interactWithSecrets(clear, ...at(3, 2)).remainingTiles);
    expect(interaction.secretRemainingTiles).toBe(0);
  });
});
