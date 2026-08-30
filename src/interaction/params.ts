// The interaction parameter table: every named constant the door, crush, secret
// and field modules read, declared once so tuning never chases literals across
// files. Mirrors 003's `src/player/params.ts`. Pure data: no DOM, no three.js.

/** Wall-clock milliseconds a door takes to travel its full tile, open or closed. */
export const DOOR_TRAVEL_MS = 800;

/** Milliseconds a fully open door waits before closing itself (FR-004). */
export const DOOR_DWELL_MS = 3000;

/**
 * The declared maximum per-frame delta (FR-002, US1-S8). A frame delta larger
 * than this — a background tab resuming, a long GC pause — is clamped, so a door
 * can never teleport past a transition it should have reported.
 *
 * It is 500 rather than something smaller because US1-S3 requires a 500 ms tick
 * to integrate in full: stepping the same total time as 1 ms ticks and as 500 ms
 * ticks must agree within 1e-6, which a clamp below 500 would break.
 */
export const MAX_STEP_MS = 500;

/** A door's leaf retracts exactly one tile into the wall beside it. */
export const DOOR_TRAVEL_TILES = 1;

/** A secret push-wall travels exactly two tiles (FR-012); US3 reads this. */
export const SECRET_TRAVEL_TILES = 2;

/**
 * How far from a tile's centre the player may stand and still command it. One
 * tile of reach means the player's own tile and its four orthogonal neighbours.
 */
export const INTERACT_REACH_TILES = 1;
