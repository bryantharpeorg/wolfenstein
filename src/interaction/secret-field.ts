// One secret per `S` tile of 002's grid, plus the three questions only the whole
// set can answer: which wall is the player pressing against, which way does it
// retreat, and how many have been found (FR-012, FR-013). Pure; the grid arrives
// as an argument, so a fixture grid is testable.

import { LEVEL_GRID } from '../level';
import type { InteractOutcome } from './outcomes';
import { INTERACT_REACH_TILES, SECRET_TRAVEL_TILES } from './params';
import { tileKey } from '../player/tiles';
import {
  createSecret,
  pushSecret,
  stepSecret,
  isSecretOpen,
  secretOccupiedTile,
  type Secret,
  type SecretAxis,
  type SecretDirection,
  type TileCoord,
} from './secret';
import { setSecretCounts, type InteractionDiagnostics } from './interaction-diag';

// The one field FR-017's set does not name, because only a blocked push has a
// value for it (US3-S6). It is declared here, from US3's own file and by the same
// augmentation `interaction-diag.ts` uses on 001's `Diagnostics`, so US1's module
// is not reopened and the contract stays additive.
declare module './interaction-diag' {
  interface InteractionDiagnostics {
    /** Tiles the last push could not travel; 0 when the path was clear. */
    secretRemainingTiles?: number;
  }
}

export interface SecretField {
  readonly grid: readonly string[];
  readonly secrets: readonly Secret[];
}

export interface SecretResolution {
  readonly outcome: InteractOutcome;
  readonly secret: Secret | null;
  /** Tiles of the declared two the push will not travel (FR-014). */
  readonly remainingTiles: number;
}

function cellAt(grid: readonly string[], x: number, z: number): string {
  return grid[z]?.[x] ?? ' ';
}

/** Anything that is not open floor. Out of bounds counts, so a border secret is
 * boxed in rather than sliding off the map. */
function isBlocking(cell: string): boolean {
  return cell !== '0' && cell !== 'E';
}

/** Whether a tile is open floor a player could stand on, and a wall could travel
 * into. Exported because FR-014's validator rule has to agree with the runtime
 * about what obstructs a push, not merely resemble it. */
export function isSecretPathClear(grid: readonly string[], x: number, z: number): boolean {
  return !isBlocking(cellAt(grid, x, z));
}

// A secret sits in a one-tile-thick wall with solid tiles on exactly two opposite
// sides — 002's validator already requires it of every `S` — so the wall's axis is
// the one with the solid neighbours and the push axis is the other one. That is
// the inverse of the door rule, and deliberately so: a door's leaf slides *into*
// the wall it belongs to, a push-wall retreats *out of* it.
export function resolvePushAxis(grid: readonly string[], x: number, z: number): SecretAxis {
  const solidAlongZ =
    (isBlocking(cellAt(grid, x, z - 1)) ? 1 : 0) + (isBlocking(cellAt(grid, x, z + 1)) ? 1 : 0);
  const solidAlongX =
    (isBlocking(cellAt(grid, x - 1, z)) ? 1 : 0) + (isBlocking(cellAt(grid, x + 1, z)) ? 1 : 0);
  if (solidAlongZ > solidAlongX) return 'x';
  if (solidAlongX > solidAlongZ) return 'z';
  return 'x';
}

export function buildSecretField(grid: readonly string[] = LEVEL_GRID): SecretField {
  const secrets: Secret[] = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== 'S') continue;
      secrets.push(createSecret({ x, z, axis: resolvePushAxis(grid, x, z) }));
    }
  }
  return { grid, secrets };
}

export function secretAt(field: SecretField, x: number, z: number): Secret | null {
  return field.secrets.find((secret) => secret.x === x && secret.z === z) ?? null;
}

/** The nearest secret within reach — the player's tile or its four orthogonal
 * neighbours, the same reach US1 gives a door. Null is reported as `no-target`. */
export function findTargetSecret(field: SecretField, playerX: number, playerZ: number): Secret | null {
  const tileX = Math.floor(playerX);
  const tileZ = Math.floor(playerZ);
  let best: Secret | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const secret of field.secrets) {
    if (Math.abs(secret.x - tileX) + Math.abs(secret.z - tileZ) > INTERACT_REACH_TILES) continue;
    const dx = secret.x + 0.5 - playerX;
    const dz = secret.z + 0.5 - playerZ;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = secret;
    }
  }
  return best;
}

/** Away from the player: the sign of the wall's own offset from them along its
 * push axis. A player standing dead on the axis leaves the stored direction. */
function directionAwayFrom(secret: Secret, playerX: number, playerZ: number): SecretDirection {
  const delta = secret.axis === 'x' ? secret.x + 0.5 - playerX : secret.z + 0.5 - playerZ;
  if (delta > 0) return 1;
  if (delta < 0) return -1;
  return secret.direction;
}

/** Whether the wall may travel into this tile: the grid decides, and so does any
 * other secret standing there, which is why the field owns this and `secret.ts`
 * does not (US3-S6). */
function pathBlocker(field: SecretField, moving: Secret): (tile: TileCoord) => boolean {
  return (tile) => {
    if (isBlocking(cellAt(field.grid, tile.x, tile.z))) return true;
    return field.secrets.some((other) => {
      if (other === moving) return false;
      const occupied = secretOccupiedTile(other);
      return occupied.x === tile.x && occupied.z === tile.z;
    });
  };
}

/** Resolves one interact command against the field (FR-012, FR-013, FR-014). */
export function interactWithSecrets(
  field: SecretField,
  playerX: number,
  playerZ: number,
): SecretResolution {
  const secret = findTargetSecret(field, playerX, playerZ);
  if (secret == null) return { outcome: 'no-target', secret: null, remainingTiles: 0 };

  const result = pushSecret(secret, {
    direction: directionAwayFrom(secret, playerX, playerZ),
    isPathBlocked: pathBlocker(field, secret),
  });
  return { outcome: result.outcome, secret, remainingTiles: result.remainingTiles };
}

export function stepSecrets(field: SecretField, deltaMs: number): void {
  for (const secret of field.secrets) stepSecret(secret, deltaMs);
}

/** The origin tiles of fully opened secrets, for the passable-tile registry US1
 * created: once the wall has cleared its two tiles the opening is real, so 003's
 * collider reports the tile walkable and the player can step through (US3-S7). A
 * wall still in motion, or halted short, keeps filling its tile and is absent. */
export function openSecretTiles(field: SecretField): string[] {
  return field.secrets.filter(isSecretOpen).map((secret) => tileKey(secret.x, secret.z));
}

/** Monotonic non-decreasing by construction: `found` is latched on the first push
 * that moves a wall and never cleared, so this counts distinct secrets and can
 * neither fall nor exceed `secretsTotal` (US3-S4, US3-S5). */
export function secretsFound(field: SecretField): number {
  let found = 0;
  for (const secret of field.secrets) if (secret.found) found += 1;
  return found;
}

export function secretsTotal(field: SecretField): number {
  return field.secrets.length;
}

/** Writes the counters through US1's setter (FR-017). The bound is asserted here
 * rather than assumed, so a future change to `found` cannot publish a count the
 * smoke gate would have to catch. */
export function publishSecretCounts(
  interaction: InteractionDiagnostics,
  field: SecretField,
): void {
  const total = secretsTotal(field);
  setSecretCounts(interaction, Math.min(secretsFound(field), total), total);
}

/** Publishes the shortfall of the last push (FR-014, US3-S6). */
export function setSecretRemainingTiles(
  interaction: InteractionDiagnostics,
  tiles: number,
): void {
  interaction.secretRemainingTiles = Math.max(0, Math.min(tiles, SECRET_TRAVEL_TILES));
}

export { secretOccupiedTile, isSecretOpen };
