// Every named constant the door, crush and field modules read, in one place so
// tuning never chases literals across files. Mirrors 003's `player/params.ts`.

export const DOOR_TRAVEL_MS = 800;

/** Milliseconds a fully open door waits before closing itself (FR-004). */
export const DOOR_DWELL_MS = 3000;

/** The declared maximum per-frame delta (FR-002, US1-S8): a longer frame — a
 * resumed tab, a GC pause — is clamped, so a door never teleports past a
 * transition. It is 500 because US1-S3 steps in 500 ms ticks. */
export const MAX_STEP_MS = 500;

export const DOOR_TRAVEL_TILES = 1;

/** A secret push-wall travels exactly two tiles (FR-012); US3 reads this. */
export const SECRET_TRAVEL_TILES = 2;

/** One tile of reach: the player's own tile and its four orthogonal neighbours. */
export const INTERACT_REACH_TILES = 1;
