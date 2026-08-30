import { describe, expect, it } from 'vitest';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

describe('placeholder', () => {
  it('clamps a value between a minimum and maximum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(7, 0, 10)).toBe(7);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
