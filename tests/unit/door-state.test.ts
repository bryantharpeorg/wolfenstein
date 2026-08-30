import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createDoor,
  stepDoor,
  interactDoor,
  DOOR_STATES,
  type Door,
} from '../../src/interaction/door';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS, MAX_STEP_MS } from '../../src/interaction/params';

// US1-S1: the door module must be importable from a test file that defines no
// `window` and pulls in no three.js. The imports above succeeding is half the
// proof; the source-text assertions below catch a DOM or three reference that
// happens to sit behind a lazy branch.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

function source(relative: string): string {
  return readFileSync(new URL(`../../src/interaction/${relative}`, import.meta.url), 'utf8');
}

/** Advances a door by `totalMs` in ticks of `tickMs`, the way a frame loop would. */
function advance(door: Door, totalMs: number, tickMs: number): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const step = Math.min(tickMs, remaining);
    stepDoor(door, step);
    remaining -= step;
  }
}

function openDoor(): Door {
  const door = createDoor({ x: 1, z: 1, axis: 'z' });
  interactDoor(door);
  advance(door, DOOR_TRAVEL_MS, 16);
  return door;
}

describe('door module purity (US1-S1, FR-001)', () => {
  it('imports neither three nor a DOM API', () => {
    for (const file of ['door.ts', 'params.ts', 'outcomes.ts', 'crush.ts', 'gate-registry.ts']) {
      expect(THREE_IMPORT.test(source(file)), file).toBe(false);
      expect(DOM_GLOBAL.test(source(file)), file).toBe(false);
    }
  });

  it('loads in an environment with no window defined', () => {
    expect(typeof globalThis).toBe('object');
    expect('window' in globalThis).toBe(false);
    expect(createDoor).toBeTypeOf('function');
  });
});

describe('door states (FR-001)', () => {
  it('declares exactly the four states', () => {
    expect([...DOOR_STATES]).toEqual(['closed', 'opening', 'open', 'closing']);
  });

  it('starts closed at progress 0', () => {
    const door = createDoor({ x: 3, z: 4, axis: 'x' });
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });
});

describe('door travel (US1-S2, US1-S3, FR-002)', () => {
  it('opens on interact and advances progress from 0 toward 1', () => {
    const door = createDoor({ x: 1, z: 1, axis: 'z' });
    expect(interactDoor(door)).toBe('opened');
    expect(door.state).toBe('opening');

    stepDoor(door, DOOR_TRAVEL_MS / 4);
    expect(door.progress).toBeCloseTo(0.25, 12);
    expect(door.state).toBe('opening');

    advance(door, DOOR_TRAVEL_MS, 16);
    expect(door.progress).toBe(1);
    expect(door.state).toBe('open');
  });

  it('doubles progress when elapsed time doubles', () => {
    const door = createDoor({ x: 1, z: 1, axis: 'z' });
    interactDoor(door);
    stepDoor(door, DOOR_TRAVEL_MS / 8);
    const single = door.progress;
    stepDoor(door, DOOR_TRAVEL_MS / 8);
    expect(door.progress).toBeCloseTo(single * 2, 12);
  });

  it('reaches the same progress at 1 ms ticks and 500 ms ticks within 1e-6', () => {
    const fine = createDoor({ x: 1, z: 1, axis: 'z' });
    const coarse = createDoor({ x: 1, z: 1, axis: 'z' });
    interactDoor(fine);
    interactDoor(coarse);

    const total = DOOR_TRAVEL_MS * 0.75;
    advance(fine, total, 1);
    advance(coarse, total, 500);

    expect(Math.abs(fine.progress - coarse.progress)).toBeLessThan(1e-6);
    expect(fine.progress).toBeCloseTo(0.75, 6);
  });

  it('never exceeds progress 1', () => {
    const door = createDoor({ x: 1, z: 1, axis: 'z' });
    interactDoor(door);
    advance(door, DOOR_TRAVEL_MS * 3, 100);
    expect(door.progress).toBe(1);
    expect(door.state).toBe('open');
  });
});

describe('delta clamping (US1-S8, FR-002)', () => {
  it('clamps a single oversized delta to the declared maximum step', () => {
    const clamped = createDoor({ x: 1, z: 1, axis: 'z' });
    const exact = createDoor({ x: 1, z: 1, axis: 'z' });
    interactDoor(clamped);
    interactDoor(exact);

    stepDoor(clamped, 60_000);
    stepDoor(exact, MAX_STEP_MS);

    expect(clamped.progress).toBeCloseTo(exact.progress, 12);
    expect(clamped.state).toBe(exact.state);
  });

  it('ignores a negative or non-finite delta', () => {
    const door = createDoor({ x: 1, z: 1, axis: 'z' });
    interactDoor(door);
    stepDoor(door, -100);
    stepDoor(door, Number.NaN);
    expect(door.progress).toBe(0);
    expect(door.state).toBe('opening');
  });

  it('reports every transition it passes through in one step', () => {
    const door = openDoor();
    // One clamped step cannot skip the close: dwell is longer than the max step.
    const result = stepDoor(door, MAX_STEP_MS);
    expect(result.outcomes).toEqual([]);
    expect(door.state).toBe('open');
  });
});

describe('dwell and unaided close (US1-S4, FR-004)', () => {
  it('closes itself after dwellMs with no further input', () => {
    const door = openDoor();
    advance(door, DOOR_DWELL_MS, 100);
    expect(door.state).toBe('closing');

    advance(door, DOOR_TRAVEL_MS, 100);
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });

  it('stays open until the dwell has fully elapsed', () => {
    const door = openDoor();
    advance(door, DOOR_DWELL_MS - 100, 100);
    expect(door.state).toBe('open');
    expect(door.progress).toBe(1);
  });
});
