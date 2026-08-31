import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/enemy/rng';
import {
  ALERT_DURATION_TICKS,
  ATTACK_RANGE_CELLS,
  ATTACK_WINDUP_TICKS,
  LAST_KNOWN_TIMEOUT_TICKS,
  LAST_KNOWN_ARRIVAL_CELLS,
  MOVE_SPEED_CELLS_PER_TICK,
  PATH_REQUEST_INTERVAL_TICKS,
  SHOT_COOLDOWN_TICKS,
} from '../../src/enemy/states';
import {
  createGuard,
  damageGuard,
  isUnreachable,
  stepGuard,
  traceGuard,
} from '../../src/enemy/step';
import { GUARD_MAX_HEALTH } from '../../src/enemy/states';
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
  /** Damage delivered to the guard on the tick being stepped. */
  damage?: (tick: number) => number;
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
  pathRequests: number[];
  pathGoals: Cell[];
  lines: string[];
  states: string[];
  random: boolean[];
  guards: Guard[];
}

const run = (script: Script, seed: number, ticks: number, start?: Partial<Guard>): Run => {
  const rng = createRng(seed);
  const world: GuardWorld = {
    hasLineOfSight: (_a, _b) => currentSight,
    findPath: (from, to) => {
      out.pathRequests.push(currentTick);
      out.pathGoals.push(to);
      return (script.path ?? straightPath)(from, to);
    },
  };
  let currentSight = false;
  let currentTick = 0;
  let guard = createGuard({ id: 'g0', x: 2.5, z: 10.5, ...start });
  const out: Run = {
    trace: '',
    pathRequests: [],
    pathGoals: [],
    lines: [],
    states: [],
    random: [],
    guards: [],
  };
  for (let tick = 0; tick < ticks; tick += 1) {
    currentTick = tick;
    currentSight = script.sight(tick);
    guard = stepGuard(guard, {
      tick,
      rng,
      grid: GRID,
      doorStates: NO_OPEN_TILES,
      playerPos: script.player(tick),
      world,
      damage: script.damage?.(tick) ?? 0,
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

const MODULES = ['step.ts', 'guard.ts'];
const sourceOf = (file: string): string =>
  readFileSync(new URL(`../../src/enemy/${file}`, import.meta.url), 'utf8');

describe('step module purity (FR-001, SC-001)', () => {
  it('imports neither three nor a DOM API', () => {
    for (const file of MODULES) {
      expect(THREE_IMPORT.test(sourceOf(file)), file).toBe(false);
      expect(DOM_GLOBAL.test(sourceOf(file)), file).toBe(false);
    }
  });

  it('imports neither the pathfinder nor the raycast US2 will write', () => {
    for (const file of MODULES) {
      const source = sourceOf(file);
      expect(/from\s+['"]\.\/pathing['"]/.test(source), `${file} must not import pathing`).toBe(false);
      expect(/from\s+['"]\.\/los['"]/.test(source), `${file} must not import los`).toBe(false);
      expect(/from\s+['"]\.\/nav['"]/.test(source), `${file} must not import nav`).toBe(false);
    }
  });

  it('keeps every module under the 400-line ceiling the constitution fixes', () => {
    for (const file of [...MODULES, 'states.ts', 'rng.ts']) {
      expect(sourceOf(file).split('\n').length, file).toBeLessThanOrEqual(400);
    }
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

describe('chase (US1-S4, US1-S5, Edge Cases)', () => {
  // Sight held throughout, player parked out of attack range down the room.
  const player = (): Point => ({ x: 13.5, z: 10.5 });
  const toChase = ALERT_DURATION_TICKS;

  it('closes on the player along the path the injected world returned', () => {
    const result = run({ sight: always, player }, 1234, toChase + 20);
    expect(result.states[toChase]).toBe('chase');
    const entered = result.guards[toChase] as Guard;
    const later = result.guards[toChase + 15] as Guard;
    expect(later.x).toBeGreaterThan(entered.x);
    expect(later.state).toBe('chase');
  });

  it('throttles path requests to the declared interval', () => {
    const result = run({ sight: always, player }, 1234, toChase + 40);
    const chaseRequests = result.pathRequests.filter((tick) => tick >= toChase);
    expect(chaseRequests.length).toBeGreaterThan(1);
    for (let i = 1; i < chaseRequests.length; i += 1) {
      const gap = (chaseRequests[i] as number) - (chaseRequests[i - 1] as number);
      expect(gap, 'no guard may request a path every tick').toBeGreaterThanOrEqual(
        PATH_REQUEST_INTERVAL_TICKS,
      );
    }
    for (const guard of result.guards) expect(guard.pathable).toBe(true);
  });

  it('records pathable false and holds position when the route is unreachable', () => {
    const unreachable = (): PathResult => ({ unreachable: true, nodesExpanded: 7 });
    const result = run({ sight: always, player, path: unreachable }, 1234, toChase + 6);
    const stuck = result.guards[toChase + 5] as Guard;
    expect(stuck.state).toBe('chase');
    expect(stuck.pathable).toBe(false);
    expect(stuck.x).toBe(2.5);
    expect(isUnreachable({ unreachable: true, nodesExpanded: 0 })).toBe(true);
    expect(isUnreachable({ cells: [], nodesExpanded: 0 })).toBe(false);
  });

  it('discards a stale path on the tick the player moves, and re-requests within the throttle', () => {
    // The player teleports across the room at the tick named below. The stale
    // path must be dropped rather than walked to the old destination, and the
    // next request must name the new one (Edge Cases).
    const jump = toChase + 3;
    const teleporting = (tick: number): Point =>
      tick < jump ? { x: 13.5, z: 10.5 } : { x: 13.5, z: 2.5 };
    const result = run({ sight: always, player: teleporting }, 1234, jump + 20);

    const following = result.guards[jump - 1] as Guard;
    expect(following.path.length, 'a path was being followed before the jump').toBeGreaterThan(0);
    expect(following.pathGoal).toEqual({ x: 13, z: 10 });

    const jumped = result.guards[jump] as Guard;
    expect(jumped.path, 'the stale path is discarded on that same tick').toEqual([]);
    expect(jumped.pathGoal).toEqual({ x: 13, z: 2 });

    const afterJump = result.pathRequests
      .map((tick, index) => ({ tick, goal: result.pathGoals[index] as Cell }))
      .filter((request) => request.tick >= jump);
    expect(afterJump.length).toBeGreaterThan(0);
    const first = afterJump[0] as { tick: number; goal: Cell };
    expect(first.tick - jump).toBeLessThanOrEqual(PATH_REQUEST_INTERVAL_TICKS);
    expect(first.goal, 'the new request names the new destination').toEqual({ x: 13, z: 2 });
  });

  it('moves only along a path, never beelining when it has none', () => {
    const noPath = (): PathResult => ({ cells: [], nodesExpanded: 0 });
    const result = run({ sight: always, player, path: noPath }, 1234, toChase + 8);
    for (const guard of result.guards) {
      expect(guard.x).toBe(2.5);
      expect(guard.z).toBe(10.5);
    }
  });
});

describe('chase -> attack on range and sight (US1-S5)', () => {
  const inRange = (): Point => ({ x: 2.5 + ATTACK_RANGE_CELLS - 0.5, z: 10.5 });
  const outOfRange = (): Point => ({ x: 2.5 + ATTACK_RANGE_CELLS + 2, z: 10.5 });

  it('attacks once the player is inside the declared range with sight held', () => {
    const player = (tick: number) => (tick < ALERT_DURATION_TICKS + 2 ? outOfRange() : inRange());
    const result = run({ sight: always, player, path: () => ({ cells: [], nodesExpanded: 0 }) }, 1234, ALERT_DURATION_TICKS + 5);
    expect(result.states[ALERT_DURATION_TICKS]).toBe('chase');
    expect(result.states[ALERT_DURATION_TICKS + 1]).toBe('chase');
    expect(result.states[ALERT_DURATION_TICKS + 2]).toBe('attack');
  });

  it('does not attack in range without sight (US3-S5)', () => {
    const result = run({ sight: (tick) => tick < ALERT_DURATION_TICKS + 1, player: inRange }, 1234, ALERT_DURATION_TICKS + 6);
    for (const state of result.states) expect(state).not.toBe('attack');
  });
});

describe('attack (US1-S6)', () => {
  const inRange = (): Point => ({ x: 6.5, z: 10.5 });
  const enters = ALERT_DURATION_TICKS + 1;

  it('arms a cooldown and a wind-up on entry, then releases exactly one shot', () => {
    const result = run({ sight: always, player: inRange }, 1234, enters + SHOT_COOLDOWN_TICKS + 2);
    expect(result.states[enters]).toBe('attack');
    const armed = result.guards[enters] as Guard;
    expect(armed.cooldownTicks).toBe(SHOT_COOLDOWN_TICKS);
    expect(armed.pendingShot).toBe(true);
    expect(armed.shotsFired).toBe(0);

    const fired = result.guards[enters + ATTACK_WINDUP_TICKS] as Guard;
    expect(fired.shotsFired).toBe(1);
    expect(fired.pendingShot).toBe(false);
  });

  it('counts its cooldown down one tick at a time and re-arms while in contact', () => {
    const ticks = enters + SHOT_COOLDOWN_TICKS * 2 + 2;
    const result = run({ sight: always, player: inRange }, 1234, ticks);
    for (let i = 0; i <= SHOT_COOLDOWN_TICKS; i += 1) {
      const guard = result.guards[enters + i] as Guard;
      expect(guard.state, `tick ${enters + i}`).toBe('attack');
      expect(guard.cooldownTicks, `tick ${enters + i}`).toBe(SHOT_COOLDOWN_TICKS - i);
    }
    const rearmed = result.guards[enters + SHOT_COOLDOWN_TICKS + 1] as Guard;
    expect(rearmed.cooldownTicks).toBe(SHOT_COOLDOWN_TICKS);
    expect(rearmed.pendingShot).toBe(true);
    expect((result.guards[ticks - 1] as Guard).shotsFired).toBe(2);
  });

  it('returns to chase only once the current shot cooldown ends, not before', () => {
    // Sight breaks two ticks into the attack, mid-cooldown.
    const breakAt = enters + 2;
    const result = run(
      { sight: (tick) => tick < breakAt, player: inRange },
      1234,
      enters + SHOT_COOLDOWN_TICKS + 4,
    );
    for (let tick = breakAt; tick < enters + SHOT_COOLDOWN_TICKS + 1; tick += 1) {
      expect(result.states[tick], `tick ${tick} released mid-cooldown`).toBe('attack');
    }
    expect(result.states[enters + SHOT_COOLDOWN_TICKS + 1]).toBe('chase');
  });

  it('returns to chase once the player leaves attack range and the cooldown ends', () => {
    const leaveAt = enters + 2;
    const player = (tick: number): Point =>
      tick < leaveAt ? { x: 6.5, z: 10.5 } : { x: 2.5 + ATTACK_RANGE_CELLS + 3, z: 10.5 };
    const result = run(
      { sight: always, player, path: () => ({ cells: [], nodesExpanded: 0 }) },
      1234,
      enters + SHOT_COOLDOWN_TICKS + 3,
    );
    for (let tick = leaveAt; tick < enters + SHOT_COOLDOWN_TICKS + 1; tick += 1) {
      expect(result.states[tick], `tick ${tick}`).toBe('attack');
    }
    expect(result.states[enters + SHOT_COOLDOWN_TICKS + 1]).toBe('chase');
  });

  it('holds position and faces the player while attacking', () => {
    const result = run({ sight: always, player: inRange }, 1234, enters + 4);
    const attacking = result.guards[enters + 3] as Guard;
    expect(attacking.state).toBe('attack');
    expect(attacking.facing).toBeCloseTo(-Math.PI / 2, 6);
    expect(attacking.randomConsumed).toBe(false);
  });
});

describe('death is terminal (US1-S7, FR-001, Edge Cases)', () => {
  const inRange = (): Point => ({ x: 6.5, z: 10.5 });
  const far = (): Point => ({ x: 13.5, z: 10.5 });
  const lethal = GUARD_MAX_HEALTH;

  it('enters death from every state that can be reached', () => {
    const killAt = {
      idle: 3,
      alert: ALERT_DURATION_TICKS - 2,
      chase: ALERT_DURATION_TICKS + 1,
      attack: ALERT_DURATION_TICKS + 2,
    };

    const fromIdle = run(
      { sight: never, player: far, damage: (tick) => (tick === killAt.idle ? lethal : 0) },
      1234,
      killAt.idle + 3,
    );
    expect(fromIdle.states[killAt.idle - 1]).toBe('idle');
    expect(fromIdle.states[killAt.idle]).toBe('death');

    const fromAlert = run(
      { sight: always, player: inRange, damage: (tick) => (tick === killAt.alert ? lethal : 0) },
      1234,
      killAt.alert + 3,
    );
    expect(fromAlert.states[killAt.alert - 1]).toBe('alert');
    expect(fromAlert.states[killAt.alert]).toBe('death');

    const fromChase = run(
      {
        sight: always,
        player: far,
        path: () => ({ cells: [], nodesExpanded: 0 }),
        damage: (tick) => (tick === killAt.chase ? lethal : 0),
      },
      1234,
      killAt.chase + 3,
    );
    expect(fromChase.states[killAt.chase - 1]).toBe('chase');
    expect(fromChase.states[killAt.chase]).toBe('death');

    const fromAttack = run(
      { sight: always, player: inRange, damage: (tick) => (tick === killAt.attack ? lethal : 0) },
      1234,
      killAt.attack + 3,
    );
    expect(fromAttack.states[killAt.attack - 1]).toBe('attack');
    expect(fromAttack.states[killAt.attack]).toBe('death');
  });

  it('never leaves death, however inviting the input', () => {
    const killAt = 3;
    const result = run(
      { sight: always, player: inRange, damage: (tick) => (tick === killAt ? lethal : 0) },
      1234,
      120,
    );
    expect(result.states.slice(killAt).every((state) => state === 'death')).toBe(true);
  });

  it('freezes the guard: no movement, no turning, no PRNG draw after death', () => {
    const killAt = 3;
    const result = run(
      { sight: never, player: far, damage: (tick) => (tick === killAt ? lethal : 0) },
      1234,
      40,
    );
    const dead = result.guards[killAt] as Guard;
    for (const guard of result.guards.slice(killAt)) {
      expect(guard.facing, 'a dead guard does not turn').toBe(dead.facing);
      expect(guard.x).toBe(dead.x);
      expect(guard.z).toBe(dead.z);
      expect(guard.randomConsumed, 'death draws no randomness').toBe(false);
      // Nothing re-arms behind death's back: no cooldown, no wind-up, no shot.
      expect(guard.cooldownTicks, 'a dead guard serves no cooldown').toBe(0);
      expect(guard.windupTicks, 'a dead guard winds up nothing').toBe(0);
      expect(guard.pendingShot).toBe(false);
      expect(guard.shotsFired).toBe(dead.shotsFired);
      expect(guard.path).toEqual([]);
    }
    // Its tick still advances, so a renderer can time the death animation.
    expect((result.guards[39] as Guard).tick).toBe(39);
    expect((result.guards[39] as Guard).ticksInState).toBe(39 - killAt);
  });

  it('cancels a pending attack wind-up, so no shot is released after death', () => {
    // Killed one tick into the wind-up, before the shot would have left.
    const enters = ALERT_DURATION_TICKS + 1;
    const killAt = enters + 1;
    const result = run(
      { sight: always, player: inRange, damage: (tick) => (tick === killAt ? lethal : 0) },
      1234,
      enters + ATTACK_WINDUP_TICKS + SHOT_COOLDOWN_TICKS + 4,
    );
    expect(result.states[killAt - 1]).toBe('attack');
    expect((result.guards[killAt - 1] as Guard).pendingShot).toBe(true);

    const dead = result.guards[killAt] as Guard;
    expect(dead.state).toBe('death');
    expect(dead.pendingShot, 'the wind-up is cancelled').toBe(false);
    expect(dead.windupTicks).toBe(0);
    expect(dead.cooldownTicks).toBe(0);
    expect(dead.path).toEqual([]);

    const shotsAtDeath = dead.shotsFired;
    for (const guard of result.guards.slice(killAt)) {
      expect(guard.shotsFired, 'no shot is fired after death').toBe(shotsAtDeath);
    }
  });

  it('fires no second death transition when damaged again', () => {
    const killAt = 3;
    const result = run(
      { sight: always, player: inRange, damage: (tick) => (tick >= killAt ? lethal : 0) },
      1234,
      20,
    );
    const dead = result.guards[killAt] as Guard;
    expect(dead.state).toBe('death');
    expect(dead.health).toBe(0);
    for (const guard of result.guards.slice(killAt)) {
      expect(guard.health, 'a dead guard absorbs nothing further').toBe(0);
      expect(guard.stateEnteredTick, 'death is entered exactly once').toBe(dead.stateEnteredTick);
    }
  });

  it('survives non-lethal damage and keeps behaving', () => {
    const result = run(
      { sight: never, player: far, damage: (tick) => (tick === 3 ? GUARD_MAX_HEALTH - 1 : 0) },
      1234,
      10,
    );
    expect(new Set(result.states)).toEqual(new Set(['idle']));
    expect((result.guards[9] as Guard).health).toBe(1);
  });

  it('damageGuard is pure and refuses to lower a dead guard further', () => {
    const alive = createGuard({ id: 'g0', x: 2.5, z: 10.5 });
    const hurt = damageGuard(alive, 30);
    expect(alive.health).toBe(GUARD_MAX_HEALTH);
    expect(hurt.health).toBe(GUARD_MAX_HEALTH - 30);
    expect(damageGuard(hurt, 1000).health).toBe(0);

    const dead = { ...hurt, state: 'death' as const, health: 0 };
    expect(damageGuard(dead, 50)).toBe(dead);
  });

  it('records death in the trace, and the trace stays byte-stable across runs', () => {
    const script: Script = {
      sight: (tick) => tick >= 4,
      player: inRange,
      damage: (tick) => (tick === 20 ? lethal : 0),
    };
    const first = run(script, 1234, 60);
    const second = run(script, 1234, 60);
    expect(second.trace).toBe(first.trace);
    expect(first.trace).toContain(' death ');
    expect(traceGuard(first.guards[59] as Guard)).toBe(first.lines[59]);
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
