import { describe, it, expect } from 'vitest';
import {
  createSecret,
  pushSecret,
  stepSecret,
  secretOffset,
  SECRET_TILE_MS,
  SECRET_TRAVEL_MS,
} from '../../src/interaction/secret';
import { SECRET_TRAVEL_TILES, MAX_STEP_MS } from '../../src/interaction/params';
import { buildSecretField, interactWithSecrets, secretAt } from '../../src/interaction/secret-field';
import { advanceSecret, advanceField } from './secret-advance';
import { SECRET_FIXTURE, at } from './secret-fixture';

describe('secret push travel (FR-012, US3-S1)', () => {
  it('slides away from the player along the axis its wall declares', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    // The player stands north of (3,3); the wall runs along x, so it retreats +z.
    const resolution = interactWithSecrets(field, ...at(3, 2));
    const secret = secretAt(field, 3, 3)!;

    expect(resolution.outcome).toBe('opened');
    expect(resolution.secret).toBe(secret);
    expect(secret.axis).toBe('z');
    expect(secret.direction).toBe(1);
  });

  it('retreats the other way when the player pushes from the other side', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    expect(interactWithSecrets(field, ...at(3, 4)).outcome).toBe('opened');
    expect(secretAt(field, 3, 3)!.direction).toBe(-1);
  });

  it('resolves a wall running along z to an x-axis push', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    interactWithSecrets(field, ...at(2, 7));
    const secret = secretAt(field, 3, 7)!;
    expect(secret.axis).toBe('x');
    expect(secret.direction).toBe(1);
  });

  it('comes to rest displaced by exactly 2 tiles', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    interactWithSecrets(field, ...at(3, 2));
    const secret = secretAt(field, 3, 3)!;

    advanceField(field, SECRET_TRAVEL_MS * 2);

    expect(secret.displacement).toBe(SECRET_TRAVEL_TILES);
    expect(secret.displacement).toBe(2);
    expect(secret.state).toBe('open');
  });

  it('never moves off its declared axis', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'z', direction: 1 });
    pushSecret(secret);
    advanceSecret(secret, SECRET_TRAVEL_MS * 2);

    expect(secretOffset(secret)).toEqual({ x: 0, z: 2 });
  });

  it('offsets negatively when the declared direction is negative', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'x', direction: -1 });
    pushSecret(secret);
    advanceSecret(secret, SECRET_TRAVEL_MS * 2);

    expect(secretOffset(secret)).toEqual({ x: -2, z: 0 });
  });
});

describe('secret travel is interpolated over elapsed seconds (FR-012, US3-S2)', () => {
  it('reports a fraction of 2 tiles mid-slide, as US1-S3 asserts of a door', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'z' });
    pushSecret(secret);

    // Displacement is a pure function of elapsed milliseconds, not of how many
    // times the secret was stepped — US1's rule, applied over two tiles.
    advanceSecret(secret, SECRET_TRAVEL_MS / 4);
    expect(secret.displacement).toBeCloseTo(SECRET_TRAVEL_TILES * 0.25, 10);

    advanceSecret(secret, SECRET_TRAVEL_MS / 4);
    expect(secret.displacement).toBeCloseTo(SECRET_TRAVEL_TILES * 0.5, 10);

    advanceSecret(secret, SECRET_TRAVEL_MS / 4);
    expect(secret.displacement).toBeCloseTo(SECRET_TRAVEL_TILES * 0.75, 10);
    expect(secret.state).toBe('sliding');
  });

  it('travels one tile in the time a door travels one tile', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'z' });
    pushSecret(secret);
    advanceSecret(secret, SECRET_TILE_MS);
    expect(secret.displacement).toBeCloseTo(1, 10);
  });

  it('reaches the same displacement whatever the tick size', () => {
    const coarse = createSecret({ x: 3, z: 3, axis: 'z' });
    const fine = createSecret({ x: 3, z: 3, axis: 'z' });
    pushSecret(coarse);
    pushSecret(fine);

    advanceSecret(coarse, SECRET_TRAVEL_MS / 2, 400);
    advanceSecret(fine, SECRET_TRAVEL_MS / 2, 16);

    expect(coarse.displacement).toBeCloseTo(fine.displacement, 8);
    expect(coarse.displacement).toBeCloseTo(1, 8);
  });

  it('clamps a pathological delta rather than teleporting past the rest position', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'z' });
    pushSecret(secret);

    // One resumed-tab frame of 60 seconds, clamped to the shared MAX_STEP_MS the
    // door machine uses (US1-S8's rule).
    stepSecret(secret, 60_000);
    expect(secret.displacement).toBeCloseTo(MAX_STEP_MS / SECRET_TILE_MS, 10);
    expect(secret.state).toBe('sliding');
  });

  it('ignores a zero, negative or non-finite delta', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'z' });
    pushSecret(secret);
    for (const delta of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      stepSecret(secret, delta);
      expect(secret.displacement).toBe(0);
    }
  });

  it('does not move a secret that was never pushed', () => {
    const secret = createSecret({ x: 3, z: 3, axis: 'z' });
    advanceSecret(secret, SECRET_TRAVEL_MS * 3);
    expect(secret.displacement).toBe(0);
    expect(secret.state).toBe('idle');
    expect(secret.found).toBe(false);
  });

  it('answers `no-target` when no secret is in reach', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    const resolution = interactWithSecrets(field, ...at(7, 4));
    expect(resolution.outcome).toBe('no-target');
    expect(resolution.secret).toBeNull();
  });

  it('refuses a re-push mid-slide without reversing it', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    interactWithSecrets(field, ...at(3, 2));
    const secret = secretAt(field, 3, 3)!;
    advanceField(field, SECRET_TRAVEL_MS / 2);
    const midway = secret.displacement;

    // Pushing from the far side mid-slide must not turn it around (US3-S3's
    // "no reverse motion", applied before the wall has come to rest).
    const again = interactWithSecrets(field, ...at(3, 4));
    expect(again.outcome).toBe('blocked-moving');
    expect(secret.displacement).toBe(midway);
    expect(secret.direction).toBe(1);
  });
});
