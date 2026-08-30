import { describe, it, expect } from 'vitest';
import { walkAndReport } from '../../tools/check-no-binaries';

describe('placeholder', () => {
  it('exports a walkAndReport function that returns an array', () => {
    const result = walkAndReport('.');
    expect(Array.isArray(result)).toBe(true);
  });
});
