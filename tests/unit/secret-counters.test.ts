import { describe, it, expect } from 'vitest';
import { LEVEL_GRID } from '../../src/level';
import { SECRET_TRAVEL_TILES } from '../../src/interaction/params';
import { SECRET_TRAVEL_MS } from '../../src/interaction/secret';
import {
  buildSecretField,
  interactWithSecrets,
  openSecretTiles,
  secretAt,
  secretsFound,
  secretsTotal,
  type SecretField,
} from '../../src/interaction/secret-field';
import { isTileBlocking } from '../../src/player/tiles';
import { advanceField } from './secret-advance';
import { at } from './secret-fixture';

/** Every `S` tile of a grid, so the test finds the shipped secrets rather than
 * hard-coding coordinates that a later layout edit would silently invalidate. */
function secretTiles(grid: readonly string[]): Array<{ x: number; z: number }> {
  const tiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) if (row[x] === 'S') tiles.push({ x, z });
  }
  return tiles;
}

/** A tile the player could stand on to push this secret: the neighbour on the
 * open side of its wall. */
function pushFrom(field: SecretField, x: number, z: number): [number, number] {
  const secret = secretAt(field, x, z)!;
  return secret.axis === 'x' ? at(x - 1, z) : at(x, z - 1);
}

describe('secret counters over the shipped layout (FR-013, US3-S4)', () => {
  it('reports a secretsTotal matching the shipped `S` tiles, and greater than 0', () => {
    const field = buildSecretField(LEVEL_GRID);
    expect(secretsTotal(field)).toBe(secretTiles(LEVEL_GRID).length);
    expect(secretsTotal(field)).toBeGreaterThan(0);
  });

  it('increments secretsFound by exactly 1 per secret and reaches secretsTotal', () => {
    const field = buildSecretField(LEVEL_GRID);
    expect(secretsFound(field)).toBe(0);

    let expected = 0;
    for (const tile of secretTiles(LEVEL_GRID)) {
      const before = secretsFound(field);
      const resolution = interactWithSecrets(field, ...pushFrom(field, tile.x, tile.z));
      expect(resolution.outcome).toBe('opened');
      expected += 1;
      expect(secretsFound(field) - before).toBe(1);
      expect(secretsFound(field)).toBe(expected);
      advanceField(field, SECRET_TRAVEL_MS * 2);
    }

    expect(secretsFound(field)).toBe(secretsTotal(field));
  });

  it('never lets secretsFound exceed secretsTotal, however many pushes are issued', () => {
    const field = buildSecretField(LEVEL_GRID);
    const tiles = secretTiles(LEVEL_GRID);
    let previous = 0;

    for (let pass = 0; pass < 5; pass += 1) {
      for (const tile of tiles) {
        interactWithSecrets(field, ...pushFrom(field, tile.x, tile.z));
        const found = secretsFound(field);
        // Monotonic non-decreasing, and bounded, at every single observation.
        expect(found).toBeGreaterThanOrEqual(previous);
        expect(found).toBeLessThanOrEqual(secretsTotal(field));
        previous = found;
      }
      advanceField(field, SECRET_TRAVEL_MS);
    }

    expect(secretsFound(field)).toBe(secretsTotal(field));
  });
});

describe('an opened secret stays open (FR-013, US3-S3, US3-S5)', () => {
  const openedField = (): { field: SecretField; from: [number, number] } => {
    const field = buildSecretField(LEVEL_GRID);
    const tile = secretTiles(LEVEL_GRID)[0]!;
    const from = pushFrom(field, tile.x, tile.z);
    interactWithSecrets(field, ...from);
    advanceField(field, SECRET_TRAVEL_MS * 2);
    return { field, from };
  };

  it('answers `already-open` to any further interact command', () => {
    const { field, from } = openedField();
    for (let i = 0; i < 20; i += 1) {
      expect(interactWithSecrets(field, ...from).outcome).toBe('already-open');
    }
  });

  it('holds displacement at exactly 2 tiles with no reverse motion', () => {
    const { field, from } = openedField();
    const secret = field.secrets[0]!;
    expect(secret.displacement).toBe(SECRET_TRAVEL_TILES);

    interactWithSecrets(field, ...from);
    advanceField(field, SECRET_TRAVEL_MS * 4);
    expect(secret.displacement).toBe(SECRET_TRAVEL_TILES);
    expect(secret.state).toBe('open');

    // And from the other side, which is the direction a reversal would take.
    const opposite: [number, number] =
      secret.axis === 'x' ? at(secret.x + 1, secret.z) : at(secret.x, secret.z + 1);
    expect(interactWithSecrets(field, ...opposite).outcome).toBe('already-open');
    advanceField(field, SECRET_TRAVEL_MS * 4);
    expect(secret.displacement).toBe(SECRET_TRAVEL_TILES);
  });

  it('leaves the counter unchanged when an already-open secret is re-pushed', () => {
    const { field, from } = openedField();
    const found = secretsFound(field);
    for (let i = 0; i < 20; i += 1) {
      interactWithSecrets(field, ...from);
      advanceField(field, SECRET_TRAVEL_MS);
      expect(secretsFound(field)).toBe(found);
    }
  });
});

describe('an opened secret makes its origin tile walkable (US3-S7)', () => {
  it('reports the origin tile as blocking before the push and walkable after it', () => {
    const field = buildSecretField(LEVEL_GRID);
    const tile = secretTiles(LEVEL_GRID)[0]!;
    const open = () => new Set(openSecretTiles(field));

    expect(open().size).toBe(0);
    expect(isTileBlocking(LEVEL_GRID, tile.x, tile.z, open())).toBe(true);

    interactWithSecrets(field, ...pushFrom(field, tile.x, tile.z));
    // Mid-slide the wall still fills the doorway, so the tile still blocks.
    advanceField(field, SECRET_TRAVEL_MS / 2);
    expect(isTileBlocking(LEVEL_GRID, tile.x, tile.z, open())).toBe(true);

    advanceField(field, SECRET_TRAVEL_MS);
    expect(open().has(`${tile.x},${tile.z}`)).toBe(true);
    expect(isTileBlocking(LEVEL_GRID, tile.x, tile.z, open())).toBe(false);
  });
});
