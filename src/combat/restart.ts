// The restart command (FR-011): a registry of resettables, the reset itself, the
// snapshot the reset is judged by, and the exempt set SC-002 names. Pure: no
// DOM, no three.js, and — the point of the file — no knowledge of what any of
// the state it resets *is*.
//
// FR-011 resets doors and secrets (004), guards (006), the player spawn (002/003)
// and this spec's own vitals, ammo and score. A restart that reached into each of
// those would be a god object living in one file that five specs have opinions
// about. Instead a story makes its own state resettable by registering a
// function, `src/combat/reset-adapters.ts` registers the cross-spec ones, and US3
// registers its pickups from its own system file without this file learning what
// a pickup is.
//
// The command is *serviced*, not executed on arrival: `requestRestart` raises a
// flag and `serviceRestart` performs at most one reset per frame, which is what
// makes two presses in quick succession one restart (Edge Cases). `resetRun` is
// the primitive underneath, re-entrant-guarded so a resettable that asks for a
// reset does not get one mid-reset.

import type { Diagnostics } from '../diag/diag';

/** A story's own reset. Takes nothing and returns nothing: whatever state it
 *  closes over is the state it owns. */
export type Resettable = () => void;

/**
 * The fields SC-002 permits to differ between the first-frame snapshot and the
 * one taken a frame after a restart: the session counters, which accumulate
 * across a session rather than belonging to a run. Exported as one constant so
 * `008` adds `completions` here rather than at every comparison site
 * (spec Assumptions), and so US4's smoke assertion reads it instead of
 * restating it (FR-019).
 */
export const RESTART_EXEMPT_FIELDS: readonly string[] = [
  'combat.deaths',
  'combat.restarts',
  // Not a `__diag` field at this spec's landing: the harness measures elapsed
  // wall-clock itself, and names it here so the set is complete as declared.
  'elapsedMs',
];

/** What one reset did. `failed` names any resettable that threw, so a broken
 *  reset is reported rather than silently skipping the ones behind it. */
export interface ResetOutcome {
  readonly performed: boolean;
  readonly restarts: number;
  readonly failed: readonly string[];
}

const resettables = new Map<string, Resettable>();

let restarts = 0;
let resetting = false;
let requested = false;

/**
 * Registers `reset` under `name`, replacing any previous registration of that
 * name. Replacing rather than appending matters because a system may register on
 * every setup, and two copies of one reset is one reset run twice.
 */
export function registerResettable(name: string, reset: Resettable): void {
  resettables.set(name, reset);
}

/** The registered names, in registration order. For tests and diagnostics. */
export function registeredResettables(): readonly string[] {
  return [...resettables.keys()];
}

/** The session restart counter (FR-018). Survives every reset, by never being
 *  touched by one. */
export function restartCount(): number {
  return restarts;
}

/**
 * Runs every registered reset once (FR-011). Re-entrant calls are refused rather
 * than queued: a reset that runs mid-reset would re-run the resettables already
 * done and count a second restart for one command.
 */
export function resetRun(): ResetOutcome {
  if (resetting) return { performed: false, restarts, failed: [] };
  resetting = true;

  const failed: string[] = [];
  try {
    for (const [name, reset] of resettables) {
      // One story's broken reset must not strand the rest of the run half-reset.
      try {
        reset();
      } catch {
        failed.push(name);
      }
    }
  } finally {
    resetting = false;
  }

  restarts += 1;
  return { performed: true, restarts, failed };
}

/** The restart *command*: issuable from the dead state and while alive alike
 *  (US2-S9), and coalescing, so pressing it twice before the frame services it
 *  is one restart (Edge Cases). */
export function requestRestart(): void {
  requested = true;
}

export function restartRequested(): boolean {
  return requested;
}

/** Performs at most one reset for however many commands arrived since the last
 *  call. Called once per frame by the vitals system. */
export function serviceRestart(): ResetOutcome {
  if (!requested) return { performed: false, restarts, failed: [] };
  requested = false;
  return resetRun();
}

/** Test seam only. Production code never unregisters or rewinds the counter. */
export function resetRestartForTest(): void {
  resettables.clear();
  restarts = 0;
  resetting = false;
  requested = false;
}

export type SnapshotValue = string | number | boolean | null;

/** A flat, dotted field map, so SC-002's "field for field" comparison is a plain
 *  key walk and the exempt set is a list of names rather than a shape. */
export type RunSnapshot = Readonly<Record<string, SnapshotValue>>;

/**
 * The comparable field set (US2-S8): the run state this story's scenarios name —
 * health, per-weapon ammo, active weapon, score, position, facing, keys, doors
 * open, secrets found, pickups collected, treasure found and every guard's state
 * — plus the session counters, which are present so the exemption is a
 * declaration rather than an omission.
 *
 * Presentation is deliberately absent. `muzzleFlash` and `hudReady` are US4's
 * render facts rather than run state, `pointerLocked` is whether the mouse is
 * captured, and `bobOffset` is a camera oscillation whose phase a teleport
 * perturbs for exactly one frame. None of them is state a restart leaks.
 */
export function snapshotRunState(diag: Diagnostics): RunSnapshot {
  const snapshot: Record<string, SnapshotValue> = {};

  const combat = diag.combat;
  if (combat != null) {
    snapshot['combat.weapon'] = combat.weapon;
    snapshot['combat.ammo.pistol'] = combat.ammo.pistol;
    snapshot['combat.ammo.smg'] = combat.ammo.smg;
    snapshot['combat.ammo.chaingun'] = combat.ammo.chaingun;
    snapshot['combat.health'] = combat.health;
    snapshot['combat.score'] = combat.score;
    snapshot['combat.shotsFired'] = combat.shotsFired;
    snapshot['combat.hits'] = combat.hits;
    snapshot['combat.kills'] = combat.kills;
    snapshot['combat.pickupsCollected'] = combat.pickupsCollected;
    snapshot['combat.pickupsTotal'] = combat.pickupsTotal;
    snapshot['combat.treasureFound'] = combat.treasureFound;
    snapshot['combat.treasureTotal'] = combat.treasureTotal;
    snapshot['combat.dead'] = combat.dead;
    snapshot['combat.deaths'] = combat.deaths;
    snapshot['combat.restarts'] = combat.restarts;
  }

  const player = diag.player;
  if (player != null) {
    snapshot['player.x'] = player.x;
    snapshot['player.z'] = player.z;
    snapshot['player.yaw'] = player.yaw;
    snapshot['player.pitch'] = player.pitch;
    snapshot['player.stuck'] = player.stuck;
  }

  const interaction = diag.interaction;
  if (interaction != null) {
    snapshot['interaction.doorsTotal'] = interaction.doorsTotal;
    snapshot['interaction.doorsOpen'] = interaction.doorsOpen;
    snapshot['interaction.secretsFound'] = interaction.secretsFound;
    snapshot['interaction.secretsTotal'] = interaction.secretsTotal;
    snapshot['interaction.keys.silver'] = interaction.keys.silver;
    snapshot['interaction.keys.gold'] = interaction.keys.gold;
  }

  snapshot['enemiesAlive'] = diag.enemiesAlive;
  snapshot['enemies.length'] = diag.enemies.length;
  diag.enemies.forEach((record, index) => {
    // Per guard, so "every guard is alive at its spawn tile in `idle`" is a
    // field-for-field claim rather than a count that a dead guard could satisfy.
    snapshot[`enemies.${index}.state`] = record.state;
  });

  return snapshot;
}

/**
 * The names on which two snapshots differ, ignoring `exempt` — sorted, so a
 * failure cites the same field every run (FR-019). A field present in one
 * snapshot and absent from the other differs too: a missing field is a leak of
 * the loudest kind.
 */
export function diffSnapshots(
  before: RunSnapshot,
  after: RunSnapshot,
  exempt: readonly string[] = RESTART_EXEMPT_FIELDS,
): string[] {
  const skip = new Set(exempt);
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const offending: string[] = [];
  for (const field of fields) {
    if (skip.has(field)) continue;
    if (!Object.is(before[field], after[field])) offending.push(field);
  }
  return offending.sort();
}
