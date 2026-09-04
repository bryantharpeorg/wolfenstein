import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEAPON_KINDS, weaponFor, type WeaponKind } from '../../src/combat/weapons';
import {
  CROSSHAIR_DT_TOLERANCE_PX, CROSSHAIR_GAP_SCALE, CROSSHAIR_MOVEMENT_OPEN_PX,
  CROSSHAIR_RECOIL_PX, CROSSHAIR_SETTLE_SECONDS, CROSSHAIR_SETTLE_TOLERANCE_PX,
} from '../../src/hud/crosshair-constants';
import {
  createCrosshairSpreadState, movementOpenPx, restingGapPx, stepCrosshairSpread,
} from '../../src/hud/crosshair-spread';
import { SPRINT_SPEED, WALK_SPEED } from '../../src/player/params';

// US2, FR-007 to FR-010. The gap stepper is a pure function of declared
// inputs: the weapon table's own spread, the player's measured speed, the
// shots-fired counter and elapsed seconds. Every value asserted here is read
// from the table that owns it — none is restated — because a reticle that
// carried its own tuning table would fall out of agreement with the weapon
// table the first time a weapon is retuned.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const ENTRY = 'hud/crosshair-spread.ts';
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

const readSource = (path: string): string => readFileSync(path, 'utf8');

/** Every file reachable from `entry` by relative import, `entry` included. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const match of readSource(path).matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1]!;
      queue.push(resolve(dirname(path), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
    }
  }
  return [...seen].sort();
}

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"])/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

/** A state settled at rest, so each scenario starts from the same known place. */
function settledState(kind: WeaponKind): ReturnType<typeof createCrosshairSpreadState> {
  const state = createCrosshairSpreadState(kind);
  for (let step = 0; step < 300; step += 1) {
    stepCrosshairSpread(state, { weapon: kind, speed: 0, shotsFired: 0, elapsedSeconds: 0.016 });
  }
  return state;
}

const stepOnce = (
  state: ReturnType<typeof createCrosshairSpreadState>,
  kind: WeaponKind,
  speed: number,
  shotsFired: number,
  elapsedSeconds: number,
): number =>
  stepCrosshairSpread(state, { weapon: kind, speed, shotsFired, elapsedSeconds });

describe('the spread stepper module (FR-007, US2-S2)', () => {
  const graph = importGraph(ENTRY);

  it('reaches only files free of three and of the DOM', () => {
    expect(graph).toContain(resolve(SRC, ENTRY));
    for (const path of graph) {
      const source = readSource(path);
      expect(THREE_IMPORT.test(source), `${path} imports three`).toBe(false);
      const dom = DOM_GLOBAL.exec(source);
      if (dom) throw new Error(`${path} references the browser global ${dom[0]}`);
    }
  });

  it('reads the gap through the weapon table, so the literal scan binds on it', () => {
    // The scan in `weapons.test.ts` only fires on importers of the weapon
    // module: this assertion is what makes it this spec's check too, rather
    // than a scan that happens to cover the file.
    expect(readSource(resolve(SRC, ENTRY))).toMatch(/from\s+['"]\.\.\/combat\/weapons['"]/);
  });
});

describe('the resting gaps (FR-007, US2-S1)', () => {
  it('derives each resting gap from the weapon table through its own accessor', () => {
    for (const kind of WEAPON_KINDS) {
      expect(restingGapPx(kind))
        .toBeCloseTo(weaponFor(kind).maxSpreadRadians * CROSSHAIR_GAP_SCALE, 12);
    }
  });

  it('orders them strictly pistol < SMG < chaingun, in the order 007 fixed', () => {
    expect(restingGapPx('pistol')).toBeLessThan(restingGapPx('smg'));
    expect(restingGapPx('smg')).toBeLessThan(restingGapPx('chaingun'));
  });
});

describe('movement opens the gap (FR-008, US2-S3)', () => {
  const SPEEDS = [
    0, 0.01, 0.5, 1, WALK_SPEED, (WALK_SPEED + SPRINT_SPEED) / 2, SPRINT_SPEED,
    SPRINT_SPEED * 2, 40, 1e4,
  ];

  it('increases monotonically with player speed up to the sprint speed', () => {
    let previous = -Infinity;
    for (const speed of SPEEDS) {
      const open = movementOpenPx(speed);
      expect(open).toBeGreaterThanOrEqual(previous);
      if (speed <= SPRINT_SPEED) expect(open).toBeGreaterThan(previous);
      previous = open;
    }
  });

  it('never exceeds the declared ceiling however fast the player moves', () => {
    for (const speed of [...SPEEDS, 1e6, Number.MAX_VALUE]) {
      expect(movementOpenPx(speed)).toBeLessThanOrEqual(CROSSHAIR_MOVEMENT_OPEN_PX + 1e-12);
    }
  });

  it('reaches the ceiling at the declared sprint speed and holds it beyond', () => {
    expect(movementOpenPx(SPRINT_SPEED)).toBeCloseTo(CROSSHAIR_MOVEMENT_OPEN_PX, 12);
    expect(movementOpenPx(SPRINT_SPEED * 4)).toBeCloseTo(CROSSHAIR_MOVEMENT_OPEN_PX, 12);
  });

  it('answers zero for a still player, and for a non-finite or negative speed', () => {
    expect(movementOpenPx(0)).toBe(0);
    expect(movementOpenPx(Number.NaN)).toBe(0);
    expect(movementOpenPx(Number.POSITIVE_INFINITY)).toBe(0);
    expect(movementOpenPx(-1)).toBe(0);
  });

  it('opens monotonically through the stepper itself, under the ceiling', () => {
    let previous = -Infinity;
    for (const speed of SPEEDS) {
      const state = createCrosshairSpreadState('smg');
      let gap = 0;
      for (let step = 0; step < 400; step += 1) {
        gap = stepOnce(state, 'smg', speed, 0, 0.01);
      }
      const resting = restingGapPx('smg');
      expect(gap).toBeGreaterThanOrEqual(previous);
      expect(gap).toBeLessThanOrEqual(resting + CROSSHAIR_MOVEMENT_OPEN_PX + 1e-9);
      previous = gap;
    }
  });
});

describe('a shot opens the gap and it decays (FR-009, US2-S4)', () => {
  it('adds the declared recoil on the frame the counter rises', () => {
    const state = settledState('pistol');
    const before = stepOnce(state, 'pistol', 0, 0, 0.016);
    const after = stepOnce(state, 'pistol', 0, 1, 0.016);
    expect(after - before).toBeCloseTo(CROSSHAIR_RECOIL_PX, 9);
  });

  it('adds one declared recoil per shot when several leave in one step', () => {
    const state = settledState('chaingun');
    const before = stepOnce(state, 'chaingun', 0, 0, 0.016);
    const after = stepOnce(state, 'chaingun', 0, 3, 0.016);
    expect(after - before).toBeCloseTo(CROSSHAIR_RECOIL_PX * 3, 9);
  });

  it('decays smoothly back toward the resting gap after the shot', () => {
    const state = settledState('smg');
    stepOnce(state, 'smg', 0, 0, 0.016);
    const resting = restingGapPx('smg');
    let previous = stepOnce(state, 'smg', 0, 1, 0.016);
    expect(previous).toBeCloseTo(resting + CROSSHAIR_RECOIL_PX, 9);
    for (let step = 0; step < 150; step += 1) {
      const gap = stepOnce(state, 'smg', 0, 1, 0.016);
      expect(gap).toBeLessThan(previous);
      previous = gap;
    }
    // Ten decay times on, one shot's recoil is spent to within a thousandth.
    expect(Math.abs(previous - resting))
      .toBeLessThanOrEqual(CROSSHAIR_RECOIL_PX * Math.exp(-10) + 1e-9);
  });

  it('treats a falling counter as a restart, not a burst of shots', () => {
    const state = settledState('pistol');
    stepOnce(state, 'pistol', 0, 5, 0.016);
    const before = stepOnce(state, 'pistol', 0, 5, 0.016);
    const after = stepOnce(state, 'pistol', 0, 0, 0.016);
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThan(CROSSHAIR_RECOIL_PX);
  });
});

describe('settling (FR-010, US2-S5)', () => {
  it.each([...WEAPON_KINDS])('%s settles onto its resting gap after the declared settle time',
    (kind: WeaponKind) => {
      const state = settledState(kind);
      for (let step = 0; step < 60; step += 1) {
        stepOnce(state, kind, SPRINT_SPEED, 0, 0.016);
      }
      expect(stepOnce(state, kind, 0, 0, 0.016)).toBeGreaterThan(restingGapPx(kind));
      let gap = 0;
      for (let step = 0; step < 25; step += 1) {
        gap = stepOnce(state, kind, 0, 0, 0.016);
      }
      expect(Math.abs(gap - restingGapPx(kind)))
        .toBeLessThanOrEqual(CROSSHAIR_SETTLE_TOLERANCE_PX);
    });

  it('settles within tolerance after a sprint and a shot both stop', () => {
    const kind: WeaponKind = 'chaingun';
    const state = settledState(kind);
    for (let step = 0; step < 60; step += 1) {
      stepOnce(state, kind, SPRINT_SPEED, 0, 0.016);
    }
    const fired = stepOnce(state, kind, SPRINT_SPEED, 1, 0.016);
    expect(fired).toBeGreaterThan(restingGapPx(kind) + CROSSHAIR_MOVEMENT_OPEN_PX);
    let gap = 0;
    for (let step = 0; step < Math.ceil(CROSSHAIR_SETTLE_SECONDS / 0.016); step += 1) {
      gap = stepOnce(state, kind, 0, 1, 0.016);
    }
    expect(Math.abs(gap - restingGapPx(kind)))
      .toBeLessThanOrEqual(CROSSHAIR_SETTLE_TOLERANCE_PX);
  });
});
describe('the same sequence at 1 ms and at 250 ms (FR-010, US2-S6, SC-004)', () => {
  // One declared sequence: rest, sprint, stop, walk, with a weapon switch at
  // 1.5 s and shots at 0.75 s, 1.5 s, 2.25 s and 2.75 s. Every boundary —
  // the switch, the shots, the speed segments — sits on a multiple of the
  // coarse delta, and each step reads its inputs at the instant the step
  // *begins*, so both runs hold the same inputs over the same elapsed time
  // and the comparison measures the stepper's elapsed-seconds discipline
  // rather than how finely either run can resolve an input change. A speed
  // segment holds from its first instant up to the next one's, so a boundary
  // instant belongs to the segment that starts there.
  const SCENARIO = {
    start: 'pistol' as WeaponKind,
    switchAt: 1.5,
    switched: 'chaingun' as WeaponKind,
    speeds: [
      { from: 0.0, speed: 0 },
      { from: 0.5, speed: SPRINT_SPEED },
      { from: 1.25, speed: 0 },
      { from: 2.0, speed: WALK_SPEED },
    ],
    shots: [0.75, 1.5, 2.25, 2.75],
    duration: 3.0,
  };
  const SAMPLE_EVERY = 0.25;

  const speedAt = (t: number): number =>
    [...SCENARIO.speeds].reverse().find((segment) => t >= segment.from - 1e-9)?.speed ?? 0;

  function simulate(dtSeconds: number): number[] {
    const state = createCrosshairSpreadState(SCENARIO.start);
    const steps = Math.round(SCENARIO.duration / dtSeconds);
    const samples: number[] = [];
    let shots = 0;
    for (let index = 0; index < steps; index += 1) {
      const starts = index * dtSeconds;
      const ends = (index + 1) * dtSeconds;
      // The shot is an impulse the step observes at its end — the frame the
      // counter moves reports the full recoil — so both runs place it at the
      // same instant and decay it identically thereafter.
      while (shots < SCENARIO.shots.length && SCENARIO.shots[shots]! <= ends + 1e-9) shots += 1;
      const weapon = starts >= SCENARIO.switchAt - 1e-9 ? SCENARIO.switched : SCENARIO.start;
      const gap = stepCrosshairSpread(state, {
        weapon, speed: speedAt(starts), shotsFired: shots, elapsedSeconds: dtSeconds,
      });
      if (Math.abs(ends / SAMPLE_EVERY - Math.round(ends / SAMPLE_EVERY)) < 1e-9) samples.push(gap);
    }
    return samples;
  }

  it('lands both steppings on the same gaps, within the declared tolerance', () => {
    const fine = simulate(0.001);
    const coarse = simulate(0.25);
    expect(fine).toHaveLength(coarse.length);
    expect(fine.length).toBeGreaterThan(5);
    // Not vacuous: the sequence genuinely moves the gap around.
    expect(Math.max(...fine) - Math.min(...fine)).toBeGreaterThan(CROSSHAIR_RECOIL_PX);
    for (let index = 0; index < fine.length; index += 1) {
      expect(Math.abs(fine[index]! - coarse[index]!))
        .toBeLessThanOrEqual(CROSSHAIR_DT_TOLERANCE_PX);
    }
  });

  it('lands both steppings on the same gaps at an intermediate delta too', () => {
    const fine = simulate(0.001);
    const middle = simulate(0.05);
    expect(middle).toHaveLength(fine.length);
    for (let index = 0; index < fine.length; index += 1) {
      expect(Math.abs(fine[index]! - middle[index]!))
        .toBeLessThanOrEqual(CROSSHAIR_DT_TOLERANCE_PX);
    }
  });
});

describe('a weapon switch eases, not snaps (US2-S7)', () => {
  const REST_SECONDS = 0.016;

  function settledOn(kind: WeaponKind): ReturnType<typeof createCrosshairSpreadState> {
    const state = settledState(kind);
    stepOnce(state, kind, 0, 0, REST_SECONDS);
    return state;
  }

  it('moves the gap toward the new resting value from below without overshooting it', () => {
    const state = settledOn('pistol');
    const from = restingGapPx('pistol');
    const to = restingGapPx('chaingun');
    let gap = stepOnce(state, 'chaingun', 0, 0, REST_SECONDS);
    expect(gap).toBeGreaterThan(from);
    expect(gap).toBeLessThan(to);
    for (let step = 0; step < 100; step += 1) {
      const next = stepOnce(state, 'chaingun', 0, 0, REST_SECONDS);
      expect(next).toBeGreaterThanOrEqual(gap);
      expect(next).toBeLessThan(to);
      gap = next;
    }
    expect(gap).toBeGreaterThanOrEqual(to - CROSSHAIR_SETTLE_TOLERANCE_PX);
  });

  it('moves the gap toward the new resting value from above without undershooting it', () => {
    const state = settledOn('chaingun');
    const from = restingGapPx('chaingun');
    const to = restingGapPx('pistol');
    let gap = stepOnce(state, 'pistol', 0, 0, REST_SECONDS);
    expect(gap).toBeLessThan(from);
    expect(gap).toBeGreaterThan(to);
    for (let step = 0; step < 100; step += 1) {
      const next = stepOnce(state, 'pistol', 0, 0, REST_SECONDS);
      expect(next).toBeLessThanOrEqual(gap);
      expect(next).toBeGreaterThan(to);
      gap = next;
    }
    expect(gap).toBeLessThanOrEqual(to + CROSSHAIR_SETTLE_TOLERANCE_PX);
  });
});
