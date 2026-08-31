import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GUARD_STATES,
  GUARD_SPAWN_STATE,
  GUARD_TRANSITIONS,
  transitionsFrom,
  firstTransition,
  ALERT_DURATION_TICKS,
  ATTACK_RANGE_CELLS,
  SHOT_COOLDOWN_TICKS,
  MOVE_SPEED_CELLS_PER_TICK,
  LAST_KNOWN_TIMEOUT_TICKS,
  PATH_REQUEST_INTERVAL_TICKS,
} from '../../src/enemy/states';
import type { GuardState, TransitionInput } from '../../src/enemy/states';

// US1-S1, US1-S7, US1-S8, FR-001: the table is the single source of truth for
// legal edges, so it is inspected as data here rather than exercised as
// behaviour — that is enemy-step.test.ts's job.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

const input = (overrides: Partial<TransitionInput> = {}): TransitionInput => ({
  tick: 0,
  ticksInState: 0,
  hasLineOfSight: false,
  distanceToPlayer: 99,
  distanceToLastKnown: 99,
  ticksSinceLastKnown: 0,
  hasLastKnown: false,
  cooldownTicks: 0,
  lethalDamage: false,
  ...overrides,
});

describe('states module purity (FR-001)', () => {
  it('imports neither three nor a DOM API', () => {
    const source = readFileSync(new URL('../../src/enemy/states.ts', import.meta.url), 'utf8');
    expect(THREE_IMPORT.test(source)).toBe(false);
    expect(DOM_GLOBAL.test(source)).toBe(false);
  });
});

describe('the state list (US1-S1, FR-001)', () => {
  it('declares exactly idle, alert, chase, attack, death', () => {
    expect([...GUARD_STATES]).toEqual(['idle', 'alert', 'chase', 'attack', 'death']);
  });

  it('spawns in idle', () => {
    expect(GUARD_SPAWN_STATE).toBe('idle');
    expect(GUARD_STATES).toContain(GUARD_SPAWN_STATE);
  });
});

describe('the transition table (US1-S1, FR-001)', () => {
  it('names from, to and a guard predicate on every entry', () => {
    expect(GUARD_TRANSITIONS.length).toBeGreaterThan(0);
    for (const edge of GUARD_TRANSITIONS) {
      expect(GUARD_STATES, `${edge.from} -> ${edge.to}`).toContain(edge.from);
      expect(GUARD_STATES, `${edge.from} -> ${edge.to}`).toContain(edge.to);
      expect(edge.guard, `${edge.from} -> ${edge.to}`).toBeTypeOf('function');
      expect(edge.guard.length, `${edge.from} -> ${edge.to}`).toBe(1);
    }
  });

  it('gives every guard predicate a name', () => {
    for (const edge of GUARD_TRANSITIONS) {
      expect(edge.guard.name, `${edge.from} -> ${edge.to}`).not.toBe('');
      expect(edge.guard.name, `${edge.from} -> ${edge.to}`).not.toBe('anonymous');
    }
  });

  it('guards the four death edges with the one shared lethalDamage predicate', () => {
    const deathEdges = GUARD_TRANSITIONS.filter((edge) => edge.to === 'death');
    expect(deathEdges.length).toBe(GUARD_STATES.length - 1);
    const predicates = new Set(deathEdges.map((edge) => edge.guard));
    expect(predicates.size, 'one predicate, reused, not four copies').toBe(1);
    for (const edge of deathEdges) expect(edge.guard.name).toBe('lethalDamage');
  });

  it('gives every other edge a predicate name of its own', () => {
    const names = GUARD_TRANSITIONS.filter((edge) => edge.to !== 'death').map(
      (edge) => edge.guard.name,
    );
    expect(new Set(names).size, 'predicate names identify their edge').toBe(names.length);
  });

  it('declares no self-edge and no duplicate edge', () => {
    const keys = GUARD_TRANSITIONS.map((edge) => `${edge.from}->${edge.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const edge of GUARD_TRANSITIONS) expect(edge.from).not.toBe(edge.to);
  });

  it('answers a predicate purely — the same input twice gives the same verdict', () => {
    const probe = input({ hasLineOfSight: true, distanceToPlayer: 1, ticksInState: 99 });
    for (const edge of GUARD_TRANSITIONS) {
      expect(edge.guard(probe)).toBe(edge.guard(probe));
    }
  });
});

describe('death is terminal (US1-S7, FR-001)', () => {
  it('has zero outgoing edges', () => {
    expect(GUARD_TRANSITIONS.filter((edge) => edge.from === 'death')).toEqual([]);
    expect(transitionsFrom('death')).toEqual([]);
  });

  it('is reachable from every other state on lethal damage', () => {
    for (const state of GUARD_STATES) {
      if (state === 'death') continue;
      const edge = firstTransition(state, input({ lethalDamage: true }));
      expect(edge?.to, `${state} must die`).toBe('death');
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
  const outgoing = (state: GuardState): GuardState[] =>
    GUARD_TRANSITIONS.filter((edge) => edge.from === state).map((edge) => edge.to);

  it('reaches every non-death state from idle', () => {
    const seen = new Set<GuardState>([GUARD_SPAWN_STATE]);
    const queue: GuardState[] = [GUARD_SPAWN_STATE];
    while (queue.length > 0) {
      const state = queue.shift() as GuardState;
      for (const next of outgoing(state)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    for (const state of GUARD_STATES) expect(seen.has(state), `${state} unreachable`).toBe(true);
  });

  it('leaves no state but the spawn state without an incoming edge', () => {
    for (const state of GUARD_STATES) {
      const incoming = GUARD_TRANSITIONS.filter((edge) => edge.to === state);
      if (state === GUARD_SPAWN_STATE) continue;
      expect(incoming.length, `${state} has no incoming edge`).toBeGreaterThan(0);
    }
  });

  it('gives every non-death state at least one way out', () => {
    for (const state of GUARD_STATES) {
      if (state === 'death') continue;
      expect(outgoing(state).length, `${state} is a dead end`).toBeGreaterThan(0);
    }
  });
});

describe('the edges the spec names (US1-S3, US1-S4, US1-S5, US1-S6)', () => {
  const edge = (from: GuardState, to: GuardState) =>
    GUARD_TRANSITIONS.find((entry) => entry.from === from && entry.to === to);

  it('declares idle -> alert on sight', () => {
    const found = edge('idle', 'alert');
    expect(found).toBeDefined();
    expect(found?.guard(input({ hasLineOfSight: true }))).toBe(true);
    expect(found?.guard(input({ hasLineOfSight: false }))).toBe(false);
  });

  it('declares alert -> chase once the alert duration elapses with sight held', () => {
    const found = edge('alert', 'chase');
    expect(found).toBeDefined();
    expect(
      found?.guard(input({ hasLineOfSight: true, ticksInState: ALERT_DURATION_TICKS })),
    ).toBe(true);
    expect(
      found?.guard(input({ hasLineOfSight: true, ticksInState: ALERT_DURATION_TICKS - 1 })),
    ).toBe(false);
    expect(
      found?.guard(input({ hasLineOfSight: false, ticksInState: ALERT_DURATION_TICKS })),
    ).toBe(false);
  });

  it('declares alert -> idle on reaching the last known position or timing out', () => {
    const found = edge('alert', 'idle');
    expect(found).toBeDefined();
    expect(found?.guard(input({ hasLastKnown: true, distanceToLastKnown: 0 }))).toBe(true);
    expect(
      found?.guard(input({ hasLastKnown: true, distanceToLastKnown: 9, ticksSinceLastKnown: LAST_KNOWN_TIMEOUT_TICKS })),
    ).toBe(true);
    expect(
      found?.guard(input({ hasLastKnown: true, distanceToLastKnown: 9, ticksSinceLastKnown: 1 })),
    ).toBe(false);
    // Sight held: the guard is promoted, not sent home.
    expect(
      found?.guard(input({ hasLineOfSight: true, hasLastKnown: true, distanceToLastKnown: 0 })),
    ).toBe(false);
  });

  it('declares chase -> attack on range and sight together', () => {
    const found = edge('chase', 'attack');
    expect(found).toBeDefined();
    expect(
      found?.guard(input({ hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS })),
    ).toBe(true);
    expect(
      found?.guard(input({ hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS + 0.01 })),
    ).toBe(false);
    // US3-S5: no line of sight, no attack.
    expect(
      found?.guard(input({ hasLineOfSight: false, distanceToPlayer: 0 })),
    ).toBe(false);
  });

  it('declares chase -> alert when sight is lost', () => {
    const found = edge('chase', 'alert');
    expect(found).toBeDefined();
    expect(found?.guard(input({ hasLineOfSight: false }))).toBe(true);
    expect(found?.guard(input({ hasLineOfSight: true }))).toBe(false);
  });

  it('declares attack -> chase only once the current shot cooldown ends', () => {
    const found = edge('attack', 'chase');
    expect(found).toBeDefined();
    const outOfRange = { hasLineOfSight: true, distanceToPlayer: ATTACK_RANGE_CELLS + 1 };
    expect(found?.guard(input({ ...outOfRange, cooldownTicks: 0 }))).toBe(true);
    expect(found?.guard(input({ ...outOfRange, cooldownTicks: 1 }))).toBe(false);
    const sightBroken = { hasLineOfSight: false, distanceToPlayer: 1 };
    expect(found?.guard(input({ ...sightBroken, cooldownTicks: 0 }))).toBe(true);
    expect(found?.guard(input({ ...sightBroken, cooldownTicks: 1 }))).toBe(false);
    // In range with sight: the guard keeps shooting.
    expect(
      found?.guard(input({ hasLineOfSight: true, distanceToPlayer: 1, cooldownTicks: 0 })),
    ).toBe(false);
  });
});

describe('lethal damage outranks every other edge (US1-S7)', () => {
  it('wins even when another edge would also fire', () => {
    const both = input({ lethalDamage: true, hasLineOfSight: true, distanceToPlayer: 0 });
    expect(firstTransition('idle', both)?.to).toBe('death');
    expect(firstTransition('chase', both)?.to).toBe('death');
  });
});

describe('the tuning constants (US1-S5, US1-S6)', () => {
  it('declares each one once, positive and finite', () => {
    const constants = {
      ALERT_DURATION_TICKS,
      ATTACK_RANGE_CELLS,
      SHOT_COOLDOWN_TICKS,
      MOVE_SPEED_CELLS_PER_TICK,
      LAST_KNOWN_TIMEOUT_TICKS,
      PATH_REQUEST_INTERVAL_TICKS,
    };
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
