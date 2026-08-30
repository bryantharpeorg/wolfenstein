import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDoor, stepDoor, interactDoor, DOOR_STATES } from '../../src/interaction/door';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS, MAX_STEP_MS } from '../../src/interaction/params';
import { advance, doorInState } from './door-advance';

// US1-S1: the imports above succeeding is half the proof; the source-text
// assertions below catch a DOM or three reference behind a lazy branch.
const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

const door = (): ReturnType<typeof createDoor> => createDoor({ x: 1, z: 1, axis: 'z' });

describe('door module purity (US1-S1, FR-001)', () => {
  it('imports neither three nor a DOM API', () => {
    for (const file of ['door.ts', 'params.ts', 'outcomes.ts', 'crush.ts', 'gate-registry.ts']) {
      const source = readFileSync(new URL(`../../src/interaction/${file}`, import.meta.url), 'utf8');
      expect(THREE_IMPORT.test(source), file).toBe(false);
      expect(DOM_GLOBAL.test(source), file).toBe(false);
    }
  });

  it('loads in an environment with no window defined', () => {
    expect('window' in globalThis).toBe(false);
    expect(createDoor).toBeTypeOf('function');
  });
});

describe('door states (FR-001)', () => {
  it('declares exactly the four states', () => {
    expect([...DOOR_STATES]).toEqual(['closed', 'opening', 'open', 'closing']);
  });

  it('starts closed at progress 0', () => {
    const subject = createDoor({ x: 3, z: 4, axis: 'x' });
    expect(subject.state).toBe('closed');
    expect(subject.progress).toBe(0);
  });
});

describe('door travel (US1-S2, US1-S3, FR-002)', () => {
  it('opens on interact and advances progress from 0 toward 1', () => {
    const subject = door();
    expect(interactDoor(subject)).toBe('opened');
    expect(subject.state).toBe('opening');

    stepDoor(subject, DOOR_TRAVEL_MS / 4);
    expect(subject.progress).toBeCloseTo(0.25, 12);
    expect(subject.state).toBe('opening');

    advance(subject, DOOR_TRAVEL_MS, 16);
    expect(subject.progress).toBe(1);
    expect(subject.state).toBe('open');
  });

  it('doubles progress when elapsed time doubles', () => {
    const subject = door();
    interactDoor(subject);
    stepDoor(subject, DOOR_TRAVEL_MS / 8);
    const single = subject.progress;
    stepDoor(subject, DOOR_TRAVEL_MS / 8);
    expect(subject.progress).toBeCloseTo(single * 2, 12);
  });

  it('reaches the same progress at 1 ms ticks and 500 ms ticks within 1e-6', () => {
    const fine = door();
    const coarse = door();
    interactDoor(fine);
    interactDoor(coarse);

    advance(fine, DOOR_TRAVEL_MS * 0.75, 1);
    advance(coarse, DOOR_TRAVEL_MS * 0.75, 500);

    expect(Math.abs(fine.progress - coarse.progress)).toBeLessThan(1e-6);
    expect(fine.progress).toBeCloseTo(0.75, 6);
  });

  it('never exceeds progress 1', () => {
    const subject = door();
    interactDoor(subject);
    advance(subject, DOOR_TRAVEL_MS * 3, 100);
    expect(subject.progress).toBe(1);
    expect(subject.state).toBe('open');
  });
});

describe('delta clamping (US1-S8, FR-002)', () => {
  it('clamps a single oversized delta to the declared maximum step', () => {
    const clamped = door();
    const exact = door();
    interactDoor(clamped);
    interactDoor(exact);

    stepDoor(clamped, 60_000);
    stepDoor(exact, MAX_STEP_MS);

    expect(clamped.progress).toBeCloseTo(exact.progress, 12);
    expect(clamped.state).toBe(exact.state);
  });

  it('ignores a negative or non-finite delta', () => {
    const subject = door();
    interactDoor(subject);
    stepDoor(subject, -100);
    stepDoor(subject, Number.NaN);
    expect(subject.progress).toBe(0);
    expect(subject.state).toBe('opening');
  });

  it('jumps past no transition it should have reported', () => {
    // One clamped step cannot skip the close: dwell is longer than the max step.
    const subject = doorInState('open');
    const result = stepDoor(subject, MAX_STEP_MS);
    expect(result.outcomes).toEqual([]);
    expect(subject.state).toBe('open');
  });
});

describe('dwell and unaided close (US1-S4, FR-004)', () => {
  it('closes itself after dwellMs with no further input', () => {
    const subject = doorInState('open');
    advance(subject, DOOR_DWELL_MS);
    expect(subject.state).toBe('closing');

    advance(subject, DOOR_TRAVEL_MS);
    expect(subject.state).toBe('closed');
    expect(subject.progress).toBe(0);
  });

  it('stays open until the dwell has fully elapsed', () => {
    const subject = doorInState('open');
    advance(subject, DOOR_DWELL_MS - 100);
    expect(subject.state).toBe('open');
    expect(subject.progress).toBe(1);
  });
});
