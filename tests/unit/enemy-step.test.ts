import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/enemy/rng';
import {
  ALERT_DURATION_TICKS, ATTACK_RANGE_CELLS, ATTACK_WINDUP_TICKS, GUARD_MAX_HEALTH,
  LAST_KNOWN_ARRIVAL_CELLS, LAST_KNOWN_TIMEOUT_TICKS, MOVE_SPEED_CELLS_PER_TICK,
  PATH_REQUEST_INTERVAL_TICKS, SHOT_COOLDOWN_TICKS,
} from '../../src/enemy/states';
import { createGuard, damageGuard, isUnreachable, stepGuard, traceGuard } from '../../src/enemy/step';
import type { Cell, Guard, GuardWorld, PathResult, Point } from '../../src/enemy/step';
import { enemySource, expectPure } from './enemy-pure';

// The machine driven as behaviour, with pathing and sight injected through the
// GuardWorld port rather than imported (FR-001, FR-002, SC-001).

// A hand-drawn 16x16 room: solid border, one interior wall stub at x=8, z=2..6.
const GRID: string[] = Array.from({ length: 16 }, (_, z) => {
  if (z === 0 || z === 15) return '1'.repeat(16);
  const row = Array.from({ length: 16 }, (_, x) => (x === 0 || x === 15 ? '1' : '0'));
  if (z >= 2 && z <= 6) row[8] = '1';
  return row.join('');
});

const NO_OPEN_TILES: ReadonlySet<string> = new Set<string>();

/** A stubbed world: sight, player position, paths and damage scripted per tick. */
interface Script {
  sight: (tick: number) => boolean;
  player: (tick: number) => Point;
  path?: (from: Cell, to: Cell) => PathResult;
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

const noPath = (): PathResult => ({ cells: [], nodesExpanded: 0 });

interface Run {
  trace: string;
  lines: string[];
  states: string[];
  random: boolean[];
  guards: Guard[];
  /** The tick of each path request the stub world saw, and the goal it named. */
  pathRequests: number[];
  pathGoals: Cell[];
}

const run = (script: Script, seed: number, ticks: number, start?: Partial<Guard>): Run => {
  const rng = createRng(seed);
  let sight = false;
  let now = 0;
  const out: Run = { trace: '', lines: [], states: [], random: [], guards: [], pathRequests: [], pathGoals: [] };
  const world: GuardWorld = {
    hasLineOfSight: () => sight,
    findPath: (from, to) => {
      out.pathRequests.push(now);
      out.pathGoals.push(to);
      return (script.path ?? straightPath)(from, to);
    },
  };
  let guard = createGuard({ id: 'g0', x: 2.5, z: 10.5, ...start });
  for (let tick = 0; tick < ticks; tick += 1) {
    now = tick;
    sight = script.sight(tick);
    guard = stepGuard(guard, {
      tick, rng, grid: GRID, doorStates: NO_OPEN_TILES,
      playerPos: script.player(tick), world, damage: script.damage?.(tick) ?? 0,
    });
    out.lines.push(traceGuard(guard));
    out.states.push(guard.state);
    out.random.push(guard.randomConsumed);
    out.guards.push(guard);
  }
  out.trace = out.lines.join('\n');
  return out;
};

/** The guard as it stood at the end of `tick`. */
const at = (result: Run, tick: number): Guard => result.guards[tick] as Guard;

const never = () => false;
const always = () => true;
const farPlayer = (): Point => ({ x: 13.5, z: 10.5 });
const nearPlayer = (): Point => ({ x: 6.5, z: 10.5 });

const MODULES = ['step.ts', 'guard.ts'];

describe('step module purity (FR-001, SC-001)', () => {
  it('imports neither three nor a DOM API, and loads with no window', () => {
    for (const file of MODULES) expectPure(file);
    expect('window' in globalThis).toBe(false);
    expect(stepGuard).toBeTypeOf('function');
  });

  // The US2 seam: the port is declared here and no implementation is imported.
  it('imports neither the pathfinder nor the raycast US2 will write', () => {
    for (const file of MODULES) {
      const source = enemySource(file);
      for (const module of ['pathing', 'los', 'nav']) {
        const imported = new RegExp(`from\\s+['"]\\./${module}['"]`).test(source);
        expect(imported, `${file} imports ${module}`).toBe(false);
      }
    }
  });

  it('keeps every module under the 400-line ceiling (Article IV)', () => {
    for (const file of [...MODULES, 'states.ts', 'rng.ts']) {
      expect(enemySource(file).split('\n').length, file).toBeLessThanOrEqual(400);
    }
  });
});

describe('stepGuard is pure in its guard argument (FR-002)', () => {
  it('returns a new record and leaves its argument untouched', () => {
    const before = createGuard({ id: 'g0', x: 2.5, z: 10.5 });
    const snapshot = JSON.stringify(before);
    const after = stepGuard(before, {
      tick: 0, rng: createRng(1234), grid: GRID, doorStates: NO_OPEN_TILES,
      playerPos: farPlayer(), world: { hasLineOfSight: always, findPath: straightPath },
    });
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('idle patrol (US1-S2)', () => {
  const idle = run({ sight: never, player: farPlayer }, 1234, 40);

  it('stays idle with no player visible and no sound event', () => {
    expect(new Set(idle.states)).toEqual(new Set(['idle']));
  });

  it('turns rather than freezing, drawing from the PRNG each idle tick', () => {
    const facings = idle.guards.map((guard) => guard.facing);
    expect(new Set(facings).size).toBe(facings.length);
    expect(idle.random.every(Boolean)).toBe(true);
    for (const facing of facings) {
      expect(facing).toBeGreaterThanOrEqual(-Math.PI);
      expect(facing).toBeLessThanOrEqual(Math.PI);
    }
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
});

describe('idle -> alert on sight (US1-S3)', () => {
  const seen = 5;
  const result = run({ sight: (tick) => tick >= seen, player: nearPlayer }, 1234, seen + 2);

  it('alerts on the tick sight becomes true, recording the last known cell', () => {
    expect(result.states[seen - 1]).toBe('idle');
    expect(result.states[seen]).toBe('alert');
    expect(at(result, seen - 1).lastKnownPlayer).toBeNull();
    expect(at(result, seen).lastKnownPlayer).toEqual({ x: 6, z: 10 });
    expect(at(result, seen).lastKnownTick).toBe(seen);
  });

  it('faces the player once alerted rather than patrolling', () => {
    // The player is due +X of the guard; yaw 0 faces -Z, so facing +X is -pi/2.
    expect(at(result, seen).facing).toBeCloseTo(-Math.PI / 2, 6);
    expect(at(result, seen).randomConsumed).toBe(false);
  });
});

describe('alert (US1-S4)', () => {
  it('waits out the alert duration with sight held, then chases', () => {
    const result = run({ sight: always, player: nearPlayer }, 1234, ALERT_DURATION_TICKS + 4);
    for (let tick = 0; tick < ALERT_DURATION_TICKS; tick += 1) {
      expect(result.states[tick]).toBe('alert');
    }
    expect(result.states[ALERT_DURATION_TICKS]).toBe('chase');
  });

  it('walks to the last known position and goes home on reaching it', () => {
    const result = run({ sight: (tick) => tick === 0, player: nearPlayer }, 1234, 60);
    expect(result.states[0]).toBe('alert');

    const searching = result.guards.filter((guard) => guard.state === 'alert');
    const first = searching[0] as Guard;
    const last = searching[searching.length - 1] as Guard;
    expect(last.x).toBeGreaterThan(first.x);

    const home = result.states.indexOf('idle');
    expect(home).toBeGreaterThan(0);
    const arrival = at(result, home - 1);
    const gap = Math.hypot(arrival.x - 6.5, arrival.z - 10.5);
    expect(gap).toBeLessThanOrEqual(LAST_KNOWN_ARRIVAL_CELLS);
    expect(result.states.slice(home).every((state) => state === 'idle')).toBe(true);

    // And it walked there at the declared speed, never faster.
    for (let tick = 1; tick < result.guards.length; tick += 1) {
      const [was, is] = [at(result, tick - 1), at(result, tick)];
      const step = Math.hypot(is.x - was.x, is.z - was.z);
      expect(step, `tick ${tick}`).toBeLessThanOrEqual(MOVE_SPEED_CELLS_PER_TICK + 1e-9);
    }
  });

  it('gives up after the declared timeout when that spot is unreachable', () => {
    // One tick of sight on a player behind the wall stub: the guard walks into
    // the wall and never arrives.
    const behindWall = (): Point => ({ x: 8.5, z: 4.5 });
    const timeout = LAST_KNOWN_TIMEOUT_TICKS;
    const result = run({ sight: (tick) => tick === 0, player: behindWall }, 1234, timeout + 3, { x: 2.5, z: 4.5 });
    expect(result.states[0]).toBe('alert');
    expect(result.states[timeout - 1]).toBe('alert');
    expect(result.states[timeout]).toBe('idle');
    expect(at(result, timeout - 1).x).toBeLessThan(8);
  });
});

describe('chase (US1-S4, US1-S5, Edge Cases)', () => {
  // Sight held throughout, player parked out of attack range down the room.
  const player = farPlayer;
  const toChase = ALERT_DURATION_TICKS;

  const chasing = run({ sight: always, player }, 1234, toChase + 40);

  it('closes on the player along the injected path', () => {
    expect(chasing.states[toChase]).toBe('chase');
    expect(at(chasing, toChase + 15).x).toBeGreaterThan(at(chasing, toChase).x);
    expect(at(chasing, toChase + 15).state).toBe('chase');
  });

  it('throttles path requests to the declared interval', () => {
    const requests = chasing.pathRequests.filter((tick) => tick >= toChase);
    expect(requests.length).toBeGreaterThan(1);
    for (let i = 1; i < requests.length; i += 1) {
      const gap = (requests[i] as number) - (requests[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(PATH_REQUEST_INTERVAL_TICKS);
    }
    for (const guard of chasing.guards) expect(guard.pathable).toBe(true);
  });

  it('holds position with no path, recording pathable false when unreachable', () => {
    const unreachable = (): PathResult => ({ unreachable: true, nodesExpanded: 7 });
    const stuck = at(run({ sight: always, player, path: unreachable }, 1234, toChase + 6), toChase + 5);
    expect(stuck.state).toBe('chase');
    expect(stuck.pathable).toBe(false);
    expect(stuck.x).toBe(2.5);
    expect(isUnreachable({ unreachable: true, nodesExpanded: 0 })).toBe(true);
    expect(isUnreachable({ cells: [], nodesExpanded: 0 })).toBe(false);

    // An empty path is no licence to beeline either.
    for (const guard of run({ sight: always, player, path: noPath }, 1234, toChase + 8).guards) {
      expect(guard.x).toBe(2.5);
      expect(guard.z).toBe(10.5);
    }
  });

  it('discards a stale path when the player moves, re-requesting the new goal', () => {
    // The player teleports across the room: the stale path must be dropped rather
    // than walked, and the next request must name the new goal (Edge Cases).
    const jump = toChase + 3;
    const player2 = (tick: number): Point => (tick < jump ? { x: 13.5, z: 10.5 } : { x: 13.5, z: 2.5 });
    const result = run({ sight: always, player: player2 }, 1234, jump + 20);

    const following = at(result, jump - 1);
    expect(following.path.length).toBeGreaterThan(0);
    expect(following.pathGoal).toEqual({ x: 13, z: 10 });

    const jumped = at(result, jump);
    expect(jumped.path).toEqual([]);
    expect(jumped.pathGoal).toEqual({ x: 13, z: 2 });

    const after = result.pathRequests
      .map((tick, index) => ({ tick, goal: result.pathGoals[index] as Cell }))
      .filter((request) => request.tick >= jump);
    const first = after[0] as { tick: number; goal: Cell };
    expect(first).toBeDefined();
    expect(first.tick - jump).toBeLessThanOrEqual(PATH_REQUEST_INTERVAL_TICKS);
    expect(first.goal).toEqual({ x: 13, z: 2 });
  });
});

describe('chase -> attack on range and sight (US1-S5)', () => {
  const inRange = (): Point => ({ x: 2.5 + ATTACK_RANGE_CELLS - 0.5, z: 10.5 });
  const outOfRange = (): Point => ({ x: 2.5 + ATTACK_RANGE_CELLS + 2, z: 10.5 });
  const closes = ALERT_DURATION_TICKS + 2;

  it('attacks once the player is inside the declared range, sight held', () => {
    const player = (tick: number) => (tick < closes ? outOfRange() : inRange());
    const result = run({ sight: always, player, path: noPath }, 1234, closes + 3);
    expect(result.states[ALERT_DURATION_TICKS]).toBe('chase');
    expect(result.states[closes - 1]).toBe('chase');
    expect(result.states[closes]).toBe('attack');
  });

  it('does not attack in range without sight (US3-S5)', () => {
    const lost = ALERT_DURATION_TICKS + 1;
    const result = run({ sight: (tick) => tick < lost, player: inRange }, 1234, lost + 5);
    for (const state of result.states) expect(state).not.toBe('attack');
  });
});

describe('attack (US1-S6)', () => {
  const enters = ALERT_DURATION_TICKS + 1;

  it('arms a cooldown and wind-up on entry, then releases exactly one shot', () => {
    const result = run({ sight: always, player: nearPlayer }, 1234, enters + SHOT_COOLDOWN_TICKS + 2);
    expect(result.states[enters]).toBe('attack');
    const armed = at(result, enters);
    expect(armed.cooldownTicks).toBe(SHOT_COOLDOWN_TICKS);
    expect(armed.pendingShot).toBe(true);
    expect(armed.shotsFired).toBe(0);

    const fired = at(result, enters + ATTACK_WINDUP_TICKS);
    expect(fired.shotsFired).toBe(1);
    expect(fired.pendingShot).toBe(false);

    // It holds its ground and faces the player, drawing no randomness.
    const attacking = at(result, enters + 3);
    expect(attacking.state).toBe('attack');
    expect(attacking.x).toBe(armed.x);
    expect(attacking.z).toBe(armed.z);
    expect(attacking.facing).toBeCloseTo(-Math.PI / 2, 6);
    expect(attacking.randomConsumed).toBe(false);
  });

  it('counts the cooldown down a tick at a time and re-arms while in contact', () => {
    const ticks = enters + SHOT_COOLDOWN_TICKS * 2 + 2;
    const result = run({ sight: always, player: nearPlayer }, 1234, ticks);
    for (let i = 0; i <= SHOT_COOLDOWN_TICKS; i += 1) {
      expect(at(result, enters + i).state, `tick ${enters + i}`).toBe('attack');
      expect(at(result, enters + i).cooldownTicks, `tick ${enters + i}`).toBe(SHOT_COOLDOWN_TICKS - i);
    }
    const rearmed = at(result, enters + SHOT_COOLDOWN_TICKS + 1);
    expect(rearmed.cooldownTicks).toBe(SHOT_COOLDOWN_TICKS);
    expect(rearmed.pendingShot).toBe(true);
    expect(at(result, ticks - 1).shotsFired).toBe(2);
  });

  // US1-S6 twice over: neither losing sight nor losing range may release the
  // guard before the cooldown it is already serving has run out.
  const RELEASES: ReadonlyArray<{ why: string; script: (breaks: number) => Script }> = [
    {
      why: 'sight breaks mid-cooldown',
      script: (breaks) => ({ sight: (tick) => tick < breaks, player: nearPlayer }),
    },
    {
      why: 'the player leaves attack range',
      script: (breaks) => ({
        sight: always,
        path: noPath,
        player: (tick) => (tick < breaks ? nearPlayer() : { x: 2.5 + ATTACK_RANGE_CELLS + 3, z: 10.5 }),
      }),
    },
  ];

  for (const release of RELEASES) {
    it(`returns to chase only once the cooldown ends when ${release.why}`, () => {
      const breaks = enters + 2;
      const result = run(release.script(breaks), 1234, enters + SHOT_COOLDOWN_TICKS + 4);
      for (let tick = breaks; tick < enters + SHOT_COOLDOWN_TICKS + 1; tick += 1) {
        expect(result.states[tick], `tick ${tick} released mid-cooldown`).toBe('attack');
      }
      expect(result.states[enters + SHOT_COOLDOWN_TICKS + 1]).toBe('chase');
    });
  }
});

describe('death is terminal (US1-S7, FR-001, Edge Cases)', () => {
  const lethal = GUARD_MAX_HEALTH;
  const kill = (killAt: number) => (tick: number) => (tick === killAt ? lethal : 0);

  // One scripted approach per state, killed on a tick it is known to be in.
  const FROM: ReadonlyArray<{ state: string; killAt: number; script: Script }> = [
    { state: 'idle', killAt: 3, script: { sight: never, player: farPlayer } },
    { state: 'alert', killAt: ALERT_DURATION_TICKS - 2, script: { sight: always, player: nearPlayer } },
    { state: 'chase', killAt: ALERT_DURATION_TICKS + 1, script: { sight: always, player: farPlayer, path: noPath } },
    { state: 'attack', killAt: ALERT_DURATION_TICKS + 2, script: { sight: always, player: nearPlayer } },
  ];

  for (const from of FROM) {
    it(`enters death from ${from.state} on lethal damage, and stays there`, () => {
      const result = run({ ...from.script, damage: kill(from.killAt) }, 1234, from.killAt + 40);
      expect(result.states[from.killAt - 1]).toBe(from.state);
      expect(result.states[from.killAt]).toBe('death');
      expect(result.states.slice(from.killAt).every((state) => state === 'death')).toBe(true);
    });
  }

  it('freezes the guard: no movement, turning or PRNG draw after death', () => {
    const killAt = 3;
    const result = run({ sight: never, player: farPlayer, damage: kill(killAt) }, 1234, 40);
    const dead = at(result, killAt);
    for (const guard of result.guards.slice(killAt)) {
      expect(guard.facing).toBe(dead.facing);
      expect(guard.x).toBe(dead.x);
      expect(guard.z).toBe(dead.z);
      expect(guard.randomConsumed).toBe(false);
      // Nothing re-arms behind death's back: no cooldown, no wind-up, no shot.
      expect(guard.cooldownTicks).toBe(0);
      expect(guard.windupTicks).toBe(0);
      expect(guard.pendingShot).toBe(false);
      expect(guard.shotsFired).toBe(dead.shotsFired);
      expect(guard.path).toEqual([]);
    }
    // Its tick still advances, so a renderer can time the death animation.
    expect(at(result, 39).tick).toBe(39);
    expect(at(result, 39).ticksInState).toBe(39 - killAt);
  });

  it('cancels a pending wind-up, so no shot is released after death', () => {
    // Killed one tick into the wind-up, before the shot would have left.
    const enters = ALERT_DURATION_TICKS + 1;
    const killAt = enters + 1;
    const ticks = enters + ATTACK_WINDUP_TICKS + SHOT_COOLDOWN_TICKS + 4;
    const result = run({ sight: always, player: nearPlayer, damage: kill(killAt) }, 1234, ticks);
    expect(result.states[killAt - 1]).toBe('attack');
    expect(at(result, killAt - 1).pendingShot).toBe(true);

    const dead = at(result, killAt);
    expect(dead.state).toBe('death');
    expect(dead.pendingShot).toBe(false);
    expect(dead.windupTicks).toBe(0);
    expect(dead.cooldownTicks).toBe(0);
    expect(dead.path).toEqual([]);
    for (const guard of result.guards.slice(killAt)) {
      expect(guard.shotsFired).toBe(dead.shotsFired);
    }
  });

  it('fires no second death transition when damaged again', () => {
    const killAt = 3;
    const alwaysDamage = (tick: number) => (tick >= killAt ? lethal : 0);
    const result = run({ sight: always, player: nearPlayer, damage: alwaysDamage }, 1234, 20);
    const dead = at(result, killAt);
    expect(dead.state).toBe('death');
    expect(dead.health).toBe(0);
    for (const guard of result.guards.slice(killAt)) {
      expect(guard.health).toBe(0);
      expect(guard.stateEnteredTick, 'death is entered exactly once').toBe(dead.stateEnteredTick);
    }
    // The same refusal in the helper itself: a dead guard is returned unchanged.
    expect(damageGuard(dead, 50)).toBe(dead);
  });

  it('survives non-lethal damage and keeps behaving', () => {
    const graze = (tick: number) => (tick === 3 ? GUARD_MAX_HEALTH - 1 : 0);
    const result = run({ sight: never, player: farPlayer, damage: graze }, 1234, 10);
    expect(new Set(result.states)).toEqual(new Set(['idle']));
    expect(at(result, 9).health).toBe(1);
  });

  it('records death in the trace, which stays byte-stable across runs', () => {
    const script: Script = { sight: (tick) => tick >= 4, player: nearPlayer, damage: kill(20) };
    const first = run(script, 1234, 60);
    const second = run(script, 1234, 60);
    expect(second.trace).toBe(first.trace);
    expect(first.trace).toContain(' death ');
    expect(traceGuard(at(first, 59))).toBe(first.lines[59]);
  });
});

describe('determinism (US1-S9, FR-002, SC-002)', () => {
  // Sight cycles on and off, so a run walks idle, alert, chase and attack
  // repeatedly across its 600 ticks.
  const script: Script = {
    sight: (tick) => tick % 40 >= 12 && tick % 40 < 26,
    player: (tick) => ({ x: 6.5 + (tick % 5) * 0.1, z: 10.5 }),
  };

  const first = run(script, 1234, 600);

  it('produces byte-identical traces for seed 1234 run twice over 600 ticks', () => {
    const second = run(script, 1234, 600);
    expect(second.trace).toBe(first.trace);
    expect(second.trace.length).toBeGreaterThan(0);
    expect(new Set(first.states).size).toBeGreaterThan(2);
  });

  it('diverges under a different seed only at ticks that requested randomness', () => {
    const other = run(script, 4321, 600);
    expect(other.trace).not.toBe(first.trace);

    const differing = first.lines
      .map((line, tick) => (line === other.lines[tick] ? -1 : tick))
      .filter((tick) => tick >= 0);
    expect(differing.length).toBeGreaterThan(0);
    for (const tick of differing) {
      expect(first.random[tick], `tick ${tick} differed without drawing`).toBe(true);
      expect(other.random[tick], `tick ${tick} differed without drawing`).toBe(true);
    }
    expect(other.states, 'state transitions never consume randomness').toEqual(first.states);
  });
});
