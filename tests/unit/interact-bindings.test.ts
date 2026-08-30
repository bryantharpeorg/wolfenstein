import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  INTERACT_KEY_CODES,
  commandForKeyCode,
  commandForEvent,
} from '../../src/interaction/bindings';

// FR-005: the binding is data — one table both key codes resolve through — so a
// second handler cannot be added without deleting this test.

describe('the interact binding (FR-005)', () => {
  it('maps Space to the interact command', () => {
    expect(commandForKeyCode('Space')).toBe('interact');
  });

  it('maps KeyE to the same interact command', () => {
    expect(commandForKeyCode('KeyE')).toBe('interact');
    expect(commandForKeyCode('KeyE')).toBe(commandForKeyCode('Space'));
  });

  it('maps every other key code to no command', () => {
    const others = [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyF',
      'Enter',
      'Escape',
      'ShiftLeft',
      'ArrowUp',
      'Space ',
      'space',
      'e',
      '',
    ];
    for (const code of others) {
      expect(commandForKeyCode(code), code).toBeNull();
    }
  });

  it('declares exactly the two bound codes', () => {
    expect([...INTERACT_KEY_CODES].sort()).toEqual(['KeyE', 'Space']);
  });

  it('resolves a keyboard event through the same table', () => {
    expect(commandForEvent({ code: 'Space' })).toBe('interact');
    expect(commandForEvent({ code: 'KeyE' })).toBe('interact');
    expect(commandForEvent({ code: 'KeyW' })).toBeNull();
    expect(commandForEvent({})).toBeNull();
  });
});

describe('one command path, not two handlers (FR-005)', () => {
  const source = readFileSync(
    new URL('../../src/interaction/bindings.ts', import.meta.url),
    'utf8',
  );
  const systemSource = readFileSync(
    new URL('../../src/systems/doors/register.ts', import.meta.url),
    'utf8',
  );

  it('has no notion of keys or locks — the door decides that', () => {
    expect(/silver|gold|inventory/i.test(source)).toBe(false);
  });

  it('installs exactly one keydown listener in the doors system', () => {
    const listeners = systemSource.match(/addEventListener\(\s*'keydown'/g) ?? [];
    expect(listeners).toHaveLength(1);
  });

  it('resolves that listener through the bindings table rather than comparing codes', () => {
    expect(systemSource).toMatch(/commandFor(Event|KeyCode)/);
    expect(/'Space'|"Space"|'KeyE'|"KeyE"/.test(systemSource)).toBe(false);
  });
});
