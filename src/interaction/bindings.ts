// `Space` and `E` resolve to one interact command through one table (FR-005), so
// there is nothing for a second handler to be added to. This layer has no notion
// of locks; the event shape is structural, so a test needs no KeyboardEvent.

export type InteractCommand = 'interact';

/** The bound key codes, declared once (FR-005). */
export const INTERACT_KEY_CODES = ['Space', 'KeyE'] as const;

const BOUND: ReadonlySet<string> = new Set<string>(INTERACT_KEY_CODES);

export function commandForKeyCode(code: string): InteractCommand | null {
  return BOUND.has(code) ? 'interact' : null;
}

export interface KeyEventLike {
  code?: string;
}

export function commandForEvent(event: KeyEventLike): InteractCommand | null {
  return commandForKeyCode(event.code ?? '');
}
