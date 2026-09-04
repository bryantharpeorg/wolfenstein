import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEAPON_KINDS, weaponFor, type WeaponKind } from '../../src/combat/weapons';
import {
  CROSSHAIR_GAP_SCALE, CROSSHAIR_MOVEMENT_OPEN_PX,
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