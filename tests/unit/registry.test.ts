import { describe, it, expect, beforeEach } from 'vitest';
import {
  defineSystem,
  collectSystems,
  resetSystemsForTest,
  DEFAULT_ORDER,
} from '../../src/boot/registry';

describe('system registry', () => {
  beforeEach(() => resetSystemsForTest());

  it('orders by `order`, then by name, not by registration order', () => {
    defineSystem({ name: 'zulu', order: 10 });
    defineSystem({ name: 'alpha', order: 50 });
    defineSystem({ name: 'bravo', order: 10 });
    expect(collectSystems().map((s) => s.name)).toEqual(['bravo', 'zulu', 'alpha']);
  });

  it('treats a missing `order` as the default rather than as zero', () => {
    defineSystem({ name: 'explicit', order: DEFAULT_ORDER - 1 });
    defineSystem({ name: 'implicit' });
    expect(collectSystems().map((s) => s.name)).toEqual(['explicit', 'implicit']);
  });

  it('refuses a duplicate name, because two systems silently sharing one is unfindable', () => {
    defineSystem({ name: 'dup' });
    expect(() => defineSystem({ name: 'dup' })).toThrow(/duplicate system name: dup/);
  });

  it('lets a system omit every lifecycle hook', () => {
    defineSystem({ name: 'inert' });
    const [only] = collectSystems();
    expect(only!.setup).toBeUndefined();
    expect(only!.update).toBeUndefined();
    expect(only!.resize).toBeUndefined();
  });
});
