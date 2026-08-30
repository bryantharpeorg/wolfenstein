import { describe, it, expect } from 'vitest';
import { createDiagnostics, recordFrame } from '../../src/diag/diag';

describe('diag', () => {
  it('starts with ready false and the requested renderer', () => {
    const diag = createDiagnostics('webgpu');
    expect(diag.ready).toBe(false);
    expect(diag.renderer).toBe('webgpu');
    expect(diag.fps).toBe(0);
    expect(diag.frameTimeMs).toBe(0);
    expect(diag.drawCalls).toBe(0);
    expect(diag.errors).toEqual([]);
    expect(diag.fallbackReason).toBe(null);
  });

  it('uses webgl as the default renderer', () => {
    const diag = createDiagnostics();
    expect(diag.renderer).toBe('webgl');
  });

  it('marks ready true after the first frame completes', () => {
    const diag = createDiagnostics('webgl');
    recordFrame(diag, 16.67);
    expect(diag.ready).toBe(true);
  });

  it('computes fps over a trailing window of frames', () => {
    const diag = createDiagnostics('webgpu');
    for (let i = 0; i < 60; i++) {
      recordFrame(diag, 16.67);
    }
    expect(diag.fps).toBeCloseTo(60, 0);

    for (let i = 0; i < 60; i++) {
      recordFrame(diag, 33.33);
    }
    expect(diag.fps).toBeCloseTo(30, 0);
  });

  it('records frame time each frame', () => {
    const diag = createDiagnostics();
    recordFrame(diag, 8.33);
    expect(diag.frameTimeMs).toBe(8.33);
  });

  it('keeps a trailing window rather than an infinite average', () => {
    const diag = createDiagnostics();
    // Fill the window with 8ms frames (125 fps implied).
    for (let i = 0; i < 60; i++) {
      recordFrame(diag, 8);
    }
    expect(diag.fps).toBeCloseTo(125, 0);

    // A single slow frame should not collapse the average to itself.
    recordFrame(diag, 1000);
    expect(diag.fps).toBeGreaterThan(30);
    expect(diag.fps).toBeLessThan(125);
  });

  it('exposes an errors array that callers can append to', () => {
    const diag = createDiagnostics();
    diag.errors.push('boom');
    expect(diag.errors).toEqual(['boom']);
  });
});
