// The interact binding: `Space` and `E` resolve to one command through one table
// (FR-005). Both codes land on the same value, so there is nothing for a second
// handler to be added to — a second binding would have to delete this table
// first.
//
// This layer has no notion of locks: it says only that the player asked to
// interact. What that costs, and whether it is refused, is the door's decision.
//
// Pure: no DOM, no three.js. The event shape is structural, so the doors system
// can hand a real KeyboardEvent straight in and a test can hand in an object.

/** The single command this project's interact binding produces. */
export type InteractCommand = 'interact';

/** The bound key codes, declared once (FR-005). */
export const INTERACT_KEY_CODES = ['Space', 'KeyE'] as const;

const BOUND: ReadonlySet<string> = new Set<string>(INTERACT_KEY_CODES);

/** The command a `KeyboardEvent.code` maps to, or null when it maps to none. */
export function commandForKeyCode(code: string): InteractCommand | null {
  return BOUND.has(code) ? 'interact' : null;
}

/** Anything with a `code`, which a real KeyboardEvent is. */
export interface KeyEventLike {
  code?: string;
}

/** The command a key event maps to, resolved through the same table. */
export function commandForEvent(event: KeyEventLike): InteractCommand | null {
  return commandForKeyCode(event.code ?? '');
}
