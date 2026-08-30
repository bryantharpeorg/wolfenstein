// The crush test: does a door's travel volume intersect the player's capsule?
// (FR-015). Pure arithmetic — an axis-aligned box against a circle — with the
// position handed in as arguments, never read from a global, so the test needs
// no page and no render loop.

import type { Door, PlayerCapsule } from './door';
import { DOOR_TRAVEL_TILES } from './params';
import type { DoorGate } from './gate-registry';

export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A boundary contact is contact, not penetration, at this tolerance. */
const CRUSH_EPSILON = 1e-9;

/**
 * The volume the leaf sweeps as it closes from its current progress: its own
 * tile, plus whatever part of the recess the leaf still fills. A player anywhere
 * inside this box is in the leaf's way.
 */
export function doorTravelVolume(door: Door): Aabb {
  const retracted = door.progress * DOOR_TRAVEL_TILES * door.direction;
  if (door.axis === 'x') {
    return {
      minX: Math.min(door.x, door.x + retracted),
      maxX: Math.max(door.x + 1, door.x + 1 + retracted),
      minZ: door.z,
      maxZ: door.z + 1,
    };
  }
  return {
    minX: door.x,
    maxX: door.x + 1,
    minZ: Math.min(door.z, door.z + retracted),
    maxZ: Math.max(door.z + 1, door.z + 1 + retracted),
  };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Whether a capsule of `radius` centred at (playerX, playerZ) overlaps the
 * door's travel volume. A centre inside the box always counts, whatever the
 * radius; outside it, the nearest-point distance decides.
 */
export function doorWouldCrush(
  door: Door,
  playerX: number,
  playerZ: number,
  radius: number,
): boolean {
  const volume = doorTravelVolume(door);
  const nearestX = clamp(playerX, volume.minX, volume.maxX);
  const nearestZ = clamp(playerZ, volume.minZ, volume.maxZ);
  const dx = playerX - nearestX;
  const dz = playerZ - nearestZ;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq === 0) return true;
  return distanceSq < radius * radius - CRUSH_EPSILON;
}

/**
 * The gate the render layer registers (FR-015). It reads the player through the
 * supplied accessor at the moment it is asked, so the live position crosses the
 * DOM line as a closure rather than as an import this module would need.
 *
 * It answers only the `close` phase: a player standing in a doorway must not be
 * able to stop the door from opening, only from closing on them.
 */
export function createCrushGate(readPlayer: () => PlayerCapsule | null): DoorGate {
  return ({ door, phase }) => {
    if (phase !== 'close') return null;
    const player = readPlayer();
    if (player == null) return null;
    return doorWouldCrush(door, player.x, player.z, player.radius) ? 'crush-reversed' : null;
  };
}
