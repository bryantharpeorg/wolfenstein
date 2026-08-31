// Every number US4 declares about how the level is lit (FR-012, FR-013), in one
// file: tuning the rig is one edit here, and the smoke check parses these same
// names back out of it. No three.js, no browser API.

/** FR-012 wants two or more lamps; four puts one per quadrant, and two carry
 * maps: a caster is six depth renders a frame (FR-016, US4-S5). */
export const POINT_LIGHT_COUNT = 4;
export const SHADOW_CASTING_LIGHTS = 2;
export const SHADOW_MAP_SIZE = 256;
export const SHADOW_BIAS = -0.0009;

export const LIGHT_COLOR = 0xffd8a8;
export const LIGHT_INTENSITY = 11;
/** Linear, not inverse square: at decay 2 the lamp that reaches a twenty-tile
 * corridor's far end blows out the tile below it. */
export const LIGHT_DECAY = 1;
export const LIGHT_DISTANCE = 30;
export const LIGHT_HEIGHT = 1.7;

/** FR-013's floor: above zero, so an unlit corner is dim geometry rather than
 * a wall a player walks into blind (US4-S3). */
export const AMBIENT_COLOR = 0x8899bb;
export const AMBIENT_INTENSITY = 2.4;

export const FOG_COLOR = 0x0c0f16;
export const FOG_NEAR = 6;
/** Past the longest sight-line, so no tile — the exit least of all — fogs
 * away; `rig.ts` checks that against 002's grid (US4-S4). */
export const FOG_FAR = 90;

/** "Measurably darker" (US4-S2), then "not pure black" (US4-S3) as encoded
 * mean luminance on the 0..255 scale. */
export const SHADOW_CONTRAST_MARGIN = 0.15;
export const MIN_CORNER_LUMINANCE = 12;
