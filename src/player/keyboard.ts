// The keyboard DOM adapter: maps keydown/keyup to a live movement key set
// including Shift, taking its event source as an injected parameter so it is
// unit-testable without a browser, and clearing the set on blur so a key held
// across a focus change does not stick (FR-011, FR-012, Edge Cases).

import type { MovementKeys } from './locomotion';

export interface KeyboardEventLike {
  key: string;
  code?: string;
}

export interface KeyboardEventSource {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface KeyboardAdapter {
  readonly keys: Readonly<MovementKeys>;
  dispose(): void;
}

const FORWARD_CODES = new Set(['KeyW']);
const BACK_CODES = new Set(['KeyS']);
const LEFT_CODES = new Set(['KeyA']);
const RIGHT_CODES = new Set(['KeyD']);

function isSprint(event: KeyboardEventLike): boolean {
  return event.key === 'Shift';
}

export function createKeyboardAdapter(eventSource: KeyboardEventSource): KeyboardAdapter {
  const keys: MovementKeys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  };

  function onKeyDown(event: unknown): void {
    const e = event as KeyboardEventLike;
    const code = e.code ?? '';
    if (FORWARD_CODES.has(code)) keys.forward = true;
    else if (BACK_CODES.has(code)) keys.back = true;
    else if (LEFT_CODES.has(code)) keys.left = true;
    else if (RIGHT_CODES.has(code)) keys.right = true;
    if (isSprint(e)) keys.sprint = true;
  }

  function onKeyUp(event: unknown): void {
    const e = event as KeyboardEventLike;
    const code = e.code ?? '';
    if (FORWARD_CODES.has(code)) keys.forward = false;
    else if (BACK_CODES.has(code)) keys.back = false;
    else if (LEFT_CODES.has(code)) keys.left = false;
    else if (RIGHT_CODES.has(code)) keys.right = false;
    if (isSprint(e)) keys.sprint = false;
  }

  function onBlur(): void {
    keys.forward = false;
    keys.back = false;
    keys.left = false;
    keys.right = false;
    keys.sprint = false;
  }

  eventSource.addEventListener('keydown', onKeyDown);
  eventSource.addEventListener('keyup', onKeyUp);
  eventSource.addEventListener('blur', onBlur);

  return {
    get keys() {
      return keys;
    },
    dispose() {
      eventSource.removeEventListener('keydown', onKeyDown);
      eventSource.removeEventListener('keyup', onKeyUp);
      eventSource.removeEventListener('blur', onBlur);
    },
  };
}
