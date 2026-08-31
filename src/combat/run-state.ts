// The single gate on whether player commands resolve (FR-008, FR-010). Pure.
// FR-010 stops movement *and* firing on death and movement belongs to 003, so
// rather than reach into 003's system every command consults this gate.

/** What the gate reads at spawn, and returns to on restart. */
export const RUN_COMMANDS_RESOLVE_DEFAULT = true;

let resolving: boolean = RUN_COMMANDS_RESOLVE_DEFAULT;

/** Whether player commands resolve this frame. */
export function commandsResolve(): boolean {
  return resolving;
}

/** The one place it is closed, and the one place opened. */
export function setCommandsResolve(value: boolean): void {
  resolving = value;
}

/** What US2's restart calls, so an undone death leaves it open. */
export function resetRunState(): void {
  resolving = RUN_COMMANDS_RESOLVE_DEFAULT;
}
