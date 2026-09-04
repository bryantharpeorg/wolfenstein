// The crosshair's toggle binding (US4, FR-014): the one key that hides and shows
// the reticle, declared once in the shape `src/interaction/bindings.ts` uses —
// a code set and a structural resolver, so a test needs no `KeyboardEvent`. It
// lives beside `004`'s interact keys and `007`'s weapon selects rather than
// reaching into either, and governs nothing else.
//
// `KeyH` collides with nothing bound: the movement WASD, `004`'s `Space`/`KeyE`,
// the fire `Control` keys, `KeyR`'s restart, `007`'s `Digit1`–`Digit3`, `008`'s
// `Digit5`–`Digit8` and `001`'s `F1` are all elsewhere (US4-S5, asserted in
// `tests/unit/crosshair.test.ts` against those tables, not against this
// comment).
//
// Pure: no `three`, no DOM.

export type CrosshairCommand = 'toggle-crosshair';

/** The bound key codes, declared once (FR-014). */
export const CROSSHAIR_TOGGLE_KEY_CODES = ['KeyH'] as const;

const BOUND: ReadonlySet<string> = new Set<string>(CROSSHAIR_TOGGLE_KEY_CODES);

export function crosshairCommandForKeyCode(code: string): CrosshairCommand | null {
  return BOUND.has(code) ? 'toggle-crosshair' : null;
}

export interface KeyEventLike {
  code?: string;
}

export function crosshairCommandForEvent(event: KeyEventLike): CrosshairCommand | null {
  return crosshairCommandForKeyCode(event.code ?? '');
}

/** The one state change the command performs, in both directions (US4-S1,
 *  US4-S2): shown becomes hidden, hidden becomes shown. The preference itself is
 *  held by the system that owns the quad — this is the pure decision, tested
 *  without a page. */
export function toggleCrosshairHidden(hidden: boolean): boolean {
  return !hidden;
}