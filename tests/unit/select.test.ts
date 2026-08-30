import { describe, it, expect } from 'vitest';
import { selectBackend } from '../../src/renderer/select';

describe('selectBackend', () => {
  it('returns "webgpu" when the capabilities object has a gpu entry', () => {
    const capabilities = { gpu: {} as unknown };
    expect(selectBackend(capabilities)).toBe('webgpu');
  });

  it('returns "webgl" when the capabilities object has no gpu entry', () => {
    const capabilities = {};
    expect(selectBackend(capabilities)).toBe('webgl');
  });

  it('returns "webgl" when the gpu entry is null', () => {
    const capabilities = { gpu: null };
    expect(selectBackend(capabilities)).toBe('webgl');
  });
});
