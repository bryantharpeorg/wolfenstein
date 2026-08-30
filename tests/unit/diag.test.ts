import { describe, it, expect } from 'vitest';
import { createDiagnostics, updateFps } from '../../src/diag/diag';

describe('createDiagnostics', () => {
  it('reports ready as false before the first frame', () => {
    const diag = createDiagnostics('webgl');
    expect(diag.ready).toBe(false);
  });

  it('initialises the contract fields with the correct types', () => {
    const diag = createDiagnostics('webgpu');
    expect(diag.renderer).toBe('webgpu');
    expect(typeof diag.fps).toBe('number');
    expect(typeof diag.frameTimeMs).toBe('number');
    expect(typeof diag.drawCalls).toBe('number');
    expect(Number.isInteger(diag.drawCalls)).toBe(true);
    expect(Array.isArray(diag.errors)).toBe(true);
    expect(diag.errors.length).toBe(0);
  });

  it('can be marked ready by the caller after the first frame', () => {
    const diag = createDiagnostics('webgpu');
    diag.ready = true;
    expect(diag.ready).toBe(true);
  });
});

describe('updateFps', () => {
  it('computes fps over a trailing window', () => {
    const diag = createDiagnostics('webgl');
    updateFps(diag, 16.67); // ~60 fps instant
    expect(diag.fps).toBeGreaterThan(0);
    expect(diag.frameTimeMs).toBe(16.67);
  });

  it('converges toward the input frame rate across multiple updates', () => {
    const diag = createDiagnostics('webgl');
    // Many frames at 20ms each -> 50 fps
    for (let i = 0; i < 300; i += 1) {
      updateFps(diag, 20);
    }
    expect(diag.fps).toBeGreaterThan(40);
    expect(diag.fps).toBeLessThan(60);
    expect(diag.frameTimeMs).toBe(20);
  });

  it('ignores a zero delta to avoid division by infinity', () => {
    const diag = createDiagnostics('webgl');
    updateFps(diag, 0);
    expect(diag.fps).toBe(0);
    expect(diag.frameTimeMs).toBe(0);
  });
});

describe('errors', () => {
  it('appends error messages', () => {
    const diag = createDiagnostics('webgl');
    diag.errors.push('first failure');
    diag.errors.push('second failure');
    expect(diag.errors).toEqual(['first failure', 'second failure']);
  });
});
