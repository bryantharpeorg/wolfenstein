// Every number US1 declares about the shape and cost of a generated material,
// in one place. Lowering the resolution is an edit here plus a line in
// DECISIONS.md — never five edits at five call sites (FR-004, US1-S7).

/** Edge length of every generated map, in texels (FR-004). */
export const TEXTURE_SIZE = 512;

/** Channels per texel in the raw RGBA buffers the generator returns (FR-001). */
export const RGBA_CHANNELS = 4;

/** The declared budget for generating all five materials once per page load.
 * Exceeding it records a number for diagnostics rather than aborting the load
 * — a slow machine is not a broken build (FR-004, US1-S8, Edge Cases). */
export const GENERATION_BUDGET_MS = 1500;

/** Mean channel units (0..255) by which any two materials must differ, so five
 * materials cannot resolve to the same grey and still pass (US1-S5). */
export const MEAN_DISTINCTNESS_THRESHOLD = 8;

/** Edge of the square a material's spatial structure is measured over (US1-S6). */
export const VARIANCE_TILE_PX = 16;

/** Fraction of those tiles that must carry non-zero variance: three quarters,
 * so a flat fill cannot pass as a texture (US1-S6). */
export const VARIANCE_TILE_COVERAGE = 0.75;
