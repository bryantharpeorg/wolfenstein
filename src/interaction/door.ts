// The door state machine — `closed`, `opening`, `open`, `closing` — advanced by
// accumulated milliseconds, never by frame count (FR-001, FR-002). Pure: no DOM,
// no three.js; the player position arrives as an argument or through a gate.

import type { LockKind } from '../level';
import type { InteractOutcome } from './outcomes';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS, MAX_STEP_MS, DOOR_TRAVEL_TILES } from './params';
import { firstRefusal } from './gate-registry';
import { doorWouldCrush } from './crush';

/** The four states, declared once and in progression order (FR-001). */
export const DOOR_STATES = ['closed', 'opening', 'open', 'closing'] as const;

export type DoorState = (typeof DOOR_STATES)[number];

/** The axis the leaf slides along: that of the door's two solid neighbours. */
export type DoorAxis = 'x' | 'z';

export type DoorDirection = 1 | -1;

export interface TileCoord {
  x: number;
  z: number;
}

export interface Door {
  readonly x: number;
  readonly z: number;
  readonly axis: DoorAxis;
  readonly direction: DoorDirection;
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

export function doorDestinationTile(door: Door): TileCoord {
  const offset = DOOR_TRAVEL_TILES * door.direction;
  return door.axis === 'x'
    ? { x: door.x + offset, z: door.z }
    : { x: door.x, z: door.z + offset };
}

export function doorVolumeTiles(door: Door): TileCoord[] {
  return [{ x: door.x, z: door.z }, doorDestinationTile(door)];
}

export function isDoorPassable(door: Door): boolean {
  return door.state === 'open';
}

// The capsule handed in is checked directly, so a test needs no registry; the
// gates are asked too, so the render layer supplies the live player (FR-015).
function closeRefusal(door: Door, player: PlayerCapsule | null | undefined): InteractOutcome | null {
  if (player != null && doorWouldCrush(door, player.x, player.z, player.radius)) {
    return 'crush-reversed';
  }
  return firstRefusal(door, 'close');
}

// One clamped delta can carry a door across several transitions, so integration
// is a residual loop. The cap is a backstop against a pathological cycle.
const MAX_TRANSITIONS_PER_STEP = 32;

/** Advances a door by `deltaMs` (FR-002): the delta is clamped to `MAX_STEP_MS`,
 * then consumed one state at a time, so no transition is skipped (US1-S8). */
export function stepDoor(door: Door, deltaMs: number, options: DoorStepOptions = {}): DoorStepResult {
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

/** Resolves one interact command against one door (FR-003, FR-004, FR-006): every
 * path returns a declared outcome. The neighbour rule (FR-016) is a fact about
 * two doors, so `door-field.ts` applies it first. */
export function interactDoor(door: Door): InteractOutcome {
  switch (door.state) {
    case 'opening':
      // A moving door does not reverse and does not re-trigger (US1-S5).
      return 'blocked-moving';
    case 'closing':
      // It cannot be re-opened until it reports `closed` (US1-S6).
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
