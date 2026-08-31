// T036, T037 (FR-016, FR-018; US4-S2, US4-S3, US4-S9): the whole HUD, composited
// into one canvas. The canvas becomes one texture on one screen-space quad, which
// is the only reason a readout per mesh was never on the table: `002` set a budget
// of twenty draw calls, `005` preserved it, and this story still has a view-model
// and a muzzle flash to fit inside it (SC-006).
//
// Nothing here holds run state. `drawHud` is handed a `HudReadout` assembled from
// `__diag` on the frame it is called, so a change to health, ammo, keys or score is
// on screen the next frame by construction — there is no copy that could go stale
// (US4-S3). The one thing that *is* remembered is the signature of what was last
// drawn, which is a change detector rather than a copy: it is derived from the same
// values, so it cannot disagree with them, and it keeps a still HUD from re-uploading
// a texture sixty times a second.
//
// Every mark is a stroke from `glyphs.ts` or a shape from `portrait.ts`. No canvas
// text API is called anywhere in this file, because calling one would mean naming a
// system typeface (Constitution II, US4-S1).

import type { WeaponKind } from '../combat/weapons';
import type { KeyKind } from '../interaction/interaction-diag';
import {
  HUD_LABELS,
  KEY_LABELS,
  WEAPON_LABELS,
  layoutText,
  textWidth,
  type GlyphStroke,
} from './glyphs';
import { PORTRAIT_COUNT, portraitShapes } from './portrait';

/** The composite's pixel size. Fixed rather than viewport-sized: the quad is
 *  scaled to the screen, so a resize never reflows the layout or re-rasterises
 *  the portraits. */
export const HUD_CANVAS_WIDTH = 1024;
export const HUD_CANVAS_HEIGHT = 168;

/** The declared display widths (Edge Cases). `__diag.combat.score` keeps reporting
 *  the true value; only these digits are clamped (T037). */
export const HUD_SCORE_DIGITS = 6;
export const HUD_HEALTH_DIGITS = 3;
export const HUD_AMMO_DIGITS = 3;
export const HUD_KEY_DIGITS = 1;

const LABEL_SIZE = 18;
const VALUE_SIZE = 40;
const SMALL_SIZE = 16;

/** Pen width as a fraction of the glyph height. */
const STROKE_WEIGHT = 0.12;

const BACKGROUND = '#14161c';
const RULE = '#3c4454';
const LABEL_INK = '#8a94a8';
const VALUE_INK = '#e8e2c8';
const KEY_INK: Readonly<Record<KeyKind, string>> = { silver: '#cfd6e0', gold: '#e8c14a' };

const LABEL_ROW = 16;
const VALUE_ROW = 46;
const SMALL_ROW_ONE = 46;
const SMALL_ROW_TWO = 76;

/** Where each readout starts, left to right, with the portrait between them. */
const COLUMNS = { score: 20, health: 210, keys: 600, weapon: 800 } as const;

const PORTRAIT_BOX = { x: 418, y: 14, width: 104, height: 132 } as const;

/** Everything the HUD displays, read from live state on the frame it is drawn. */
export interface HudReadout {
  readonly health: number;
  readonly weapon: WeaponKind;
  readonly ammo: number;
  readonly keys: Readonly<Record<KeyKind, number>>;
  readonly score: number;
  readonly portraitIndex: number;
}

export interface HudSurface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  /** One per portrait, rasterised once at load — no image file, ever (US4-S5). */
  readonly portraits: readonly HTMLCanvasElement[];
  /** What was last composited, so a still frame costs no texture upload. */
  signature: string | null;
}

/** A count clamped to its declared digit width and zero-padded to it. A value
 *  wider than the display shows all nines: truncating the leading digits would
 *  read as a *smaller* number, which is worse than an obvious ceiling. */
export function formatCount(value: number, digits: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'.repeat(digits);
  const ceiling = 10 ** digits - 1;
  const clamped = Math.min(Math.floor(value), ceiling);
  return `${clamped}`.padStart(digits, '0');
}

/** The score as the HUD prints it (T037). `__diag.combat.score` is untouched by
 *  this: a display clamp never changes state. */
export function formatScore(score: number, digits: number = HUD_SCORE_DIGITS): string {
  return formatCount(score, digits);
}

function strokeLines(
  context: CanvasRenderingContext2D,
  strokes: readonly GlyphStroke[],
  color: string,
  width: number,
): void {
  if (strokes.length === 0) return;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  for (const stroke of strokes) {
    const [first, ...rest] = stroke;
    if (first == null) continue;
    context.moveTo(first[0], first[1]);
    for (const [x, y] of rest) context.lineTo(x, y);
  }
  context.stroke();
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  strokeLines(context, layoutText(text, x, y, size), color, Math.max(1.5, size * STROKE_WEIGHT));
}

/** One portrait, drawn from its recipe into its own canvas at load time. */
function rasterisePortrait(index: number, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context == null) return canvas;

  for (const shape of portraitShapes(index)) {
    const points = shape.points.map(([x, y]): [number, number] => [x * width, y * height]);
    const [first, ...rest] = points;
    if (first == null) continue;
    context.beginPath();
    context.moveTo(first[0], first[1]);
    for (const [x, y] of rest) context.lineTo(x, y);
    if (shape.kind === 'polygon') {
      context.closePath();
      context.fillStyle = shape.color;
      context.fill();
    } else {
      context.strokeStyle = shape.color;
      context.lineWidth = Math.max(1, shape.width * height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.stroke();
    }
  }
  return canvas;
}

/** The composite surface and its portraits, built once at load. Null when the
 *  page will not give a 2D context, which the HUD system reports by leaving
 *  `hudReady` false rather than by drawing half a HUD (Edge Cases). */
export function createHudSurface(): HudSurface | null {
  const canvas = document.createElement('canvas');
  canvas.width = HUD_CANVAS_WIDTH;
  canvas.height = HUD_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (context == null) return null;

  const portraits: HTMLCanvasElement[] = [];
  for (let index = 0; index < PORTRAIT_COUNT; index += 1) {
    portraits.push(rasterisePortrait(index, PORTRAIT_BOX.width, PORTRAIT_BOX.height));
  }

  return { canvas, context, portraits, signature: null };
}

/** What was drawn, derived from the readout itself so it cannot disagree with it. */
function signatureOf(readout: HudReadout): string {
  return [
    Math.floor(readout.health),
    readout.weapon,
    Math.floor(readout.ammo),
    readout.keys.silver,
    readout.keys.gold,
    Math.floor(readout.score),
    readout.portraitIndex,
  ].join('|');
}

/**
 * Composites one frame's HUD. Returns whether the canvas changed, which is what
 * the system uses to decide whether the texture needs re-uploading; the readout
 * is read afresh either way, so a changed value is always on screen the next
 * frame (US4-S3).
 */
export function drawHud(surface: HudSurface, readout: HudReadout): boolean {
  const signature = signatureOf(readout);
  if (signature === surface.signature) return false;
  surface.signature = signature;

  const context = surface.context;
  context.clearRect(0, 0, HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  strokeLines(
    context,
    [
      [
        [0, 1],
        [HUD_CANVAS_WIDTH, 1],
      ],
    ],
    RULE,
    3,
  );

  drawText(context, HUD_LABELS.score, COLUMNS.score, LABEL_ROW, LABEL_SIZE, LABEL_INK);
  drawText(context, formatScore(readout.score), COLUMNS.score, VALUE_ROW, VALUE_SIZE, VALUE_INK);

  drawText(context, HUD_LABELS.health, COLUMNS.health, LABEL_ROW, LABEL_SIZE, LABEL_INK);
  drawText(
    context,
    formatCount(readout.health, HUD_HEALTH_DIGITS),
    COLUMNS.health,
    VALUE_ROW,
    VALUE_SIZE,
    VALUE_INK,
  );

  drawText(context, HUD_LABELS.keys, COLUMNS.keys, LABEL_ROW, LABEL_SIZE, LABEL_INK);
  const keyRows: readonly [KeyKind, number][] = [
    ['silver', SMALL_ROW_ONE],
    ['gold', SMALL_ROW_TWO],
  ];
  for (const [kind, row] of keyRows) {
    drawText(context, KEY_LABELS[kind], COLUMNS.keys, row, SMALL_SIZE, KEY_INK[kind]);
    drawText(
      context,
      formatCount(readout.keys[kind], HUD_KEY_DIGITS),
      COLUMNS.keys + textWidth(KEY_LABELS[kind], SMALL_SIZE) + SMALL_SIZE,
      row,
      SMALL_SIZE,
      VALUE_INK,
    );
  }

  drawText(context, WEAPON_LABELS[readout.weapon], COLUMNS.weapon, LABEL_ROW, LABEL_SIZE, LABEL_INK);
  drawText(
    context,
    formatCount(readout.ammo, HUD_AMMO_DIGITS),
    COLUMNS.weapon,
    VALUE_ROW,
    VALUE_SIZE,
    VALUE_INK,
  );

  const portrait = surface.portraits[readout.portraitIndex];
  if (portrait != null) {
    context.drawImage(portrait, PORTRAIT_BOX.x, PORTRAIT_BOX.y, PORTRAIT_BOX.width, PORTRAIT_BOX.height);
  }

  return true;
}
