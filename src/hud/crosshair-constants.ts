// Every tuning value the crosshair spec introduces, in one file (T003, Article
// IV's spirit via the 005 lighting-rig pattern): retuning the reticle is one
// edit here and a read of this file's lines in DECISIONS.md, never a search.
//
// Values the spec leaves open are decided here and recorded in DECISIONS.md
// (Article VIII). None of them restates a value from the weapon table: the
// resting gap is the weapon's own `maxSpreadRadians` scaled by GAP_SCALE, read
// through `weaponFor()`, so `weapons.test.ts`'s scan of every importer holds
// the derived-not-authored line for this spec too.
//
// Pure data: no `three`, no DOM. The render edge reads it; the tests read it.

// --- The reticle's shape (US1) ---

/** Length in pixels of each arm beyond the gap. */
export const CROSSHAIR_ARM_LENGTH_PX = 14;

/** Width in pixels of the stroke each arm is drawn with. */
export const CROSSHAIR_STROKE_WEIGHT_PX = 2;

/** The stroke colour, straight into the drawing calls. */
export const CROSSHAIR_COLOUR = 'rgba(235, 235, 235, 0.95)';

// --- The gap's scale (FR-007; spread feedback itself is US2) ---

/** Pixels of resting gap per radian of the weapon's `maxSpreadRadians`. The
 *  pistol at 0.012 rad rests at a 3.6 px gap, the chaingun at 0.115 rad at
 *  34.5 px — the accuracy the weapon table declares, made visible, with no
 *  second tuning table anywhere in the module. */
export const CROSSHAIR_GAP_SCALE = 300;

// --- Spread feedback (US2 tunes the shape; the values are declared once) ---

/** The most movement may open the gap by, in pixels, at full sprint speed. */
export const CROSSHAIR_MOVEMENT_OPEN_PX = 10;

/** Pixels of gap one resolved shot adds, decaying over the decay time. */
export const CROSSHAIR_RECOIL_PX = 6;

/** Seconds one shot's recoil takes to fall back out of the gap. */
export const CROSSHAIR_DECAY_SECONDS = 0.18;

/** Seconds the gap takes to settle onto the weapon's resting value after
 *  movement stops, so stopping is not instant precision. */
export const CROSSHAIR_SETTLE_SECONDS = 0.35;

/** How close to the resting gap "settled" means, in pixels: once the declared
 *  settle time has passed with no movement and no fire, the gap sits within
 *  this of the weapon's resting value (FR-010). */
export const CROSSHAIR_SETTLE_TOLERANCE_PX = 1;

/** How far apart the gaps of the same weapon, speed and shot sequence stepped
 *  at 1 ms and at 250 ms may land, in pixels: the stepper eases
 *  exponentially, so the two runs agree far inside this (FR-010). */
export const CROSSHAIR_DT_TOLERANCE_PX = 0.5;

/** The smallest change in the gap, in pixels, worth recompositing the strokes
 *  for: the gap eases continuously, so an exact-equality redraw test would
 *  redraw every frame the reticle breathes, and a still reticle must cost no
 *  canvas work at all (US2, the 005 no-per-frame-work rule). */
export const CROSSHAIR_REDRAW_EPSILON_PX = 0.05;

// --- Hit and kill marks (US3) ---

/** Seconds a hit mark stays on the reticle after `hits` moves. */
export const CROSSHAIR_HIT_MARK_SECONDS = 0.18;

/** Seconds a kill mark stays — longer than a hit, because a kill is the rarer,
 *  louder event. */
export const CROSSHAIR_KILL_MARK_SECONDS = 0.45;

// --- The quad's structure, not tuning, but retuning reads better beside it ---

/** Screen pixels the reticle's canvas covers, edge to edge. The quad is sized
 *  to this span at the camera's distance and re-sized on every viewport change,
 *  which is what keeps the arms a constant pixel length across resizes. */
export const CROSSHAIR_SPAN_PX = 128;

/** The canvas resolution, in pixels, the strokes are drawn at: one canvas pixel
 *  per screen pixel across the span, so a declared pixel length is the length
 *  the player sees. */
export const CROSSHAIR_CANVAS_PX = 128;