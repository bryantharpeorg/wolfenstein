import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DOOR_STATES, type DoorState } from '../../src/interaction/door';
import { INTERACT_OUTCOMES } from '../../src/interaction/outcomes';
import { WEAPON_KINDS } from '../../src/combat/weapons';
import { BOB_FREQUENCY, WALK_SPEED } from '../../src/player/params';
import { gunfireSoundFor } from '../../src/audio/sound-table';
import {
  FOOTSTEP_STRIDE_UNITS,
  MAX_FOOTSTEPS_PER_STEP,
  createFootstepCadence,
  soundForDoorTransition,
  soundForInteractOutcome,
  soundForShot,
  stepFootstepCadence,
} from '../../src/audio/triggers';

// T027 (FR-011, US3-S4). The trigger is the resolved event and never the key that
// asked for it: a shot refused for ammo makes no sound, a door that refused the
// command makes no sound, and the footstep cadence accumulates distance travelled,
// so a player walking into a wall is silent however long the key is held.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

describe('the resolved shot', () => {
  it('maps each weapon to its own gunfire, whatever the shot hit', () => {
    for (const weapon of WEAPON_KINDS) {
      for (const outcome of ['guard', 'wall', 'none'] as const) {
        expect(soundForShot({ weapon, outcome })).toBe(gunfireSoundFor(weapon));
      }
    }
  });

  it('is silent for a shot that was refused (US3-S4)', () => {
    for (const weapon of WEAPON_KINDS) {
      expect(soundForShot({ weapon, outcome: 'out-of-ammo' })).toBeNull();
    }
  });

  it('names no key code and no input binding', () => {
    const source = readFileSync(resolve(SRC, 'audio/triggers.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(source).not.toMatch(/\b(keydown|keyup|KeyboardEvent|ControlLeft|Digit1|held)\b/);
  });
});

describe('the door state change', () => {
  it('sounds when a leaf starts moving', () => {
    expect(soundForDoorTransition({ from: 'closed', to: 'opening' })).toBe('door');
    expect(soundForDoorTransition({ from: 'open', to: 'closing' })).toBe('door');
    expect(soundForDoorTransition({ from: 'closing', to: 'opening' })).toBe('door');
  });

  it('is silent when a leaf arrives, which started no travel', () => {
    expect(soundForDoorTransition({ from: 'opening', to: 'open' })).toBeNull();
    expect(soundForDoorTransition({ from: 'closing', to: 'closed' })).toBeNull();
  });

  it('is silent when nothing changed — a blocked door is a door that did not move', () => {
    for (const state of DOOR_STATES) {
      expect(soundForDoorTransition({ from: state, to: state })).toBeNull();
    }
  });

  it('answers every pair of declared door states without throwing', () => {
    for (const from of DOOR_STATES) {
      for (const to of DOOR_STATES) {
        const sound = soundForDoorTransition({ from: from as DoorState, to: to as DoorState });
        expect(sound === null || sound === 'door').toBe(true);
      }
    }
  });
});

describe('the resolved interact outcome', () => {
  it('sounds only for the command a door accepted', () => {
    expect(soundForInteractOutcome('opened')).toBe('door');
  });

  it('is silent for every refusal in the declared outcome set (US3-S4)', () => {
    const refusals = INTERACT_OUTCOMES.filter((outcome) => outcome !== 'opened');
    expect(refusals.length).toBeGreaterThan(0);
    for (const outcome of refusals) {
      expect(soundForInteractOutcome(outcome)).toBeNull();
    }
  });
});

describe('the footstep cadence', () => {
  it('declares a stride derived from the walk speed and the bob, not restated', () => {
    expect(FOOTSTEP_STRIDE_UNITS).toBeCloseTo(WALK_SPEED / BOB_FREQUENCY, 12);
    expect(FOOTSTEP_STRIDE_UNITS).toBeGreaterThan(0);
  });

  it('is silent for a player who pressed a key and travelled nowhere (US3-S4)', () => {
    const cadence = createFootstepCadence();
    for (let frame = 0; frame < 600; frame += 1) {
      expect(stepFootstepCadence(cadence, 0)).toBe(0);
    }
    expect(cadence.travelledUnits).toBe(0);
  });

  it('steps once per declared stride of distance travelled', () => {
    const cadence = createFootstepCadence();
    const legs = 40;
    let steps = 0;
    for (let i = 0; i < legs * 8; i += 1) {
      steps += stepFootstepCadence(cadence, FOOTSTEP_STRIDE_UNITS / 8);
    }
    expect(steps).toBe(legs);
  });

  it('carries the remainder rather than dropping it', () => {
    const cadence = createFootstepCadence();
    expect(stepFootstepCadence(cadence, FOOTSTEP_STRIDE_UNITS * 0.6)).toBe(0);
    expect(stepFootstepCadence(cadence, FOOTSTEP_STRIDE_UNITS * 0.6)).toBe(1);
    expect(cadence.travelledUnits).toBeCloseTo(FOOTSTEP_STRIDE_UNITS * 0.2, 10);
  });

  it('caps the steps one frame may fire, so a teleport is not a stampede', () => {
    const cadence = createFootstepCadence();
    expect(stepFootstepCadence(cadence, FOOTSTEP_STRIDE_UNITS * 1000))
      .toBe(MAX_FOOTSTEPS_PER_STEP);
    // The credit past the cap is dropped rather than banked into the next frame.
    expect(cadence.travelledUnits).toBeLessThan(FOOTSTEP_STRIDE_UNITS);
  });

  it('ignores a delta that is negative or not a number', () => {
    const cadence = createFootstepCadence();
    expect(stepFootstepCadence(cadence, -5)).toBe(0);
    expect(stepFootstepCadence(cadence, Number.NaN)).toBe(0);
    expect(stepFootstepCadence(cadence, Number.POSITIVE_INFINITY)).toBe(0);
    expect(cadence.travelledUnits).toBe(0);
  });

  it('resets with the run', () => {
    const cadence = createFootstepCadence();
    stepFootstepCadence(cadence, FOOTSTEP_STRIDE_UNITS * 0.9);
    const fresh = createFootstepCadence();
    expect(fresh.travelledUnits).toBe(0);
    expect(cadence.travelledUnits).toBeGreaterThan(0);
  });
});
