import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { INTERACT_KEY_CODES, commandForKeyCode, commandForEvent } from '../../src/interaction/bindings';

// FR-005: the binding is data — one table both key codes resolve through — so a
// second handler cannot be added without deleting this test.

describe('the interact binding (FR-005)', () => {
  it('maps Space and KeyE to the one interact command', () => {
    expect(commandForKeyCode('Space')).toBe('interact');
    expect(commandForKeyCode('KeyE')).toBe('interact');
    expect(commandForKeyCode('KeyE')).toBe(commandForKeyCode('Space'));
    expect([...INTERACT_KEY_CODES].sort()).toEqual(['KeyE', 'Space']);
  });

  it('maps every other key code to no command', () => {
    const others = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyF', 'Enter', 'Escape',
      'ShiftLeft', 'ArrowUp', 'Space ', 'space', 'e', ''];
    for (const code of others) expect(commandForKeyCode(code), code).toBeNull();
  });

  it('resolves a keyboard event through the same table', () => {
    expect(commandForEvent({ code: 'Space' })).toBe('interact');
    expect(commandForEvent({ code: 'KeyE' })).toBe('interact');
    expect(commandForEvent({ code: 'KeyW' })).toBeNull();
    expect(commandForEvent({})).toBeNull();
  });
});

describe('one command path, not two handlers (FR-005)', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  const bindings = read('../../src/interaction/bindings.ts');
  const system = read('../../src/systems/doors/register.ts');

  it('has no notion of keys or locks — the door decides that', () => {
    expect(/silver|gold|inventory/i.test(bindings)).toBe(false);
  });

  it('installs exactly one keydown listener in the doors system', () => {
    expect(system.match(/addEventListener\(\s*'keydown'/g) ?? []).toHaveLength(1);
  });

  it('resolves that listener through the bindings table rather than comparing codes', () => {
    expect(system).toMatch(/commandFor(Event|KeyCode)/);
    expect(/'Space'|"Space"|'KeyE'|"KeyE"/.test(system)).toBe(false);
  });
});
