// The door state machine: `closed`, `opening`, `open`, `closing`, advanced by
// accumulated milliseconds rather than by frame count (FR-001, FR-002).
//
// Nothing here knows what a frame is. `stepDoor` takes elapsed milliseconds and
// returns state; the render layer reads `progress` and moves a mesh. That is
// what makes eight of US1's nine acceptance scenarios assertable under vitest,
// and it is the pattern M5's guard AI reuses.
//
// Pure: no DOM, no three.js. Player position, when the crush test needs it,
// arrives as an argument or through a registered gate — never from a global.

import type { LockKind } from '../level';
import type { InteractOutcome } from './outcomes';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS, MAX_STEP_MS, DOOR_TRAVEL_TILES } from './params';
import { firstRefusal } from './gate-registry';
import { doorWouldCrush } from './crush';

/** The four states, declared once and in progression order (FR-001). */
export const DOOR_STATES = ['closed', 'opening', 'open', 'closing'] as const;

export type DoorState = (typeof DOOR_STATES)[number];

/** The axis the leaf slides along: the axis of the door's two solid neighbours. */
export type DoorAxis = 'x' | 'z';

/** Which way along that axis the leaf retracts. */
export type DoorDirection = 1 | -1;

export interface TileCoord {
  x: number;
  z: number;
}

export interface Door {
  /** The door's own tile, in grid coordinates. */
  readonly x: number;
  readonly z: number;
  readonly axis: DoorAxis;
  readonly direction: DoorDirection;
  /**
   * The key kind this door demands, from 002's door-lock table. US1 never reads
   * it; it is declared here so US2's lock gate has somewhere to look without
   * reopening this file.
   */
  readonly lock: LockKind;
  state: DoorState;
  /** Travel fraction: 0 fully closed, 1 fully retracted. */
  progress: number;
  /** Milliseconds accumulated in the current `open` dwell (FR-004). */
  dwellMs: number;
}

export interface CreateDoorOptions {
  x: number;
  z: number;
  axis: DoorAxis;
  direction?: DoorDirection;
  lock?: LockKind;
}

/** The player's footprint, passed in by the caller that owns it. */
export interface PlayerCapsule {
  x: number;
  z: number;
  radius: number;
}

export interface DoorStepOptions {
  /** The player capsule, when the caller has one, for the crush test (FR-015). */
  player?: PlayerCapsule | null;
}

export interface DoorStepResult {
  /** Outcomes this step produced, in order. Empty when nothing was reported. */
  outcomes: InteractOutcome[];
}

export function createDoor(options: CreateDoorOptions): Door {
  return {
    x: options.x,
    z: options.z,
    axis: options.axis,
    direction: options.direction ?? 1,
    lock: options.lock ?? 'none',
    state: 'closed',
    progress: 0,
    dwellMs: 0,
  };
}

/** The tile the leaf retracts into — the recess in the wall beside the door. */
export function doorDestinationTile(door: Door): TileCoord {
  const offset = DOOR_TRAVEL_TILES * door.direction;
  return door.axis === 'x'
    ? { x: door.x + offset, z: door.z }
    : { x: door.x, z: door.z + offset };
}

/** The tiles a door's leaf occupies at any point in its travel: its own and the recess. */
export function doorVolumeTiles(door: Door): TileCoord[] {
  return [{ x: door.x, z: door.z }, doorDestinationTile(door)];
}

/** Whether the door's tile is currently passable. Only a fully open door is. */
export function isDoorPassable(door: Door): boolean {
  return door.state === 'open';
}

/**
 * The refusal that stops a close, or null when the leaf is free to travel. The
 * capsule handed in is checked directly (so a test needs no registry), and the
 * registered gates are asked as well (so the render layer can supply the live
 * player without this module ever reading a global).
 */
function closeRefusal(door: Door, player: PlayerCapsule | null | undefined): InteractOutcome | null {
  if (player != null && doorWouldCrush(door, player.x, player.z, player.radius)) {
    return 'crush-reversed';
  }
  return firstRefusal(door, 'close');
}

// A single clamped delta can carry a door across several transitions — opening
// to open, dwell expiry to closing — so integration is a residual loop rather
// than one assignment. The cap is a backstop against a pathological cycle; the
// real bound is that a clamped step is far shorter than the dwell.
const MAX_TRANSITIONS_PER_STEP = 32;

/**
 * Advances a door by `deltaMs` of wall-clock time (FR-002). The delta is clamped
 * to `MAX_STEP_MS` before any integration, and the remainder is consumed one
 * state at a time, so no transition the door should have reported is skipped
 * (US1-S8).
 */
export function stepDoor(
  door: Door,
  deltaMs: number,
  options: DoorStepOptions = {},
): DoorStepResult {
  const outcomes: InteractOutcome[] = [];
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return { outcomes };

  let remaining = Math.min(deltaMs, MAX_STEP_MS);

  for (let guard = 0; guard < MAX_TRANSITIONS_PER_STEP && remaining > 0; guard += 1) {
    if (door.state === 'closed') break;

    if (door.state === 'opening') {
      const needed = (1 - door.progress) * DOOR_TRAVEL_MS;
      if (remaining < needed) {
        door.progress += remaining / DOOR_TRAVEL_MS;
        remaining = 0;
      } else {
        door.progress = 1;
        door.state = 'open';
        door.dwellMs = 0;
        remaining -= needed;
      }
      continue;
    }

    if (door.state === 'open') {
      const needed = DOOR_DWELL_MS - door.dwellMs;
      if (remaining < needed) {
        door.dwellMs += remaining;
        remaining = 0;
      } else {
        door.dwellMs = DOOR_DWELL_MS;
        door.state = 'closing';
        remaining -= needed;
      }
      continue;
    }

    // 'closing': the leaf may not travel into the player (FR-015).
    const refusal = closeRefusal(door, options.player);
    if (refusal != null) {
      outcomes.push(refusal);
      if (refusal === 'crush-reversed') {
        door.state = 'opening';
        continue;
      }
      // Any other close-phase refusal holds the leaf where it is for this step.
      remaining = 0;
      continue;
    }

    const needed = door.progress * DOOR_TRAVEL_MS;
    if (remaining < needed) {
      door.progress -= remaining / DOOR_TRAVEL_MS;
      remaining = 0;
    } else {
      door.progress = 0;
      door.state = 'closed';
      door.dwellMs = 0;
      remaining -= needed;
    }
  }

  return { outcomes };
}

/**
 * Resolves one interact command against one door (FR-003, FR-004, FR-006).
 * Every path returns a declared outcome; there is no silent branch.
 *
 * The neighbour rule (FR-016) is not decided here — it is a fact about two
 * doors, so `door-field.ts` applies it before delegating to this function.
 */
export function interactDoor(door: Door): InteractOutcome {
  switch (door.state) {
    case 'opening':
      // A moving door does not reverse and does not re-trigger (US1-S5).
      return 'blocked-moving';
    case 'closing':
      // It finishes closing first; it cannot be re-opened until it reports
      // `closed` (US1-S6).
      return 'refusing-closing';
    case 'open': {
      // A player lingering in the doorway pushes the auto-close back (US1-S7).
      door.dwellMs = 0;
      return 'opened-now';
    }
    case 'closed': {
      const refusal = firstRefusal(door, 'interact');
      if (refusal != null) return refusal;
      door.state = 'opening';
      door.dwellMs = 0;
      return 'opened';
    }
  }
}
