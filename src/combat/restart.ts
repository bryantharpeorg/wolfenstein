// The restart command (FR-011): a registry of resettables, the reset, the snapshot
// it is judged by, and the exempt set SC-002 names. Pure, and — the point of the file
// — with no knowledge of what it resets: FR-011 spans 004's doors and secrets, 006's
// guards, 002/003's spawn and this spec's own vitals, ammo and score, so each story
// registers its own. The command is *serviced* once per frame rather than run on
// arrival, making two presses one restart (Edge Cases).

import type { Diagnostics } from '../diag/diag';

export type Resettable = () => void;

/** The fields SC-002 permits to differ across a restart: the session counters. One
 *  constant, so `008` adds `completions` here, not at every comparison site. */
export const RESTART_EXEMPT_FIELDS: readonly string[] = [
  'combat.deaths',
  'combat.restarts',
  // Not a `__diag` field yet: the harness measures elapsed wall-clock itself.
  'elapsedMs',
];

/** `failed` names any resettable that threw. */
export interface ResetOutcome {
  readonly performed: boolean;
  readonly restarts: number;
  readonly failed: readonly string[];
}

const resettables = new Map<string, Resettable>();

let restarts = 0;
let resetting = false;
let requested = false;

/** Replaces any previous reset of that name: a system may register on every setup,
 *  and two copies is one reset run twice. */
export function registerResettable(name: string, reset: Resettable): void {
  resettables.set(name, reset);
}

export function registeredResettables(): readonly string[] {
  return [...resettables.keys()];
}

/** Survived by never being reset (FR-018). */
export function restartCount(): number {
  return restarts;
}

/** Runs every registered reset once (FR-011). Re-entrant calls are refused, not
 *  queued: a reset mid-reset would re-run what is done. */
export function resetRun(): ResetOutcome {
  if (resetting) return { performed: false, restarts, failed: [] };
  resetting = true;

  const failed: string[] = [];
  try {
    for (const [name, reset] of resettables) {
      // One broken reset must not strand the rest half-reset.
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

/** Issuable dead or alive (US2-S9), and coalescing: two presses before the frame
 *  services them are one restart (Edge Cases). */
export function requestRestart(): void {
  requested = true;
}

/** At most one reset per frame, however many commands arrived. */
export function serviceRestart(): ResetOutcome {
  if (!requested) return { performed: false, restarts, failed: [] };
  requested = false;
  return resetRun();
}

/** Test seam only. */
export function resetRestartForTest(): void {
  resettables.clear();
  restarts = 0;
  resetting = false;
  requested = false;
}

export type SnapshotValue = string | number | boolean | null;

/** A flat dotted map, so SC-002's comparison is a key walk and the exempt set a
 *  list of names rather than a shape. */
export type RunSnapshot = Readonly<Record<string, SnapshotValue>>;

/** The comparable field set (US2-S8): health, ammo, weapon, score, position,
 *  facing, keys, doors, secrets, pickups, treasure and every guard's state, plus
 *  the session counters, present so their exemption is a declaration rather than an
 *  omission. Presentation is absent — none of it is state a restart can leak. */
export function snapshotRunState(diag: Diagnostics): RunSnapshot {
  const snapshot: Record<string, SnapshotValue> = {};

  const combat = diag.combat;
  if (combat != null) {
    Object.assign(snapshot, {
      'combat.weapon': combat.weapon,
      'combat.ammo.pistol': combat.ammo.pistol,
      'combat.ammo.smg': combat.ammo.smg,
      'combat.ammo.chaingun': combat.ammo.chaingun,
      'combat.health': combat.health,
      'combat.score': combat.score,
      'combat.shotsFired': combat.shotsFired,
      'combat.hits': combat.hits,
      'combat.kills': combat.kills,
      'combat.pickupsCollected': combat.pickupsCollected,
      'combat.pickupsTotal': combat.pickupsTotal,
      'combat.treasureFound': combat.treasureFound,
      'combat.treasureTotal': combat.treasureTotal,
      'combat.dead': combat.dead,
      'combat.deaths': combat.deaths,
      'combat.restarts': combat.restarts,
    });
  }

  const player = diag.player;
  if (player != null) {
    Object.assign(snapshot, {
      'player.x': player.x,
      'player.z': player.z,
      'player.yaw': player.yaw,
      'player.pitch': player.pitch,
      'player.stuck': player.stuck,
    });
  }

  const interaction = diag.interaction;
  if (interaction != null) {
    Object.assign(snapshot, {
      'interaction.doorsTotal': interaction.doorsTotal,
      'interaction.doorsOpen': interaction.doorsOpen,
      'interaction.secretsFound': interaction.secretsFound,
      'interaction.secretsTotal': interaction.secretsTotal,
      'interaction.keys.silver': interaction.keys.silver,
      'interaction.keys.gold': interaction.keys.gold,
    });
  }

  snapshot['enemiesAlive'] = diag.enemiesAlive;
  snapshot['enemies.length'] = diag.enemies.length;
  // Per guard, so US2-S7's "alive at its spawn tile in `idle`" is a
  // field-for-field claim, not a count a dead guard could satisfy.
  diag.enemies.forEach((r, i) => (snapshot[`enemies.${i}.state`] = r.state));

  return snapshot;
}

/** The names on which two snapshots differ, ignoring `exempt` — sorted, so a
 *  failure cites the same field every run. A missing field is the loudest leak. */
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
