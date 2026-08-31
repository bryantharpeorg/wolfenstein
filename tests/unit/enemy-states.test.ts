import { describe, it, expect } from 'vitest';
import {
  GUARD_STATES, GUARD_SPAWN_STATE, GUARD_TRANSITIONS, transitionsFrom, firstTransition,
  ALERT_DURATION_TICKS, ATTACK_RANGE_CELLS, SHOT_COOLDOWN_TICKS, MOVE_SPEED_CELLS_PER_TICK,
  LAST_KNOWN_TIMEOUT_TICKS, PATH_REQUEST_INTERVAL_TICKS,
} from '../../src/enemy/states';
import type { GuardState, TransitionInput } from '../../src/enemy/states';
import { expectPure } from './enemy-pure';

// US1-S1, US1-S7, US1-S8, FR-001: the table is the single source of truth for
// legal edges, so it is inspected as data here — exercising it as behaviour is
// enemy-step.test.ts's job.

const input = (overrides: Partial<TransitionInput> = {}): TransitionInput => ({
  tick: 0, ticksInState: 0, hasLineOfSight: false, distanceToPlayer: 99,
  distanceToLastKnown: 99, ticksSinceLastKnown: 0, hasLastKnown: false,
  cooldownTicks: 0, lethalDamage: false, ...overrides,
});

const edge = (from: GuardState, to: GuardState) =>
  GUARD_TRANSITIONS.find((entry) => entry.from === from && entry.to === to);

const outgoing = (state: GuardState): GuardState[] =>
  GUARD_TRANSITIONS.filter((entry) => entry.from === state).map((entry) => entry.to);

describe('the state list (US1-S1, FR-001)', () => {
  it('imports neither three nor a DOM API', () => expectPure('states.ts'));

  it('declares exactly idle, alert, chase, attack, death, and spawns in idle', () => {
    expect([...GUARD_STATES]).toEqual(['idle', 'alert', 'chase', 'attack', 'death']);
    expect(GUARD_SPAWN_STATE).toBe('idle');
    expect(GUARD_STATES).toContain(GUARD_SPAWN_STATE);
  });
});

describe('the transition table (US1-S1, FR-001)', () => {
  it('names from, to and a named one-argument guard predicate on every entry', () => {
    expect(GUARD_TRANSITIONS.length).toBeGreaterThan(0);
    for (const entry of GUARD_TRANSITIONS) {
      const label = `${entry.from} -> ${entry.to}`;
      expect(GUARD_STATES, label).toContain(entry.from);
      expect(GUARD_STATES, label).toContain(entry.to);
      expect(entry.guard, label).toBeTypeOf('function');
      expect(entry.guard.length, label).toBe(1);
      expect(entry.guard.name, label).not.toBe('');
      expect(entry.guard.name, label).not.toBe('anonymous');
    }
  });

  it('guards the four death edges with the one shared lethalDamage predicate', () => {
    const deaths = GUARD_TRANSITIONS.filter((entry) => entry.to === 'death');
    expect(deaths.length).toBe(GUARD_STATES.length - 1);
    expect(new Set(deaths.map((entry) => entry.guard)).size, 'one predicate, reused').toBe(1);
    for (const entry of deaths) expect(entry.guard.name).toBe('lethalDamage');
  });

  it('declares no self-edge and no duplicate edge', () => {
    const keys = GUARD_TRANSITIONS.map((entry) => `${entry.from}->${entry.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of GUARD_TRANSITIONS) expect(entry.from).not.toBe(entry.to);
  });
});

describe('death is terminal (US1-S7, FR-001)', () => {
  it('has zero outgoing edges', () => {
    expect(GUARD_TRANSITIONS.filter((entry) => entry.from === 'death')).toEqual([]);
    expect(transitionsFrom('death')).toEqual([]);
  });

  it('is reachable from every other state on lethal damage, outranking every edge', () => {
    const both = input({ lethalDamage: true, hasLineOfSight: true, distanceToPlayer: 0 });
    for (const state of GUARD_STATES) {
      if (state === 'death') continue;
      expect(firstTransition(state, input({ lethalDamage: true }))?.to, state).toBe('death');
      expect(firstTransition(state, both)?.to, `${state} with a rival edge`).toBe('death');
    }
  });

  it('proposes no transition out of death, whatever the input', () => {
    const probes = [
      input(),
      input({ lethalDamage: true }),
      input({ hasLineOfSight: true, distanceToPlayer: 0, ticksInState: 1000 }),
      input({ ticksSinceLastKnown: 10_000, hasLastKnown: true, distanceToLastKnown: 0 }),
    ];
    for (const probe of probes) expect(firstTransition('death', probe)).toBeNull();
  });
});

describe('graph shape (US1-S8)', () => {
  it('reaches every non-death state from idle', () => {
    const seen = new Set<GuardState>([GUARD_SPAWN_STATE]);
    const queue: GuardState[] = [GUARD_SPAWN_STATE];
    while (queue.length > 0) {
      for (const next of outgoing(queue.shift() as GuardState)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    for (const state of GUARD_STATES) expect(seen.has(state), `${state} unreachable`).toBe(true);
  });

  it('leaves no state but the spawn state without an incoming edge, and no dead ends', () => {
    for (const state of GUARD_STATES) {
      if (state !== GUARD_SPAWN_STATE) {
        const incoming = GUARD_TRANSITIONS.filter((entry) => entry.to === state);
        expect(incoming.length, `${state} has no incoming edge`).toBeGreaterThan(0);
      }
      if (state !== 'death') expect(outgoing(state).length, `${state} is a dead end`).toBeGreaterThan(0);
    }
  });
});

// Each edge the spec names, with the inputs that must fire it and the inputs
// that must not (US1-S3, US1-S4, US1-S5, US1-S6).
type Probe = Partial<TransitionInput>;
const NAMED: ReadonlyArray<[GuardState, GuardState, string, Probe[], Probe[]]> = [
  ['idle', 'alert', 'on sight (US1-S3)', [{ hasLineOfSight: true }], [{ hasLineOfSight: false }]],
  ['alert', 'chase', 'once the alert duration elapses with sight held (US1-S4)',
    [{ hasLineOfSight: true, ticksInState: ALERT_DURATION_TICKS }],
    [{ hasLineOfSight: true, ticksInState: ALERT_DURATION_TICKS - 1 },
     { hasLineOfSight: false, ticksInState: ALERT_DURATION_TICKS }]],
  ['alert', 'idle', 'on reaching the last known position or timing out (US1-S4)',
    [{ hasLastKnown: true, distanceToLastKnown: 0 },
     { hasLastKnown: true, distanceToLastKnown: 9, ticksSinceLastKnown: LAST_KNOWN_TIMEOUT_TICKS }],
    [{ hasLastKnown: true, distanceToLastKnown: 9, ticksSinceLastKnown: 1 },
     // Sight held: the guard is promoted, not sent home.
     { hasLineOfSight: true, hasLastKnown: true, distanceToLastKnown: 0 }]],
  ['chase', 'attack', 'on range and sight together (US1-S5)',
    [{ hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS }],
    [{ hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS + 0.01 },
     // US3-S5: no line of sight, no attack.
     { hasLineOfSight: false, distanceToPlayer: 0 }]],
  ['chase', 'alert', 'when sight is lost', [{ hasLineOfSight: false }], [{ hasLineOfSight: true }]],
  ['attack', 'chase', 'only once the current shot cooldown ends (US1-S6)',
    [{ hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS + 1, cooldownTicks: 0 },
     { hasLineOfSight: false, distanceToPlayer: 1, cooldownTicks: 0 }],
    [{ hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS + 1, cooldownTicks: 1 },
     { hasLineOfSight: false, distanceToPlayer: 1, cooldownTicks: 1 },
     // In range with sight: the guard keeps shooting.
     { hasLineOfSight: true, distanceToPlayer: 1, cooldownTicks: 0 }]],
];

describe('the edges the spec names (US1-S3, US1-S4, US1-S5, US1-S6)', () => {
  for (const [from, to, why, fires, holds] of NAMED) {
    it(`declares ${from} -> ${to} ${why}`, () => {
      const found = edge(from, to);
      expect(found, `${from} -> ${to} is missing`).toBeDefined();
      for (const probe of fires) expect(found?.guard(input(probe)), JSON.stringify(probe)).toBe(true);
      for (const probe of holds) expect(found?.guard(input(probe)), JSON.stringify(probe)).toBe(false);
    });
  }
});

describe('the tuning constants (US1-S5, US1-S6)', () => {
  it('declares each one once, positive and finite', () => {
    const constants = { ALERT_DURATION_TICKS, ATTACK_RANGE_CELLS, SHOT_COOLDOWN_TICKS,
      MOVE_SPEED_CELLS_PER_TICK, LAST_KNOWN_TIMEOUT_TICKS, PATH_REQUEST_INTERVAL_TICKS };
    for (const [name, value] of Object.entries(constants)) {
      expect(value, name).toBeTypeOf('number');
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it('gives the search longer than the alert wind-up, so a lost player is hunted', () => {
    expect(LAST_KNOWN_TIMEOUT_TICKS).toBeGreaterThan(ALERT_DURATION_TICKS);
  });
});
