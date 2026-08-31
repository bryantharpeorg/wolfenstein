import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUN_STATES, type RunState } from '../../src/run/state';
import {
  damageApplies,
  guardsMayFire,
  guardsMayMove,
  playerMayFire,
  RUN_GATES,
} from '../../src/run/gating';

// T003 (FR-003, US1-S5). The four predicates a completed run is stopped *by*.
// FR-003 stops actors, not frames: the module may therefore only answer
// questions — nothing in it may reach the loop that would be the naive way to
// stop a guard.

const GATES = [
  ['guardsMayMove', guardsMayMove],
  ['guardsMayFire', guardsMayFire],
  ['damageApplies', damageApplies],
  ['playerMayFire', playerMayFire],
] as const;

describe('the run gating predicates (FR-003)', () => {
  it('permits all four in playing', () => {
    for (const [name, gate] of GATES) expect(gate('playing'), name).toBe(true);
  });

  it('refuses all four in complete (US1-S5)', () => {
    for (const [name, gate] of GATES) expect(gate('complete'), name).toBe(false);
  });

  it('answers every declared run state with a boolean, never undefined', () => {
    for (const state of RUN_STATES) {
      for (const [name, gate] of GATES) {
        expect(typeof gate(state), `${name}(${state})`).toBe('boolean');
      }
    }
    // An unknown state is refused rather than silently permitted.
    for (const [, gate] of GATES) expect(gate('nonsense' as RunState)).toBe(false);
  });

  it('lets the world run while the lift travels, and stops a dead player firing', () => {
    expect(guardsMayMove('exiting')).toBe(true);
    expect(guardsMayFire('exiting')).toBe(true);
    // A run cannot be both won and lost (Edge Cases): the player who has already
    // stepped into the lift takes no further damage from the guards outside it.
    expect(damageApplies('exiting')).toBe(false);
    expect(playerMayFire('exiting')).toBe(true);
    expect(playerMayFire('dead')).toBe(false);
    expect(damageApplies('dead')).toBe(false);
    expect(guardsMayMove('dead')).toBe(true);
  });

  it('is a pure function of the state it is handed', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(guardsMayMove('complete')).toBe(false);
      expect(guardsMayMove('playing')).toBe(true);
    }
  });

  it('declares one gate table, so a fifth caller reads the same fact', () => {
    expect(Object.keys(RUN_GATES).sort()).toEqual(
      ['damageApplies', 'guardsMayFire', 'guardsMayMove', 'playerMayFire'].sort(),
    );
    for (const state of RUN_STATES) {
      expect(RUN_GATES.guardsMayMove(state)).toBe(guardsMayMove(state));
    }
  });
});

describe('nothing in the gating module can stop the frame loop (FR-003)', () => {
  const source = readFileSync(fileURLToPath(new URL('../../src/run/gating.ts', import.meta.url)), 'utf8');

  it('names no loop, renderer or registry control', () => {
    for (const identifier of [
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'collectSystems',
      'defineSystem',
      'resetSystemsForTest',
      'renderer',
      'render(',
      'process.exit',
      'throw',
    ]) {
      expect(source.includes(identifier), `gating.ts names ${identifier}`).toBe(false);
    }
  });

  it('imports nothing but the run states it switches on', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./state']);
  });
});
