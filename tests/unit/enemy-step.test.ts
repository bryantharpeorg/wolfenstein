import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/enemy/rng';
import {
  ALERT_DURATION_TICKS,
  LAST_KNOWN_TIMEOUT_TICKS,
  LAST_KNOWN_ARRIVAL_CELLS,
  MOVE_SPEED_CELLS_PER_TICK,
} from '../../src/enemy/states';
import { createGuard, stepGuard, traceGuard } from '../../src/enemy/step';
import type { Cell, Guard, GuardWorld, PathResult, Point } from '../../src/enemy/step';

// The state machine driven as behaviour, with pathing and sight injected through
// the GuardWorld port rather than imported — which is the seam that lets US1 ship
// before US2 exists (FR-001, FR-002, SC-001).

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

// A hand-drawn 16x16 room: solid border, one interior wall stub at x=8, z=2..6.
const GRID: string[] = (() => {
  const rows: string[] = [];
  for (let z = 0; z < 16; z += 1) {
    if (z === 0 || z === 15) {
      rows.push('1'.repeat(16));
      continue;
    }
    const row = Array.from({ length: 16 }, (_, x) => (x === 0 || x === 15 ? '1' : '0'));
    if (z >= 2 && z <= 6) row[8] = '1';
    rows.push(row.join(''));
  }
  return rows;
})();

const NO_OPEN_TILES: ReadonlySet<string> = new Set<string>();

/** A stubbed world: sight is scripted per tick, paths are straight cell runs. */
interface Script {
  /** Line of sight for the tick being stepped. */
  sight: (tick: number) => boolean;
  /** Player position for the tick being stepped. */
  player: (tick: number) => Point;
  /** Optional override for the stub pathfinder. */
  path?: (from: Cell, to: Cell) => PathResult;
}

const straightPath = (from: Cell, to: Cell): PathResult => {
  const cells: Cell[] = [];
  let { x, z } = from;
  let budget = 64;
  while ((x !== to.x || z !== to.z) && budget > 0) {
    if (x !== to.x) x += Math.sign(to.x - x);
    else z += Math.sign(to.z - z);
    cells.push({ x, z });
    budget -= 1;
  }
  return { cells, nodesExpanded: cells.length };
};

interface Run {
  trace: string;
  lines: string[];
  states: string[];
  random: boolean[];
  guards: Guard[];
}

const run = (script: Script, seed: number, ticks: number, start?: Partial<Guard>): Run => {
  const rng = createRng(seed);
  const world: GuardWorld = {
    hasLineOfSight: (_a, _b) => currentSight,
    findPath: (from, to) => (script.path ?? straightPath)(from, to),
  };
  let currentSight = false;
  let guard = createGuard({ id: 'g0', x: 2.5, z: 10.5, ...start });
  const out: Run = { trace: '', lines: [], states: [], random: [], guards: [] };
  for (let tick = 0; tick < ticks; tick += 1) {
    currentSight = script.sight(tick);
    guard = stepGuard(guard, {
      tick,
      rng,
      grid: GRID,
      doorStates: NO_OPEN_TILES,
      playerPos: script.player(tick),
      world,
    });
    out.lines.push(traceGuard(guard));
    out.states.push(guard.state);
    out.random.push(guard.randomConsumed);
    out.guards.push(guard);
  }
  out.trace = out.lines.join('\n');
  return out;
};

const never = () => false;
const always = () => true;
const farPlayer = (): Point => ({ x: 13.5, z: 10.5 });

describe('step module purity (FR-001, SC-001)', () => {
  it('imports neither three nor a DOM API', () => {
    const source = readFileSync(new URL('../../src/enemy/step.ts', import.meta.url), 'utf8');
    expect(THREE_IMPORT.test(source)).toBe(false);
    expect(DOM_GLOBAL.test(source)).toBe(false);
  });

  it('imports neither the pathfinder nor the raycast US2 will write', () => {
    const source = readFileSync(new URL('../../src/enemy/step.ts', import.meta.url), 'utf8');
    expect(/from\s+['"]\.\/pathing['"]/.test(source), 'step.ts must not import pathing').toBe(false);
    expect(/from\s+['"]\.\/los['"]/.test(source), 'step.ts must not import los').toBe(false);
    expect(/from\s+['"]\.\/nav['"]/.test(source), 'step.ts must not import nav').toBe(false);
  });

  it('loads in an environment with no window defined', () => {
    expect('window' in globalThis).toBe(false);
    expect(stepGuard).toBeTypeOf('function');
  });
});

describe('stepGuard is pure in its guard argument (FR-002)', () => {
  it('returns a new record and leaves the one it was given untouched', () => {
    const before = createGuard({ id: 'g0', x: 2.5, z: 10.5 });
    const snapshot = JSON.stringify(before);
    const after = stepGuard(before, {
      tick: 0,
      rng: createRng(1234),
      grid: GRID,
      doorStates: NO_OPEN_TILES,
      playerPos: farPlayer(),
      world: { hasLineOfSight: always, findPath: straightPath },
    });
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('spawns idle at full health with no last known position', () => {
    const guard = createGuard({ id: 'g0', x: 2.5, z: 10.5 });
    expect(guard.state).toBe('idle');
    expect(guard.health).toBeGreaterThan(0);
    expect(guard.lastKnownPlayer).toBeNull();
    expect(guard.shotsFired).toBe(0);
  });
});

describe('idle patrol (US1-S2)', () => {
  const idle = run({ sight: never, player: farPlayer }, 1234, 40);

  it('stays idle with no player visible and no sound event', () => {
    expect(new Set(idle.states)).toEqual(new Set(['idle']));
  });

  it('turns rather than freezing, and draws from the PRNG on every idle tick', () => {
    const facings = idle.guards.map((guard) => guard.facing);
    expect(new Set(facings).size, 'a frozen guard would report one facing').toBe(facings.length);
    expect(idle.random.every(Boolean), 'idle patrol is the seeded script').toBe(true);
  });

  it('holds position: patrol is a facing script, not a walk', () => {
    for (const guard of idle.guards) {
      expect(guard.x).toBe(2.5);
      expect(guard.z).toBe(10.5);
    }
  });

  it('follows a different patrol for a different seed', () => {
    const other = run({ sight: never, player: farPlayer }, 4321, 40);
    expect(other.states).toEqual(idle.states);
    expect(other.trace).not.toBe(idle.trace);
  });

  it('keeps every facing wrapped into [-pi, pi]', () => {
    for (const guard of idle.guards) {
      expect(guard.facing).toBeGreaterThanOrEqual(-Math.PI);
      expect(guard.facing).toBeLessThanOrEqual(Math.PI);
    }
  });
});

describe('idle -> alert on sight (US1-S3)', () => {
  const sightAt = 5;
  const player = (): Point => ({ x: 6.5, z: 10.5 });
  const result = run({ sight: (tick) => tick >= sightAt, player }, 1234, sightAt + 2);

  it('moves to alert on the same tick line-of-sight becomes true', () => {
    expect(result.states[sightAt - 1]).toBe('idle');
    expect(result.states[sightAt]).toBe('alert');
  });

  it('records the last known player position on that tick', () => {
    expect(result.guards[sightAt - 1]?.lastKnownPlayer).toBeNull();
    expect(result.guards[sightAt]?.lastKnownPlayer).toEqual({ x: 6, z: 10 });
    expect(result.guards[sightAt]?.lastKnownTick).toBe(sightAt);
  });

  it('faces the player once alerted rather than patrolling', () => {
    const alerted = result.guards[sightAt] as Guard;
    // The player is due +X of the guard; yaw 0 faces -Z, so facing +X is -pi/2.
    expect(alerted.facing).toBeCloseTo(-Math.PI / 2, 6);
    expect(alerted.randomConsumed, 'alert does not draw from the PRNG').toBe(false);
  });
});

describe('alert -> chase with sight held (US1-S4)', () => {
  const player = (): Point => ({ x: 6.5, z: 10.5 });
  const result = run({ sight: always, player }, 1234, ALERT_DURATION_TICKS + 4);

  it('waits out the declared alert duration, then commits to the chase', () => {
    expect(result.states[0]).toBe('alert');
    for (let tick = 1; tick < ALERT_DURATION_TICKS; tick += 1) {
      expect(result.states[tick], `tick ${tick}`).toBe('alert');
    }
    expect(result.states[ALERT_DURATION_TICKS]).toBe('chase');
  });
});

describe('alert -> idle when sight is lost (US1-S4)', () => {
  const player = (): Point => ({ x: 6.5, z: 10.5 });

  it('moves toward the last known position and goes home on reaching it', () => {
    const result = run({ sight: (tick) => tick === 0, player }, 1234, 60);
    expect(result.states[0]).toBe('alert');

    const searching = result.guards.filter((guard) => guard.state === 'alert');
    const first = searching[0] as Guard;
    const last = searching[searching.length - 1] as Guard;
    expect(last.x, 'the guard closed on the last known cell').toBeGreaterThan(first.x);

    const wentHome = result.states.indexOf('idle');
    expect(wentHome, 'the guard returns to idle').toBeGreaterThan(0);

    const arrival = result.guards[wentHome - 1] as Guard;
    const dx = arrival.x - 6.5;
    const dz = arrival.z - 10.5;
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(LAST_KNOWN_ARRIVAL_CELLS);
    expect(result.states.slice(wentHome)).toEqual(
      Array.from({ length: result.states.length - wentHome }, () => 'idle'),
    );
  });

  it('moves at the declared speed, not faster', () => {
    const result = run({ sight: (tick) => tick === 0, player }, 1234, 6);
    for (let tick = 1; tick < result.guards.length; tick += 1) {
      const previous = result.guards[tick - 1] as Guard;
      const current = result.guards[tick] as Guard;
      const travelled = Math.hypot(current.x - previous.x, current.z - previous.z);
      expect(travelled).toBeLessThanOrEqual(MOVE_SPEED_CELLS_PER_TICK + 1e-9);
    }
  });

  it('gives up after the declared timeout when the last known spot is unreachable', () => {
    // Sight for one tick on a player standing behind the interior wall stub, so
    // the guard walks into the wall and never arrives.
    const behindWall = (): Point => ({ x: 8.5, z: 4.5 });
    const result = run(
      { sight: (tick) => tick === 0, player: behindWall },
      1234,
      LAST_KNOWN_TIMEOUT_TICKS + 3,
      { x: 2.5, z: 4.5 },
    );
    expect(result.states[0]).toBe('alert');
    expect(result.states[LAST_KNOWN_TIMEOUT_TICKS - 1]).toBe('alert');
    expect(result.states[LAST_KNOWN_TIMEOUT_TICKS]).toBe('idle');
    const stopped = result.guards[LAST_KNOWN_TIMEOUT_TICKS - 1] as Guard;
    expect(stopped.x, 'a guard never walks into a wall cell').toBeLessThan(8);
  });
});

describe('determinism (US1-S9, FR-002, SC-002)', () => {
  const script: Script = {
    sight: (tick) => tick % 40 >= 12 && tick % 40 < 26,
    player: (tick) => ({ x: 6.5 + (tick % 5) * 0.1, z: 10.5 }),
  };

  it('produces byte-identical traces for seed 1234 run twice over 600 ticks', () => {
    const first = run(script, 1234, 600);
    const second = run(script, 1234, 600);
    expect(second.trace).toBe(first.trace);
    expect(second.trace.length).toBeGreaterThan(0);
  });

  it('diverges under a different seed only at ticks that requested randomness', () => {
    const first = run(script, 1234, 600);
    const other = run(script, 4321, 600);
    expect(other.trace).not.toBe(first.trace);

    const differing = first.lines
      .map((line, tick) => (line === other.lines[tick] ? -1 : tick))
      .filter((tick) => tick >= 0);
    expect(differing.length, 'the seed must matter somewhere').toBeGreaterThan(0);
    for (const tick of differing) {
      expect(first.random[tick], `tick ${tick} differed without drawing`).toBe(true);
      expect(other.random[tick], `tick ${tick} differed without drawing`).toBe(true);
    }
    expect(other.states, 'state transitions never consume randomness').toEqual(first.states);
  });
});
