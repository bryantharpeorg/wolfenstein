// The push-wall: a secret slides exactly two tiles away from the player and never
// comes back (FR-012, FR-013). Like US1's door it is a pure state machine advanced
// by accumulated milliseconds, never by frame count. The grid arrives as a
// predicate rather than an import, so a fixture is testable.

import type { InteractOutcome } from './outcomes';
import { DOOR_TRAVEL_MS, DOOR_TRAVEL_TILES, MAX_STEP_MS, SECRET_TRAVEL_TILES } from './params';

/** `idle` before the first push, `sliding` while travelling, then a terminal rest:
 * `open` when the full two tiles cleared, `blocked` when the path ran out first
 * (FR-014). Neither terminal state ever moves again (FR-013). */
export const SECRET_STATES = ['idle', 'sliding', 'open', 'blocked'] as const;
export type SecretState = (typeof SECRET_STATES)[number];

/** The axis the wall retreats along: perpendicular to the wall it sits in. */
export type SecretAxis = 'x' | 'z';
export type SecretDirection = 1 | -1;

export interface TileCoord {
  x: number;
  z: number;
}

// Taken from US1's door rather than declared again, so one tuning constant moves
// both and a secret's two tiles take twice a door's one (FR-012).
export const SECRET_TILE_MS = DOOR_TRAVEL_MS / DOOR_TRAVEL_TILES;
export const SECRET_TRAVEL_MS = SECRET_TILE_MS * SECRET_TRAVEL_TILES;

export interface Secret {
  /** The tile the wall started in; it keeps this identity once displaced. */
  readonly x: number;
  readonly z: number;
  readonly axis: SecretAxis;
  /** Away from the player who pushed it; fixed for the life of the push. */
  direction: SecretDirection;
  state: SecretState;
  /** Tiles travelled so far, 0 to `travelLimit`. Never decreases (FR-013). */
  displacement: number;
  /** How far this push may carry it: two tiles, or less when obstructed (FR-014). */
  travelLimit: number;
  /** Latched on the first push that moves it, which makes `secretsFound`
   * monotonic by construction (US3-S5). */
  found: boolean;
}

export interface CreateSecretOptions {
  x: number;
  z: number;
  axis: SecretAxis;
  direction?: SecretDirection;
}

export function createSecret(options: CreateSecretOptions): Secret {
  return {
    x: options.x,
    z: options.z,
    axis: options.axis,
    direction: options.direction ?? 1,
    state: 'idle',
    displacement: 0,
    travelLimit: SECRET_TRAVEL_TILES,
    found: false,
  };
}

/** Whether a tile the wall wants to travel into is obstructed; the caller owns
 * the grid, so this module never reads one. */
export type SecretPathBlocked = (tile: TileCoord) => boolean;

export interface PushSecretOptions {
  /** Away from the player. Kept as-is when omitted. */
  direction?: SecretDirection;
  isPathBlocked?: SecretPathBlocked;
}

export interface SecretPushResult {
  readonly outcome: InteractOutcome;
  /** Tiles of the declared two this push will not travel (FR-014, US3-S6). */
  readonly remainingTiles: number;
}

function tileAt(secret: Secret, steps: number): TileCoord {
  const offset = steps * secret.direction;
  return secret.axis === 'x'
    ? { x: secret.x + offset, z: secret.z }
    : { x: secret.x, z: secret.z + offset };
}

/** The tile the wall's body fills. Never solid rock: `pushSecret` refused to
 * grant travel it could not clear (US3-S6). */
export function secretOccupiedTile(secret: Secret): TileCoord {
  return tileAt(secret, Math.round(secret.displacement));
}

/** The mesh offset in tiles, signed along the secret's own axis. */
export function secretOffset(secret: Secret): TileCoord {
  const offset = secret.displacement * secret.direction;
  return secret.axis === 'x' ? { x: offset, z: 0 } : { x: 0, z: offset };
}

/** Tiles of the declared two the secret will never travel (FR-014): zero unless
 * it is blocked. */
export function secretRemainingTiles(secret: Secret): number {
  return secret.state === 'idle' ? 0 : SECRET_TRAVEL_TILES - secret.travelLimit;
}

export function isSecretOpen(secret: Secret): boolean {
  return secret.state === 'open';
}

/** Two tiles when the path is clear, else the distance to the first obstruction. */
function resolveTravelLimit(secret: Secret, isPathBlocked: SecretPathBlocked | undefined): number {
  if (isPathBlocked == null) return SECRET_TRAVEL_TILES;
  for (let step = 1; step <= SECRET_TRAVEL_TILES; step += 1) {
    if (isPathBlocked(tileAt(secret, step))) return step - 1;
  }
  return SECRET_TRAVEL_TILES;
}

/**
 * Resolves one interact command against one secret (FR-012, FR-013, FR-014), always
 * to an outcome US1 already declared: `opened` accepts the push, `blocked-geometry`
 * halts travel at the first obstruction and reports the shortfall, `blocked-moving`
 * refuses mid-slide without reversing, `already-open` answers a wall at rest —
 * secrets do not close (US3-S3).
 */
export function pushSecret(secret: Secret, options: PushSecretOptions = {}): SecretPushResult {
  if (secret.state === 'open') return { outcome: 'already-open', remainingTiles: 0 };
  if (secret.state === 'sliding') {
    return { outcome: 'blocked-moving', remainingTiles: secretRemainingTiles(secret) };
  }
  // Terminal: the geometry that stopped it is level data, which does not change,
  // so the answer is the same one every time it is asked.
  if (secret.state === 'blocked') {
    return { outcome: 'blocked-geometry', remainingTiles: secretRemainingTiles(secret) };
  }

  if (options.direction != null) secret.direction = options.direction;
  secret.travelLimit = resolveTravelLimit(secret, options.isPathBlocked);
  const remainingTiles = SECRET_TRAVEL_TILES - secret.travelLimit;

  // Nothing can move, so nothing is discovered: `found` stays false and the
  // counter stays honest about what the player actually opened.
  if (secret.travelLimit <= 0) {
    secret.state = 'blocked';
    return { outcome: 'blocked-geometry', remainingTiles };
  }

  secret.state = 'sliding';
  secret.found = true;
  return { outcome: remainingTiles > 0 ? 'blocked-geometry' : 'opened', remainingTiles };
}

/** Advances a secret by `deltaMs` (FR-012): clamped to the shared `MAX_STEP_MS`,
 * then converted to tiles at the door's own rate, so displacement is a fraction of
 * two tiles interpolated over elapsed seconds and a resumed tab never teleports the
 * wall past its rest position (US3-S2). */
export function stepSecret(secret: Secret, deltaMs: number): void {
  if (secret.state !== 'sliding') return;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;

  secret.displacement += Math.min(deltaMs, MAX_STEP_MS) / SECRET_TILE_MS;
  if (secret.displacement < secret.travelLimit) return;

  secret.displacement = secret.travelLimit;
  secret.state = secret.travelLimit >= SECRET_TRAVEL_TILES ? 'open' : 'blocked';
}
