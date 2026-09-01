import { describe, it, expect } from 'vitest';
import { selectBackend } from '../../src/renderer/select';

// WebGL is the default everywhere: the gates run headless Chromium, which has
// no `navigator.gpu`, so the WebGPU chain has never rendered a verified frame
// and shipped as a black screen on real Chrome (2026-09-01). WebGPU is opt-in
// via `?webgpu` and still requires the capability to actually exist.
describe('selectBackend', () => {
  it('returns "webgl" by default even when the capabilities object has a gpu entry', () => {
    const capabilities = { gpu: {} as unknown };
    expect(selectBackend(capabilities)).toBe('webgl');
  });

  it('returns "webgl" when the capabilities object has no gpu entry', () => {
    const capabilities = {};
    expect(selectBackend(capabilities)).toBe('webgl');
  });

  it('returns "webgl" when the gpu entry is null', () => {
    const capabilities = { gpu: null };
    expect(selectBackend(capabilities)).toBe('webgl');
  });

  it('returns "webgpu" when ?webgpu is in the query string and the gpu entry exists', () => {
    const capabilities = { gpu: {} as unknown };
    expect(selectBackend(capabilities, '?webgpu')).toBe('webgpu');
  });

  it('honours ?webgpu among other query parameters', () => {
    const capabilities = { gpu: {} as unknown };
    expect(selectBackend(capabilities, '?foo=1&webgpu&bar=2')).toBe('webgpu');
  });

  it('returns "webgl" when ?webgpu is requested but no gpu entry exists', () => {
    const capabilities = {};
    expect(selectBackend(capabilities, '?webgpu')).toBe('webgl');
  });

  it('returns "webgl" when ?webgpu is requested but the gpu entry is null', () => {
    const capabilities = { gpu: null };
    expect(selectBackend(capabilities, '?webgpu')).toBe('webgl');
  });
});
