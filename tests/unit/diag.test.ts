import { describe, it, expect } from 'vitest';
import { createDiagnostics, updateFps } from '../../src/diag/diag';

describe('diagnostics state', () => {
  it('reports ready=false before the first frame', () => {
    const diag = createDiagnostics('webgpu');
    expect(diag.ready).toBe(false);
    expect(diag.renderer).toBe('webgpu');
    expect(diag.fps).toBe(0);
    expect(diag.frameTimeMs).toBe(0);
    expect(diag.drawCalls).toBe(0);
    expect(diag.errors).toEqual([]);
  });

  it('computes fps over a trailing window', () => {
    const diag = createDiagnostics('webgl');
    // Simulate a 16ms frame sixty times to stabilise the exponential moving average.
    for (let i = 0; i < 60; i++) {
      updateFps(diag, 16.67);
    }
    expect(diag.fps).toBeGreaterThan(0);
    expect(diag.fps).toBeLessThan(1000);
    expect(diag.frameTimeMs).toBe(16.67);
  });

  it('updates ready to true after the first frame is reported', () => {
    const diag = createDiagnostics('webgpu');
    updateFps(diag, 16);
    diag.ready = true;
    expect(diag.ready).toBe(true);
  });

  it('appends strings to the errors array', () => {
    const diag = createDiagnostics('webgpu');
    diag.errors.push('first failure');
    diag.errors.push('second failure');
    expect(diag.errors).toEqual(['first failure', 'second failure']);
  });
});
