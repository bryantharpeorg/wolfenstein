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
  FOOTSTEP_STRIDE_UNITS, MAX_FOOTSTEPS_PER_STEP, createFootstepCadence,
  gunfireForResolvedShots, soundForDoorTransition, soundForInteractOutcome, soundForShot,
  stepFootstepCadence,
} from '../../src/audio/triggers';

// T027 (FR-011, US3-S4). The trigger is the resolved event, never the key that asked
// for it: a shot refused for ammo is silent, a door that refused the command is
// silent, and the cadence accumulates distance travelled, so a player walking into a
// wall is silent however long the key is held.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

describe('the resolved shot', () => {
  it('maps each weapon to its own gunfire, and a refused shot to nothing (US3-S4)', () => {
    for (const weapon of WEAPON_KINDS) {
      for (const outcome of ['guard', 'wall', 'none'] as const) {
        expect(soundForShot({ weapon, outcome })).toBe(gunfireSoundFor(weapon));
      }
      expect(soundForShot({ weapon, outcome: 'out-of-ammo' })).toBeNull();
    }
  });

  it('names no key code and no input binding', () => {
    const source = readFileSync(resolve(SRC, 'audio/triggers.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(source).not.toMatch(/\b(keydown|keyup|KeyboardEvent|ControlLeft|Digit1|held)\b/);
  });

  it('names one gunfire per shot the gate resolved, and none for a frame with none', () => {
    expect(gunfireForResolvedShots('smg', 3, 8)).toEqual(['gunfire-smg', 'gunfire-smg', 'gunfire-smg']);
    for (const weapon of WEAPON_KINDS) {
      for (const shots of [0, -2, Number.NaN]) expect(gunfireForResolvedShots(weapon, shots, 8)).toEqual([]);
    }
    expect(gunfireForResolvedShots('chaingun', 40, 4)).toHaveLength(4);
    expect(gunfireForResolvedShots('chaingun', 40, 0)).toEqual([]);
  });
});

describe('the resolved door', () => {
  it('sounds when a leaf starts moving, and not when one arrives or stays put', () => {
    expect(soundForDoorTransition({ from: 'closed', to: 'opening' })).toBe('door');
    expect(soundForDoorTransition({ from: 'open', to: 'closing' })).toBe('door');
    expect(soundForDoorTransition({ from: 'closing', to: 'opening' })).toBe('door');
    expect(soundForDoorTransition({ from: 'opening', to: 'open' })).toBeNull();
    expect(soundForDoorTransition({ from: 'closing', to: 'closed' })).toBeNull();
    // A blocked door is one that did not move at all, and every declared state
    // answers rather than throwing (US3-S4).
    for (const state of DOOR_STATES) {
      expect(soundForDoorTransition({ from: state as DoorState, to: state as DoorState })).toBeNull();
      expect(soundForDoorTransition({ from: 'closed', to: state as DoorState })).toBeTypeOf(
        state === 'opening' || state === 'closing' ? 'string' : 'object',
      );
    }
  });

  it('sounds only for the command a door accepted, and for no refusal (US3-S4)', () => {
    expect(soundForInteractOutcome('opened')).toBe('door');
    const refusals = INTERACT_OUTCOMES.filter((outcome) => outcome !== 'opened');
    expect(refusals.length).toBeGreaterThan(0);
    for (const outcome of refusals) expect(soundForInteractOutcome(outcome)).toBeNull();
  });
});

describe('the footstep cadence', () => {
  it('declares a stride derived from the walk speed and the bob, not restated', () => {
    expect(FOOTSTEP_STRIDE_UNITS).toBeCloseTo(WALK_SPEED / BOB_FREQUENCY, 12);
    expect(FOOTSTEP_STRIDE_UNITS).toBeGreaterThan(0);
  });

  it('is silent for a player who pressed a key and travelled nowhere (US3-S4)', () => {
    const cadence = createFootstepCadence();
    for (let frame = 0; frame < 600; frame += 1) expect(stepFootstepCadence(cadence, 0)).toBe(0);
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stepFootstepCadence(cadence, bad)).toBe(0);
    }
    expect(cadence.travelledUnits).toBe(0);
  });

  it('steps once per stride travelled, carrying the remainder but capping a teleport', () => {
    const cadence = createFootstepCadence();
    let steps = 0;
    for (let i = 0; i < 40 * 8; i += 1) steps += stepFootstepCadence(cadence, FOOTSTEP_STRIDE_UNITS / 8);
    expect(steps).toBe(40);

    const partial = createFootstepCadence();
    expect(stepFootstepCadence(partial, FOOTSTEP_STRIDE_UNITS * 0.6)).toBe(0);
    expect(stepFootstepCadence(partial, FOOTSTEP_STRIDE_UNITS * 0.6)).toBe(1);
    expect(partial.travelledUnits).toBeCloseTo(FOOTSTEP_STRIDE_UNITS * 0.2, 10);

    const jump = createFootstepCadence();
    expect(stepFootstepCadence(jump, FOOTSTEP_STRIDE_UNITS * 1000)).toBe(MAX_FOOTSTEPS_PER_STEP);
    expect(jump.travelledUnits).toBeLessThan(FOOTSTEP_STRIDE_UNITS);
  });
});
