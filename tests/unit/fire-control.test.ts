import { describe, it, expect } from 'vitest';
import {
  FIRE_KEY_CODES,
  FIRE_MOUSE_BUTTON,
  MAX_SHOTS_PER_STEP,
  createFireControl,
  createFireInput,
  stepFireControl,
  type FireControlState,
  type FireSource,
} from '../../src/combat/fire-control';
import type { ShotResult } from '../../src/combat/hitscan';
import {
  DEFAULT_WEAPON,
  WEAPON_KINDS,
  WEAPON_SELECT_KEY_CODES,
  WEAPON_SWITCH_DELAY_SECONDS,
  WEAPON_TABLE,
  type WeaponKind,
} from '../../src/combat/weapons';

// FR-004 / FR-007 / FR-008 and US1-S4, S9, S10, S11 plus SC-003. Everything here
// is arithmetic over the declared table: the gate is elapsed seconds, the cost is
// the table's, and the two fire bindings collapse to one boolean before any of it.

/** A trace stub: every shot the gate lets through lands on the same imaginary guard. */
const HIT: ShotResult = { outcome: 'guard', distance: 1, guardIndex: 0, damage: 1 };
const traceHit = (): ShotResult => HIT;

function heldFor(
  state: FireControlState,
  totalSeconds: number,
  stepSeconds: number,
): ShotResult[] {
  const results: ShotResult[] = [];
  const steps = Math.round(totalSeconds / stepSeconds);
  for (let i = 0; i < steps; i += 1) {
    results.push(...stepFireControl(state, { deltaSeconds: stepSeconds, fire: true, trace: traceHit }).results);
  }
  return results;
}

function armed(weapon: WeaponKind): FireControlState {
  const state = createFireControl();
  state.weapon = weapon;
  return state;
}

describe('the fire-rate gate is elapsed seconds (FR-004, US1-S4, SC-003)', () => {
  it.each([...WEAPON_KINDS])(
    '%s fires within one shot of itself at 1 ms and at 250 ms deltas',
    (kind) => {
      const fine = heldFor(armed(kind), 1, 0.001).length;
      const coarse = heldFor(armed(kind), 1, 0.25).length;
      expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(1);
    },
  );

  it.each([...WEAPON_KINDS])('%s never exceeds the count its interval implies', (kind) => {
    const implied = Math.floor(1 / WEAPON_TABLE[kind].fireIntervalSeconds);
    expect(heldFor(armed(kind), 1, 0.001).length).toBeLessThanOrEqual(implied);
    expect(heldFor(armed(kind), 1, 0.25).length).toBeLessThanOrEqual(implied);
  });

  it('actually fires: a held second is more than zero shots and more for a chaingun', () => {
    const pistol = heldFor(armed('pistol'), 1, 0.001).length;
    const chaingun = heldFor(armed('chaingun'), 1, 0.001).length;
    expect(pistol).toBeGreaterThan(0);
    expect(chaingun).toBeGreaterThan(pistol);
  });

  it('resolves nothing on a frame where the command is not held', () => {
    const state = armed('chaingun');
    const report = stepFireControl(state, { deltaSeconds: 1, fire: false, trace: traceHit });
    expect(report.results).toEqual([]);
    expect(state.shotsFired).toBe(0);
  });

  it('does not bank an idle minute into a burst on the first press', () => {
    const state = armed('chaingun');
    stepFireControl(state, { deltaSeconds: 60, fire: false, trace: traceHit });
    const report = stepFireControl(state, { deltaSeconds: 0, fire: true, trace: traceHit });
    expect(report.results).toHaveLength(1);
  });
});

describe('a delta spike is clamped, not cashed in (FR-004, Edge Cases)', () => {
  it.each([...WEAPON_KINDS])('%s resolves at most what one long frame allows', (kind) => {
    const weapon = WEAPON_TABLE[kind];
    const state = armed(kind);
    const before = state.ammo[kind];
    const report = stepFireControl(state, { deltaSeconds: 1, fire: true, trace: traceHit });

    const implied = Math.floor(1 / weapon.fireIntervalSeconds);
    expect(report.results.length).toBeLessThanOrEqual(implied);
    expect(report.results.length).toBeLessThanOrEqual(MAX_SHOTS_PER_STEP);
    // Ammo is spent for each shot the frame did resolve, not for the ones it dropped.
    expect(state.ammo[kind]).toBe(before - report.results.length * weapon.ammoCost);
  });

  it('cannot empty a magazine in one frame', () => {
    const state = armed('chaingun');
    stepFireControl(state, { deltaSeconds: 3600, fire: true, trace: traceHit });
    expect(state.ammo.chaingun).toBeGreaterThan(0);
  });

  it('drops the backlog rather than carrying it into the next frame', () => {
    const state = armed('chaingun');
    stepFireControl(state, { deltaSeconds: 3600, fire: true, trace: traceHit });
    const next = stepFireControl(state, { deltaSeconds: 0, fire: true, trace: traceHit });
    expect(next.results.length).toBeLessThanOrEqual(1);
  });
});

describe('ammo accounting (FR-007, US1-S9)', () => {
  it('spends the declared cost per shot and counts shots fired', () => {
    const state = armed('pistol');
    const before = state.ammo.pistol;
    const report = stepFireControl(state, {
      deltaSeconds: WEAPON_TABLE.pistol.fireIntervalSeconds,
      fire: true,
      trace: traceHit,
    });
    expect(report.results).toHaveLength(1);
    expect(state.ammo.pistol).toBe(before - WEAPON_TABLE.pistol.ammoCost);
    expect(state.shotsFired).toBe(1);
  });

  it('returns out-of-ammo, traces nothing and leaves ammo and the timer alone', () => {
    const state = armed('chaingun');
    state.ammo.chaingun = WEAPON_TABLE.chaingun.ammoCost - 1;
    let traced = 0;
    const report = stepFireControl(state, {
      deltaSeconds: 1,
      fire: true,
      trace: () => {
        traced += 1;
        return HIT;
      },
    });

    expect(report.results.map((r) => r.outcome)).toEqual(['out-of-ammo']);
    expect(report.results[0]).toEqual({
      outcome: 'out-of-ammo',
      distance: 0,
      guardIndex: -1,
      damage: 0,
    });
    expect(traced).toBe(0);
    expect(state.ammo.chaingun).toBe(WEAPON_TABLE.chaingun.ammoCost - 1);
    expect(state.shotsFired).toBe(0);

    // The interval timer was not consumed: refilled, the very next frame fires
    // without waiting another interval out.
    state.ammo.chaingun = WEAPON_TABLE.chaingun.ammoCost;
    const next = stepFireControl(state, { deltaSeconds: 0, fire: true, trace: traceHit });
    expect(next.results.map((r) => r.outcome)).toEqual(['guard']);
  });

  it('never lets a count go negative, however long the trigger is held', () => {
    const state = armed('smg');
    for (let i = 0; i < 500; i += 1) {
      stepFireControl(state, { deltaSeconds: 0.25, fire: true, trace: traceHit });
    }
    expect(state.ammo.smg).toBe(0);
    for (const kind of WEAPON_KINDS) expect(state.ammo[kind]).toBeGreaterThanOrEqual(0);
  });

  it('starts every weapon at the magazine the table declares', () => {
    const state = createFireControl();
    for (const kind of WEAPON_KINDS) expect(state.ammo[kind]).toBe(WEAPON_TABLE[kind].startingAmmo);
    expect(state.weapon).toBe(DEFAULT_WEAPON);
  });
});

describe('one command path for two bindings (FR-008, US1-S10)', () => {
  it('binds Ctrl and the left mouse button to the same held flag', () => {
    expect([...FIRE_KEY_CODES].sort()).toEqual(['ControlLeft', 'ControlRight']);
    expect(FIRE_MOUSE_BUTTON).toBe(0);

    const input = createFireInput();
    expect(input.held).toBe(false);
    input.press('key');
    expect(input.held).toBe(true);
    input.press('mouse');
    expect(input.held).toBe(true);
    input.release('key');
    // Still held: the other binding has not been let go.
    expect(input.held).toBe(true);
    input.release('mouse');
    expect(input.held).toBe(false);
  });

  it('resolves exactly one shot when both bindings are pressed on one frame', () => {
    const input = createFireInput();
    const sources: FireSource[] = ['key', 'mouse'];
    for (const source of sources) input.press(source);

    const state = armed('pistol');
    const report = stepFireControl(state, {
      deltaSeconds: WEAPON_TABLE.pistol.fireIntervalSeconds,
      fire: input.held,
      trace: traceHit,
    });
    expect(report.results).toHaveLength(1);
    expect(state.shotsFired).toBe(1);
  });

  it('forgets every binding on a focus loss, so a held key cannot stick', () => {
    const input = createFireInput();
    input.press('key');
    input.clear();
    expect(input.held).toBe(false);
  });
});

describe('weapon selection and the declared switch delay (FR-008, US1-S11)', () => {
  it('maps the three digit keys onto the three weapons', () => {
    expect(WEAPON_SELECT_KEY_CODES.Digit1).toBe('pistol');
    expect(WEAPON_SELECT_KEY_CODES.Digit2).toBe('smg');
    expect(WEAPON_SELECT_KEY_CODES.Digit3).toBe('chaingun');
  });

  it('resolves no shot while the switch delay runs, then fires again after it', () => {
    const state = armed('pistol');
    const step = WEAPON_SWITCH_DELAY_SECONDS / 5;

    // The press itself, on a frame where no time passes.
    const pressed = stepFireControl(state, {
      deltaSeconds: 0,
      fire: true,
      select: 'chaingun',
      trace: traceHit,
    });
    expect(pressed.results).toEqual([]);
    expect(pressed.switching).toBe(true);
    expect(state.weapon).toBe('chaingun');

    // Four fifths of the declared delay, trigger held throughout.
    for (let i = 0; i < 4; i += 1) {
      const report = stepFireControl(state, { deltaSeconds: step, fire: true, trace: traceHit });
      expect(report.switching).toBe(true);
      expect(report.results).toEqual([]);
    }
    expect(state.shotsFired).toBe(0);
    expect(state.ammo.chaingun).toBe(WEAPON_TABLE.chaingun.startingAmmo);

    // Past the delay, the same held trigger resolves shots again.
    const after = stepFireControl(state, {
      deltaSeconds: WEAPON_SWITCH_DELAY_SECONDS,
      fire: true,
      trace: traceHit,
    });
    expect(after.switching).toBe(false);
    expect(after.results.length).toBeGreaterThanOrEqual(1);
  });

  it('resets the in-flight interval timer for the new weapon', () => {
    const state = armed('pistol');
    // Most of a pistol interval banked toward a pistol shot ...
    stepFireControl(state, {
      deltaSeconds: WEAPON_TABLE.pistol.fireIntervalSeconds * 0.9,
      fire: true,
      trace: traceHit,
    });
    expect(state.readySeconds).toBeGreaterThan(0);

    // ... and none of it survives the switch (Edge Cases).
    stepFireControl(state, { deltaSeconds: 0, fire: true, select: 'chaingun', trace: traceHit });
    expect(state.weapon).toBe('chaingun');
    expect(state.readySeconds).toBe(0);
    expect(state.switchRemaining).toBeCloseTo(WEAPON_SWITCH_DELAY_SECONDS, 12);
  });

  it('costs nothing to press the key for the weapon already held', () => {
    const state = armed('smg');
    const before = { ...state.ammo };
    const report = stepFireControl(state, {
      deltaSeconds: 0,
      fire: false,
      select: 'smg',
      trace: traceHit,
    });
    expect(report.results).toEqual([]);
    expect(report.switching).toBe(false);
    expect(state.ammo).toEqual(before);
    expect(state.shotsFired).toBe(0);

    // And it did not cost the interval timer either: a held trigger still fires
    // on the next interval rather than waiting a switch delay out.
    const next = stepFireControl(state, {
      deltaSeconds: WEAPON_TABLE.smg.fireIntervalSeconds,
      fire: true,
      trace: traceHit,
    });
    expect(next.results).toHaveLength(1);
  });
});
