// T015 (FR-011; US2-S6..S9, SC-002, Edge Cases): the reset registry, the snapshot
// restart is judged by, and the coalescing that makes a doubled command
// idempotent. `restart.ts` must not know what a door or a guard is, which this
// file proves by registering fixtures rather than another spec's module.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESTART_EXEMPT_FIELDS,
  diffSnapshots,
  registerResettable,
  registeredResettables,
  requestRestart,
  resetRestartForTest,
  resetRun,
  restartCount,
  serviceRestart,
  snapshotRunState,
} from '../../src/combat/restart';
import { createDiagnostics, type Diagnostics } from '../../src/diag/diag';
import { ensureCombatDiag } from '../../src/combat/combat-diag';
import { ensurePlayerDiag } from '../../src/player/diag-player';
import { ensureInteractionDiag } from '../../src/interaction/interaction-diag';
import { MAX_HEALTH } from '../../src/combat/vitals';
import { startingAmmo, DEFAULT_WEAPON } from '../../src/combat/weapons';

/** Diagnostics standing where a first frame left them. */
function spawnDiag(): Diagnostics {
  const diag = createDiagnostics('webgl');
  const combat = ensureCombatDiag(diag);
  combat.health = MAX_HEALTH;
  combat.ammo = startingAmmo();
  combat.weapon = DEFAULT_WEAPON;
  combat.pickupsTotal = 12;
  combat.treasureTotal = 3;

  const player = ensurePlayerDiag(diag);
  player.x = 10.5;
  player.z = 10.5;
  player.yaw = 0;

  const interaction = ensureInteractionDiag(diag);
  interaction.doorsTotal = 4;
  interaction.secretsTotal = 2;

  diag.enemies = [
    { state: 'idle', viewAngle: 0, pathable: true },
    { state: 'idle', viewAngle: 0, pathable: true },
  ];
  diag.enemiesAlive = 2;
  return diag;
}

/** Everything a played-out run would have moved away from spawn. */
function playOut(diag: Diagnostics): void {
  const combat = diag.combat!;
  combat.health = 0;
  combat.score = 700;
  combat.ammo = { pistol: 3, smg: 0, chaingun: 40 };
  combat.weapon = 'chaingun';
  combat.shotsFired = 31;
  combat.hits = 9;
  combat.kills = 1;
  combat.pickupsCollected = 4;
  combat.treasureFound = 2;
  combat.dead = true;

  const player = diag.player!;
  player.x = 3.25;
  player.z = 18.75;
  player.yaw = 1.4;
  player.pitch = -0.2;

  const interaction = diag.interaction!;
  interaction.doorsOpen = 2;
  interaction.secretsFound = 1;
  interaction.keys = { silver: 1, gold: 1 };

  diag.enemies = [
    { state: 'death', viewAngle: 2, pathable: true },
    { state: 'chase', viewAngle: 1, pathable: false },
  ];
  diag.enemiesAlive = 1;
}

beforeEach(() => {
  resetRestartForTest();
});

describe('the reset registry (FR-011)', () => {
  it('runs every registered resettable, in registration order', () => {
    const ran: string[] = [];
    registerResettable('doors', () => ran.push('doors'));
    registerResettable('guards', () => ran.push('guards'));
    registerResettable('pickups', () => ran.push('pickups'));

    expect(registeredResettables()).toEqual(['doors', 'guards', 'pickups']);
    expect(resetRun().performed).toBe(true);
    expect(ran).toEqual(['doors', 'guards', 'pickups']);
  });

  it('replaces a resettable registered twice under one name, rather than running both', () => {
    let runs = 0;
    registerResettable('doors', () => {
      runs += 1;
    });
    registerResettable('doors', () => {
      runs += 10;
    });
    resetRun();
    expect(registeredResettables()).toEqual(['doors']);
    expect(runs).toBe(10);
  });

  it('runs the rest even when one resettable throws, and reports the failure', () => {
    const ran: string[] = [];
    registerResettable('bad', () => {
      throw new Error('nope');
    });
    registerResettable('good', () => ran.push('good'));
    const outcome = resetRun();
    expect(ran).toEqual(['good']);
    expect(outcome.performed).toBe(true);
    expect(outcome.failed).toEqual(['bad']);
  });
});

describe('the run-state snapshot (US2-S8, SC-002)', () => {
  it('names the state fields the story is judged on', () => {
    const snapshot = snapshotRunState(spawnDiag());
    for (const field of [
      'combat.health', 'combat.score', 'combat.weapon', 'combat.ammo.pistol',
      'combat.ammo.smg', 'combat.ammo.chaingun', 'combat.dead', 'combat.deaths',
      'combat.restarts', 'combat.pickupsCollected', 'combat.treasureFound',
      'player.x', 'player.z', 'player.yaw', 'player.pitch',
      'interaction.doorsOpen', 'interaction.secretsFound',
      'interaction.keys.silver', 'interaction.keys.gold',
      'enemiesAlive', 'enemies.0.state', 'enemies.1.state',
    ]) {
      expect(Object.keys(snapshot), `missing ${field}`).toContain(field);
    }
  });

  it('deep-equals a snapshot of the same state, field for field', () => {
    const diag = spawnDiag();
    expect(diffSnapshots(snapshotRunState(diag), snapshotRunState(diag))).toEqual([]);
  });

  it('names every field that differs, so a leak is cited rather than counted', () => {
    const diag = spawnDiag();
    const before = snapshotRunState(diag);
    playOut(diag);
    const offending = diffSnapshots(before, snapshotRunState(diag));
    expect(offending).toContain('combat.health');
    expect(offending).toContain('interaction.doorsOpen');
    expect(offending).toContain('interaction.secretsFound');
    expect(offending).toContain('enemiesAlive');
    expect(offending).toContain('enemies.0.state');
    expect(offending).toContain('player.x');
  });

  it('exempts the session counters, declared once for 008 to extend', () => {
    // 008 US2 extended it, as this test's name anticipated: `run.completions` is a
    // session counter on the same footing as the two above (008 FR-007).
    expect([...RESTART_EXEMPT_FIELDS]).toEqual([
      'combat.deaths',
      'combat.restarts',
      'run.completions',
      'elapsedMs',
    ]);

    const diag = spawnDiag();
    const before = snapshotRunState(diag);
    diag.combat!.deaths = 3;
    diag.combat!.restarts = 3;
    expect(diffSnapshots(before, snapshotRunState(diag))).toEqual([]);
    // A declaration, not a blanket: pass an empty set and both are reported.
    expect(diffSnapshots(before, snapshotRunState(diag), [])).toEqual([
      'combat.deaths',
      'combat.restarts',
    ]);
  });
});

describe('a full reset returns the run to spawn (US2-S6, US2-S7, US2-S9)', () => {
  it('equals the first-frame snapshot except the exempt counters', () => {
    const diag = spawnDiag();
    const spawn = snapshotRunState(diag);
    const restore = (): void => {
      const restored = spawnDiag();
      diag.combat = restored.combat;
      diag.player = restored.player;
      diag.interaction = restored.interaction;
      diag.enemies = restored.enemies;
      diag.enemiesAlive = restored.enemiesAlive;
      // The session counters are this spec's to preserve, not the registry's.
      diag.combat!.deaths = 1;
      diag.combat!.restarts = restartCount() + 1;
    };
    registerResettable('everything', restore);

    playOut(diag);
    expect(diffSnapshots(spawn, snapshotRunState(diag)).length).toBeGreaterThan(0);

    resetRun();
    expect(diffSnapshots(spawn, snapshotRunState(diag))).toEqual([]);
  });

  it('performs the same reset from an alive run as from a dead one (US2-S9)', () => {
    let resets = 0;
    registerResettable('count', () => {
      resets += 1;
    });
    // Nothing says whether the run was over: the registry has no notion of
    // death, which is why restart is not exclusive to it.
    resetRun();
    resetRun();
    expect(resets).toBe(2);
  });
});

describe('restart is idempotent within a frame (US2-S8, Edge Cases)', () => {
  it('counts one restart per completed reset', () => {
    registerResettable('noop', () => {});
    expect(restartCount()).toBe(0);
    expect(resetRun().restarts).toBe(1);
    expect(resetRun().restarts).toBe(2);
    expect(restartCount()).toBe(2);
  });

  it('collapses two commands issued before the frame services them', () => {
    let resets = 0;
    registerResettable('count', () => {
      resets += 1;
    });

    requestRestart();
    requestRestart();
    requestRestart();
    const outcome = serviceRestart();
    expect(outcome.performed).toBe(true);
    expect(resets).toBe(1);
    expect(restartCount()).toBe(1);

    // The frame after: no command outstanding, so no second reset.
    const idle = serviceRestart();
    expect(idle.performed).toBe(false);
    expect(resets).toBe(1);
    expect(restartCount()).toBe(1);
  });

  it('does not re-enter: a resettable that asks for a reset does not get one mid-reset', () => {
    let resets = 0;
    registerResettable('recursive', () => {
      resets += 1;
      if (resets < 5) expect(resetRun().performed).toBe(false);
    });
    expect(resetRun().performed).toBe(true);
    expect(resets).toBe(1);
    expect(restartCount()).toBe(1);
  });
});
