// The door field: one door per `D` tile of 002's grid, each with the travel axis
// and direction its neighbours imply, plus the two questions only the whole set
// can answer — "which door is the player standing next to?" and "would opening
// this one drive its leaf into another door's tile?" (FR-006, FR-016).
//
// Pure: no DOM, no three.js. The grid and the lock table arrive as arguments so
// a fixture grid can be tested without the shipped level.

import { LEVEL_GRID, DOOR_LOCKS, type LockKind } from '../level';
import type { InteractOutcome } from './outcomes';
import { INTERACT_REACH_TILES } from './params';
import {
  createDoor,
  interactDoor,
  isDoorPassable,
  doorDestinationTile,
  doorVolumeTiles,
  type Door,
  type DoorAxis,
  type DoorDirection,
  type TileCoord,
} from './door';

export interface DoorField {
  readonly doors: readonly Door[];
}

export interface InteractResolution {
  readonly outcome: InteractOutcome;
  /** The door the command resolved against, or null when there was no target. */
  readonly door: Door | null;
}

/** Two doors whose leaves would claim the same tile (FR-016). */
export interface DestinationConflict {
  readonly a: TileCoord;
  readonly b: TileCoord;
  readonly tile: TileCoord;
}

function cellAt(grid: string[], x: number, z: number): string {
  const row = grid[z];
  if (row === undefined) return ' ';
  return row[x] ?? ' ';
}

/** A wall proper: the tiles a leaf can retract into. */
function isWall(cell: string): boolean {
  return cell >= '1' && cell <= '9';
}

/** Anything that is not open floor. Out of bounds counts, so a border door is boxed in. */
function isBlocking(cell: string): boolean {
  return cell !== '0' && cell !== 'E';
}

function tileKey(x: number, z: number): string {
  return `${x},${z}`;
}

/**
 * The axis of the door's two solid neighbours. A door in a north-south wall has
 * solid tiles above and below it and slides along z; one in an east-west wall
 * slides along x. 002's `door-placement` rule guarantees exactly one such pair
 * in the shipped level; a fixture grid that does not is resolved by majority.
 */
function resolveAxis(grid: string[], x: number, z: number): DoorAxis {
  const alongZ =
    (isBlocking(cellAt(grid, x, z - 1)) ? 1 : 0) + (isBlocking(cellAt(grid, x, z + 1)) ? 1 : 0);
  const alongX =
    (isBlocking(cellAt(grid, x - 1, z)) ? 1 : 0) + (isBlocking(cellAt(grid, x + 1, z)) ? 1 : 0);
  if (alongZ > alongX) return 'z';
  if (alongX > alongZ) return 'x';
  return alongZ === 2 ? 'z' : 'x';
}

/**
 * Which way the leaf retracts: into a wall if one of the two neighbours is a
 * wall, preferring the positive direction when both are. A door whose only
 * blocking neighbour is another door retracts toward it and is then refused by
 * the neighbour rule rather than by a silent failure to open.
 */
function resolveDirection(grid: string[], x: number, z: number, axis: DoorAxis): DoorDirection {
  const negative = axis === 'x' ? cellAt(grid, x - 1, z) : cellAt(grid, x, z - 1);
  const positive = axis === 'x' ? cellAt(grid, x + 1, z) : cellAt(grid, x, z + 1);
  if (isWall(positive)) return 1;
  if (isWall(negative)) return -1;
  if (isBlocking(positive)) return 1;
  if (isBlocking(negative)) return -1;
  return 1;
}

/** Builds one door per `D` tile, in row-major order. */
export function buildDoorField(
  grid: string[] = LEVEL_GRID,
  locks: Record<string, LockKind> = DOOR_LOCKS,
): DoorField {
  const doors: Door[] = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== 'D') continue;
      const axis = resolveAxis(grid, x, z);
      doors.push(
        createDoor({
          x,
          z,
          axis,
          direction: resolveDirection(grid, x, z, axis),
          lock: locks[tileKey(x, z)] ?? 'none',
        }),
      );
    }
  }
  return { doors };
}

export function doorAt(field: DoorField, x: number, z: number): Door | null {
  return field.doors.find((door) => door.x === x && door.z === z) ?? null;
}

/**
 * The other door, if any, whose leaf already claims a tile this door's leaf
 * needs. Only a door that is not `closed` claims anything, so the first of an
 * adjacent pair opens and the second is the one refused (US1-S9).
 */
export function neighbourConflict(field: DoorField, door: Door): Door | null {
  const claimed = new Set(doorVolumeTiles(door).map((tile) => tileKey(tile.x, tile.z)));
  for (const other of field.doors) {
    if (other === door || other.state === 'closed') continue;
    for (const tile of doorVolumeTiles(other)) {
      if (claimed.has(tileKey(tile.x, tile.z))) return other;
    }
  }
  return null;
}

/**
 * Every pair of doors whose leaves would claim the same tile, whatever their
 * state. Empty for a well-formed level: no two doors claim the same destination.
 */
export function destinationConflicts(field: DoorField): DestinationConflict[] {
  const conflicts: DestinationConflict[] = [];
  for (let i = 0; i < field.doors.length; i += 1) {
    const a = field.doors[i]!;
    const aTiles = doorVolumeTiles(a);
    for (let j = i + 1; j < field.doors.length; j += 1) {
      const b = field.doors[j]!;
      for (const tile of doorVolumeTiles(b)) {
        const shared = aTiles.find((own) => own.x === tile.x && own.z === tile.z);
        if (shared != null) {
          conflicts.push({ a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, tile: shared });
        }
      }
    }
  }
  return conflicts;
}

/**
 * The door the player is standing next to — their own tile or one of its four
 * orthogonal neighbours — nearest first. Null when nothing is in reach, which
 * the caller reports as `no-target` (FR-006).
 */
export function findTargetDoor(field: DoorField, playerX: number, playerZ: number): Door | null {
  const tileX = Math.floor(playerX);
  const tileZ = Math.floor(playerZ);
  let best: Door | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const door of field.doors) {
    const manhattan = Math.abs(door.x - tileX) + Math.abs(door.z - tileZ);
    if (manhattan > INTERACT_REACH_TILES) continue;
    const dx = door.x + 0.5 - playerX;
    const dz = door.z + 0.5 - playerZ;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = door;
    }
  }
  return best;
}

/**
 * Resolves one interact command against the field. The neighbour rule is applied
 * here — it is a fact about two doors, not about one — and everything else is
 * delegated to the door's own machine. The result is always a declared outcome.
 */
export function interactWithDoors(
  field: DoorField,
  playerX: number,
  playerZ: number,
): InteractResolution {
  const door = findTargetDoor(field, playerX, playerZ);
  if (door == null) return { outcome: 'no-target', door: null };
  if (door.state === 'closed' && neighbourConflict(field, door) != null) {
    return { outcome: 'blocked-neighbour', door };
  }
  return { outcome: interactDoor(door), door };
}

/** The tile keys of every door that is currently passable, for the open-state registry. */
export function openDoorTiles(field: DoorField): string[] {
  return field.doors
    .filter((door) => isDoorPassable(door))
    .map((door) => tileKey(door.x, door.z));
}

/** Re-exported so callers need not reach into `door.ts` for one helper. */
export { doorDestinationTile };
