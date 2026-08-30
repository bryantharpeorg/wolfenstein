// One door per `D` tile of 002's grid, plus the two questions only the whole set
// can answer: which door is the player next to, and would opening this one drive
// its leaf into another door's tile (FR-006, FR-016). Pure; the grid arrives as
// an argument, so a fixture grid is testable.

import { LEVEL_GRID, DOOR_LOCKS } from '../level';
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
} from './door';

export interface DoorField {
  readonly doors: readonly Door[];
}

export interface InteractResolution {
  readonly outcome: InteractOutcome;
  readonly door: Door | null;
}

function cellAt(grid: string[], x: number, z: number): string {
  return grid[z]?.[x] ?? ' ';
}

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

// The leaf slides along the axis of the door's solid neighbours; a fixture grid
// with no clear pair is resolved by majority.
function resolveAxis(grid: string[], x: number, z: number): DoorAxis {
  const alongZ =
    (isBlocking(cellAt(grid, x, z - 1)) ? 1 : 0) + (isBlocking(cellAt(grid, x, z + 1)) ? 1 : 0);
  const alongX =
    (isBlocking(cellAt(grid, x - 1, z)) ? 1 : 0) + (isBlocking(cellAt(grid, x + 1, z)) ? 1 : 0);
  if (alongZ > alongX) return 'z';
  if (alongX > alongZ) return 'x';
  return alongZ === 2 ? 'z' : 'x';
}

// Into a wall if one neighbour is a wall, positive when both are. A door whose
// only blocking neighbour is another door retracts toward it and is then refused
// by the neighbour rule rather than failing to open in silence.
function resolveDirection(grid: string[], x: number, z: number, axis: DoorAxis): DoorDirection {
  const negative = axis === 'x' ? cellAt(grid, x - 1, z) : cellAt(grid, x, z - 1);
  const positive = axis === 'x' ? cellAt(grid, x + 1, z) : cellAt(grid, x, z + 1);
  if (isWall(positive)) return 1;
  if (isWall(negative)) return -1;
  if (isBlocking(positive)) return 1;
  if (isBlocking(negative)) return -1;
  return 1;
}

export function buildDoorField(grid = LEVEL_GRID, locks = DOOR_LOCKS): DoorField {
  const doors: Door[] = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== 'D') continue;
      const axis = resolveAxis(grid, x, z);
      const direction = resolveDirection(grid, x, z, axis);
      doors.push(createDoor({ x, z, axis, direction, lock: locks[tileKey(x, z)] ?? 'none' }));
    }
  }
  return { doors };
}

export function doorAt(field: DoorField, x: number, z: number): Door | null {
  return field.doors.find((door) => door.x === x && door.z === z) ?? null;
}

/** The other door, if any, whose leaf already claims a tile this one needs. Only
 * a door that is not `closed` claims anything, so the first of an adjacent pair
 * opens and the second is refused (US1-S9). */
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

/** The nearest door within reach — the player's tile or its four orthogonal
 * neighbours. Null is reported as `no-target` (FR-006). */
export function findTargetDoor(field: DoorField, playerX: number, playerZ: number): Door | null {
  const tileX = Math.floor(playerX);
  const tileZ = Math.floor(playerZ);
  let best: Door | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const door of field.doors) {
    if (Math.abs(door.x - tileX) + Math.abs(door.z - tileZ) > INTERACT_REACH_TILES) continue;
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

/** Resolves one interact command against the field: the neighbour rule applies
 * here, the rest is the door's own machine (FR-006). */
export function interactWithDoors(field: DoorField, playerX: number, playerZ: number): InteractResolution {
  const door = findTargetDoor(field, playerX, playerZ);
  if (door == null) return { outcome: 'no-target', door: null };
  if (door.state === 'closed' && neighbourConflict(field, door) != null) {
    return { outcome: 'blocked-neighbour', door };
  }
  return { outcome: interactDoor(door), door };
}

export function openDoorTiles(field: DoorField): string[] {
  return field.doors.filter(isDoorPassable).map((door) => tileKey(door.x, door.z));
}

export { doorDestinationTile };
