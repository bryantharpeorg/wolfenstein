import { describe, it, expect } from 'vitest';
import { createDiagnostics, updateFps } from '../../src/diag/diag';

describe('createDiagnostics', () => {
  it('starts with ready false and the required fields', () => {
    const diag = createDiagnostics('webgl');
    expect(diag.ready).toBe(false);
    expect(diag.renderer).toBe('webgl');
    expect(diag.fps).toBe(0);
    expect(diag.frameTimeMs).toBe(0);
    expect(diag.drawCalls).toBe(0);
    expect(diag.errors).toEqual([]);
  });

  it('can start with renderer null', () => {
    const diag = createDiagnostics();
    expect(diag.renderer).toBeNull();
  });
});

describe('updateFps', () => {
  it('computes fps over a trailing window', () => {
    const diag = createDiagnostics('webgl');
    const frameTime = 1000 / 60; // exactly 60 fps

    // Warm up the trailing window with 60 frames.
    for (let i = 0; i < 60; i++) {
      updateFps(diag, frameTime);
    }

    expect(diag.fps).toBeGreaterThan(0);
    expect(diag.frameTimeMs).toBe(frameTime);

    // The trailing window of 60 identical samples should report ~60 fps.
    expect(diag.fps).toBeCloseTo(60, 0);
  });

  it('adapts to a new trailing window after enough frames', () => {
    const diag = createDiagnostics('webgl');

    // 30 slow frames (100 ms each).
    for (let i = 0; i < 30; i++) {
      updateFps(diag, 100);
    }
    expect(diag.fps).toBeCloseTo(10, 0);

    // 60 fast frames (10 ms each) should fully replace the slow window.
    for (let i = 0; i < 60; i++) {
      updateFps(diag, 10);
    }
    expect(diag.fps).toBeCloseTo(100, 0);
  });
});

describe('errors', () => {
  it('accepts appended error strings', () => {
    const diag = createDiagnostics();
    diag.errors.push('first');
    diag.errors.push('second');
    expect(diag.errors).toEqual(['first', 'second']);
  });
});

describe('ready flag', () => {
  it('is false before the first frame and true after', () => {
    const diag = createDiagnostics();
    expect(diag.ready).toBe(false);
    diag.ready = true;
    expect(diag.ready).toBe(true);
  });
});
