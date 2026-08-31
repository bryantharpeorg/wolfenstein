import { describe, it, expect, beforeEach } from 'vitest';
import { createDiagnostics } from '../../src/diag/diag';
import {
  COMBAT_DIAGNOSTIC_FIELDS,
  createCombatDiagnostics,
  ensureCombatDiag,
  publishAmmo,
} from '../../src/combat/combat-diag';
import {
  RUN_COMMANDS_RESOLVE_DEFAULT,
  commandsResolve,
  resetRunState,
  setCommandsResolve,
} from '../../src/combat/run-state';
import { DEFAULT_WEAPON, WEAPON_KINDS, WEAPON_TABLE } from '../../src/combat/weapons';

// FR-018 / US1-S1. US1 declares the *whole* combat diagnostics shape so US2, US3
// and US4 write into fields that already exist rather than four stories editing
// one file. The smoke harness owns the assertion that the running page publishes
// it (US4, FR-019); what is assertable here is that the shape is complete, that
// it starts zeroed, and that attaching it renames nothing 001-006 owns.

describe('the combat diagnostics shape (FR-018)', () => {
  it('declares every field FR-018 lists and nothing else', () => {
    expect([...COMBAT_DIAGNOSTIC_FIELDS].sort()).toEqual(
      [
        'ammo',
        'dead',
        'deaths',
        'health',
        'hits',
        'hudReady',
        'kills',
        'muzzleFlash',
        'pickupsCollected',
        'pickupsTotal',
        'restarts',
        'score',
        'shotsFired',
        'treasureFound',
        'treasureTotal',
        'weapon',
      ].sort(),
    );
    expect(Object.keys(createCombatDiagnostics()).sort()).toEqual(
      [...COMBAT_DIAGNOSTIC_FIELDS].sort(),
    );
  });

  it('starts zeroed, with an ammo entry per declared weapon', () => {
    const combat = createCombatDiagnostics();
    expect(combat.weapon).toBe(DEFAULT_WEAPON);
    expect(Object.keys(combat.ammo).sort()).toEqual([...WEAPON_KINDS].sort());
    for (const kind of WEAPON_KINDS) expect(combat.ammo[kind]).toBe(0);
    for (const field of [
      'health',
      'score',
      'shotsFired',
      'hits',
      'kills',
      'pickupsCollected',
      'pickupsTotal',
      'treasureFound',
      'treasureTotal',
      'deaths',
      'restarts',
      'muzzleFlash',
    ] as const) {
      expect(combat[field], field).toBe(0);
    }
    expect(combat.dead).toBe(false);
    expect(combat.hudReady).toBe(false);
  });

  it('attaches additively and idempotently, renaming no 001-006 field', () => {
    const diag = createDiagnostics('webgl');
    const before = Object.keys(diag).sort();
    const combat = ensureCombatDiag(diag);
    expect(diag.combat).toBe(combat);
    // A second call returns the same object rather than replacing it, so three
    // systems may each ensure it without resetting each other's writes.
    combat.kills = 3;
    expect(ensureCombatDiag(diag)).toBe(combat);
    expect(diag.combat?.kills).toBe(3);
    expect(Object.keys(diag).sort()).toEqual([...before, 'combat'].sort());
  });

  it('publishes ammo by copy, so the diagnostics object never aliases the magazine', () => {
    const combat = createCombatDiagnostics();
    const magazine = { pistol: 1, smg: 2, chaingun: 3 };
    publishAmmo(combat, magazine);
    expect(combat.ammo).toEqual(magazine);
    magazine.pistol = WEAPON_TABLE.pistol.ammoCapacity;
    expect(combat.ammo.pistol).toBe(1);
  });
});

describe('the run-state gate (FR-008, FR-010, US1-S10)', () => {
  beforeEach(() => resetRunState());

  it('resolves player commands by default', () => {
    expect(RUN_COMMANDS_RESOLVE_DEFAULT).toBe(true);
    expect(commandsResolve()).toBe(true);
  });

  it('closes and reopens through the one setter, so death has one place to close it', () => {
    setCommandsResolve(false);
    expect(commandsResolve()).toBe(false);
    setCommandsResolve(true);
    expect(commandsResolve()).toBe(true);
  });

  it('returns to the default on reset, which is what restart needs', () => {
    setCommandsResolve(false);
    resetRunState();
    expect(commandsResolve()).toBe(RUN_COMMANDS_RESOLVE_DEFAULT);
  });
});
