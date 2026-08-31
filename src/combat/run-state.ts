// The single gate on whether player commands resolve (FR-008, FR-010). Pure: no
// DOM, no three.js.
//
// FR-010 requires movement *and* firing to stop resolving on death, and movement
// belongs to 003. Rather than have this spec reach into 003's system — a diff in
// another spec's file, and a second place for the rule to drift — every player
// command consults this one gate. US1 opens it and reads it from the fire path;
// US2 closes it on death and reopens it on restart without editing any file this
// story owns.

/** What the gate reads at spawn, and what a restart returns it to. */
export const RUN_COMMANDS_RESOLVE_DEFAULT = true;

let resolving: boolean = RUN_COMMANDS_RESOLVE_DEFAULT;

/** Whether player commands resolve this frame. */
export function commandsResolve(): boolean {
  return resolving;
}

/** The one place the gate is closed, and the one place it is opened. */
export function setCommandsResolve(value: boolean): void {
  resolving = value;
}

/** Back to spawn: what US2's restart calls, so the gate is not left shut by a
 *  death the restart has just undone. */
export function resetRunState(): void {
  resolving = RUN_COMMANDS_RESOLVE_DEFAULT;
}
