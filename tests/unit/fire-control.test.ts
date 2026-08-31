import { describe, it, expect } from 'vitest';
import {
  FIRE_KEY_CODES, FIRE_MOUSE_BUTTON, MAX_SHOTS_PER_STEP, createFireControl, createFireInput,
  stepFireControl, type FireControlState, type FireSource,
} from '../../src/combat/fire-control';
import type { ShotResult } from '../../src/combat/hitscan';
import {
  DEFAULT_WEAPON, WEAPON_KINDS, WEAPON_SELECT_KEY_CODES, WEAPON_SWITCH_DELAY_SECONDS,
  WEAPON_TABLE, type WeaponKind,
} from '../../src/combat/weapons';

// FR-004 / FR-007 / FR-008, US1-S4, S9, S10, S11, SC-003. Arithmetic over the
// declared table: the gate is elapsed seconds, the cost the table's, and both
// bindings collapse to one boolean before any of it.

/** A trace stub: every shot the gate lets through lands on the same guard. */
const HIT: ShotResult = { outcome: 'guard', distance: 1, guardIndex: 0, damage: 1 };
const traceHit = (): ShotResult => HIT;

const step = (state: FireControlState, deltaSeconds: number, fire = true, select?: WeaponKind) =>
  stepFireControl(state, { deltaSeconds, fire, select, trace: traceHit });

function heldFor(state: FireControlState, seconds: number, stepSeconds: number): number {
  let fired = 0;
  for (let i = 0; i < Math.round(seconds / stepSeconds); i += 1) {
    fired += step(state, stepSeconds).results.length;
  }
  return fired;
}

function armed(weapon: WeaponKind): FireControlState {
  const state = createFireControl();
  state.weapon = weapon;
  return state;
}

const implied = (kind: WeaponKind) => Math.floor(1 / WEAPON_TABLE[kind].fireIntervalSeconds);

describe('the fire-rate gate is elapsed seconds (FR-004, US1-S4, SC-003)', () => {
  it.each([...WEAPON_KINDS])('%s: 1 ms and 250 ms deltas agree within one shot', (kind) => {
    const fine = heldFor(armed(kind), 1, 0.001);
    const coarse = heldFor(armed(kind), 1, 0.25);
    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(1);
    expect(fine).toBeLessThanOrEqual(implied(kind)); // never past the declared interval
    expect(coarse).toBeLessThanOrEqual(implied(kind));

    // And one long frame is clamped rather than cashed in (Edge Cases).
    const spiked = armed(kind);
    const before = spiked.ammo[kind];
    const fired = step(spiked, 1).results.length;
    expect(fired).toBeLessThanOrEqual(implied(kind));
    expect(fired).toBeLessThanOrEqual(MAX_SHOTS_PER_STEP);
    // Ammo is spent for the shots resolved, not for the ones dropped.
    expect(spiked.ammo[kind]).toBe(before - fired * WEAPON_TABLE[kind].ammoCost);
  });

  it('fires at all, faster for a chaingun, and never on an unheld or banked frame', () => {
    const pistol = heldFor(armed('pistol'), 1, 0.001);
    expect(pistol).toBeGreaterThan(0);
    expect(heldFor(armed('chaingun'), 1, 0.001)).toBeGreaterThan(pistol);
    const idle = armed('chaingun');
    expect(step(idle, 1, false).results).toEqual([]);
    expect(idle.shotsFired).toBe(0);
    expect(step(idle, 60, false).results).toEqual([]); // an idle minute is not banked
    expect(step(idle, 0, true).results).toHaveLength(1);
  });

  it('cannot empty a magazine in one frame, and drops the backlog (Edge Cases)', () => {
    const state = armed('chaingun');
    step(state, 3600);
    expect(state.ammo.chaingun).toBeGreaterThan(0);
    expect(step(state, 0).results.length).toBeLessThanOrEqual(1);
  });
});

describe('ammo accounting (FR-007, US1-S9)', () => {
  it('spends the declared cost per shot and counts shots fired', () => {
    const state = armed('pistol');
    const before = state.ammo.pistol;
    expect(step(state, WEAPON_TABLE.pistol.fireIntervalSeconds).results).toHaveLength(1);
    expect(state.ammo.pistol).toBe(before - WEAPON_TABLE.pistol.ammoCost);
    expect(state.shotsFired).toBe(1);
  });

  it('returns out-of-ammo, traces nothing, and leaves ammo and the timer alone', () => {
    const state = armed('chaingun');
    const short = WEAPON_TABLE.chaingun.ammoCost - 1;
    state.ammo.chaingun = short;
    let traced = 0;
    const report = stepFireControl(state, {
      deltaSeconds: 1,
      fire: true,
      trace: () => {
        traced += 1;
        return HIT;
      },
    });
    expect(report.results).toEqual([{ outcome: 'out-of-ammo', distance: 0, guardIndex: -1, damage: 0 }]);
    expect(traced).toBe(0);
    expect(state.ammo.chaingun).toBe(short);
    expect(state.shotsFired).toBe(0);
    // The timer was not consumed: refilled, the next frame fires without waiting
    // another interval out.
    state.ammo.chaingun = WEAPON_TABLE.chaingun.ammoCost;
    expect(step(state, 0).results.map((r) => r.outcome)).toEqual(['guard']);
  });

  it('never goes negative, and starts every weapon at the declared magazine', () => {
    const state = armed('smg');
    for (let i = 0; i < 500; i += 1) step(state, 0.25);
    expect(state.ammo.smg).toBe(0);
    for (const kind of WEAPON_KINDS) expect(state.ammo[kind]).toBeGreaterThanOrEqual(0);
    const fresh = createFireControl();
    for (const kind of WEAPON_KINDS) expect(fresh.ammo[kind]).toBe(WEAPON_TABLE[kind].startingAmmo);
    expect(fresh.weapon).toBe(DEFAULT_WEAPON);
  });
});

describe('one command path for two bindings (FR-008, US1-S10)', () => {
  it('binds Ctrl and the left mouse button to the same held flag', () => {
    expect([...FIRE_KEY_CODES].sort()).toEqual(['ControlLeft', 'ControlRight']);
    expect(FIRE_MOUSE_BUTTON).toBe(0);
    const input = createFireInput();
    expect(input.held).toBe(false);
    input.press('key');
    input.press('mouse');
    expect(input.held).toBe(true);
    input.release('key');
    expect(input.held).toBe(true); // the other binding has not been let go
    input.release('mouse');
    expect(input.held).toBe(false);
    input.press('key'); // and a focus loss forgets every binding
    input.clear();
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
});

describe('weapon selection and the declared switch delay (FR-008, US1-S11)', () => {
  it('maps the three digit keys onto the three weapons', () => {
    expect(WEAPON_SELECT_KEY_CODES).toEqual({ Digit1: 'pistol', Digit2: 'smg', Digit3: 'chaingun' });
  });

  it('resolves no shot while the switch delay runs, then fires again after it', () => {
    const state = armed('pistol');
    const pressed = step(state, 0, true, 'chaingun');
    expect(pressed.results).toEqual([]);
    expect(pressed.switching).toBe(true);
    expect(state.weapon).toBe('chaingun');
    for (let i = 0; i < 4; i += 1) {
      // four fifths of the declared delay, trigger held throughout
      const report = step(state, WEAPON_SWITCH_DELAY_SECONDS / 5);
      expect(report.switching).toBe(true);
      expect(report.results).toEqual([]);
    }
    expect(state.shotsFired).toBe(0);
    expect(state.ammo.chaingun).toBe(WEAPON_TABLE.chaingun.startingAmmo);
    const after = step(state, WEAPON_SWITCH_DELAY_SECONDS);
    expect(after.switching).toBe(false);
    expect(after.results.length).toBeGreaterThanOrEqual(1);
  });

  it('resets the in-flight interval timer for the new weapon (Edge Cases)', () => {
    const state = armed('pistol');
    step(state, WEAPON_TABLE.pistol.fireIntervalSeconds * 0.9);
    expect(state.readySeconds).toBeGreaterThan(0);
    step(state, 0, true, 'chaingun');
    expect(state.weapon).toBe('chaingun');
    expect(state.readySeconds).toBe(0);
    expect(state.switchRemaining).toBeCloseTo(WEAPON_SWITCH_DELAY_SECONDS, 12);
  });

  it('costs nothing to press the key for the weapon already held', () => {
    const state = armed('smg');
    const before = { ...state.ammo };
    const report = step(state, 0, false, 'smg');
    expect(report.results).toEqual([]);
    expect(report.switching).toBe(false);
    expect(state.ammo).toEqual(before);
    expect(state.shotsFired).toBe(0);
    // Nor did it cost the interval timer: the next interval still fires.
    expect(step(state, WEAPON_TABLE.smg.fireIntervalSeconds).results).toHaveLength(1);
  });
});
