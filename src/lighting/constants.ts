// Every number US4 declares about how the level is lit (FR-012, FR-013,
// US4-S1). Tuning the rig — a bias that causes acne, a fog that closes too
// early — is one edit here, never a literal chased across a system file and a
// harness check: `rig.ts`, the lighting system and tools/smoke-checks read
// these same names. No three.js and no browser API, so this file is read
// under `npm run test`.

/** FR-012 asks for at least two; four puts one in each quadrant of the level. */
export const POINT_LIGHT_COUNT = 4;
/** Columns of the lattice `rig.ts` lays over the walkable bounds; rows follow. */
export const LIGHT_LATTICE_COLS = 2;
/** How many of those lamps carry a cube shadow map. Every one past FR-012's
 * two is six more depth renders: on the software renderer the smoke gate uses,
 * four casters cost a third of the frame rate two cost, so the rig shadows the
 * two nearest 002's spawn and exit anchors — where the player is (FR-016). */
export const SHADOW_CASTING_LIGHTS = 2;
/** Edge of each cube-map face, in texels. Doubling it costs the first frame
 * roughly 180 ms on that same renderer, and 001's harness reads `fps` off a
 * trailing average the first frame dominates (FR-016, US4-S5). */
export const SHADOW_MAP_SIZE = 256;
/** Negative, pulling the depth comparison toward the light: the cure for
 * surface acne, and the line to change if a wall detaches from its shadow. */
export const SHADOW_BIAS = -0.0009;
/** Offset along the normal, doing what a larger bias would without peeling the
 * contact shadow away. */
export const SHADOW_NORMAL_BIAS = 0.03;
export const SHADOW_CAMERA_NEAR = 0.15;
/** The level is static but for 004's doors, so cube faces refresh on an
 * interval rather than every frame (FR-016, US4-S5). */
export const SHADOW_REFRESH_FRAMES = 12;

/** Warm lamp, so a lit surface reads differently from an ambient one. */
export const LIGHT_COLOR = 0xffd8a8;
export const LIGHT_INTENSITY = 11;
/** Linear falloff, not the physical inverse square: a corridor here is twenty
 * tiles long, and at decay 2 the lamp that reaches the far end blows out the
 * tile it hangs over. `LIGHT_INTENSITY` means nothing without it. */
export const LIGHT_DECAY = 1;
/** Reach, wide enough to spill through a doorway — which is where shadows are. */
export const LIGHT_DISTANCE = 30;
/** Lamp height above `FLOOR_Y`, below the 2-unit ceiling. */
export const LIGHT_HEIGHT = 1.7;

/** Cool fill, so the ambient term does not read as a second lamp. */
export const AMBIENT_COLOR = 0x8899bb;
/** FR-013's readable floor: above zero by construction, so an unlit corner is
 * dim geometry rather than a wall a player walks into blind (US4-S3). */
export const AMBIENT_INTENSITY = 2.4;

/** Fog colour, and the scene's clear colour with it, so a sight-line fades
 * into the value the far wall does instead of onto a seam. */
export const FOG_COLOR = 0x0c0f16;
/** Where the fog starts: past a room's width, so nothing near the player is
 * tinted, and well past the probe camera's own height. */
export const FOG_NEAR = 6;
/** Where the fog is total. Past the shipped level's longest sight-line, so no
 * tile — the exit least of all — is fogged out of existence; `rig.ts` asserts
 * that against 002's grid rather than against this comment (US4-S4). */
export const FOG_FAR = 90;
/** The most fog US4-S4 allows at the far end of that sight-line: a surface
 * still contributing 15% of its own colour is what "discernible" has to mean
 * for a value a machine can check. */
export const MAX_FOG_FACTOR_AT_SIGHT_LINE = 0.85;
/** How much darker an occluded floor sample must be than the same sample
 * unoccluded. "Measurably darker" (US4-S2) needs a number, and 15% is far
 * outside the renderer's own frame-to-frame noise. */
export const SHADOW_CONTRAST_MARGIN = 0.15;
/** "Not pure black" (US4-S3) as sRGB mean luminance on the 0..255 scale, well
 * above the fog colour the scene clears to. */
export const MIN_CORNER_LUMINANCE = 12;
