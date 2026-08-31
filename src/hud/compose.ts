// T036, T037 (FR-016, FR-018; US4-S2, US4-S3, US4-S9): the whole HUD, composited into one
// canvas that becomes one texture on one screen-space quad, inside the twenty-draw-call
// budget `002` set and `005` preserved (SC-006). It holds no run state -- the readout is
// assembled from `__diag` on the frame it is drawn (US4-S3) -- and every mark is a stroke
// from `glyphs.ts` or a shape from `portrait.ts`, because calling a canvas text API would
// mean naming a system typeface (US4-S1).

import type { WeaponKind } from '../combat/weapons';
import type { KeyKind } from '../interaction/interaction-diag';
import { HUD_LABELS, KEY_LABELS, WEAPON_LABELS, layoutText, textWidth, type GlyphStroke } from './glyphs';
import { PORTRAIT_COUNT, portraitShapes } from './portrait';

export const HUD_CANVAS_WIDTH = 1280, HUD_CANVAS_HEIGHT = 160;

export const HUD_DIGITS = { score: 6, health: 3, ammo: 3, key: 1 } as const;

const LABEL_SIZE = 18, VALUE_SIZE = 40, SMALL_SIZE = 16, STROKE_WEIGHT = 0.12;
const BACKGROUND = '#14161c', LABEL_INK = '#8a94a8', VALUE_INK = '#e8e2c8';
const KEY_INK: Readonly<Record<KeyKind, string>> = { silver: '#cfd6e0', gold: '#e8c14a' };
const KEY_ROWS: readonly [KeyKind, number][] = [['silver', 44], ['gold', 76]];
const LABEL_ROW = 14, VALUE_ROW = 44;
const COLUMNS = { score: 20, health: 300, keys: 740, weapon: 980 } as const;
const PORTRAIT_BOX = { x: 594, y: 12, width: 92, height: 124 } as const;

/** Everything the HUD shows, read from live state on the frame it is drawn (US4-S3). */
export interface HudReadout {
  readonly health: number; readonly weapon: WeaponKind; readonly ammo: number;
  readonly keys: Readonly<Record<KeyKind, number>>; readonly score: number;
  readonly portraitIndex: number;
}

export interface HudSurface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  /** Rasterised once at load -- no image file, ever (US4-S5). */
  readonly portraits: readonly HTMLCanvasElement[];
  signature: string | null;
}

type Ctx = CanvasRenderingContext2D;

export function formatCount(value: number, digits: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'.repeat(digits);
  return `${Math.min(Math.floor(value), 10 ** digits - 1)}`.padStart(digits, '0');
}

export const formatScore = (score: number, digits: number = HUD_DIGITS.score): string =>
  formatCount(score, digits);

const makeCanvas = (width: number, height: number): [HTMLCanvasElement, Ctx | null] => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')];
};

function trace(context: Ctx, points: readonly (readonly [number, number])[]): boolean {
  const [first, ...rest] = points;
  if (first == null) return false;
  context.moveTo(first[0], first[1]);
  for (const [x, y] of rest) context.lineTo(x, y);
  return true;
}

function strokeLines(context: Ctx, strokes: readonly GlyphStroke[], color: string, width: number): void {
  if (strokes.length === 0) return;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  for (const stroke of strokes) trace(context, stroke);
  context.stroke();
}

/** The one text renderer: strokes from `glyphs.ts` traced into a 2D context. Exported
 *  because 008's stats screen draws through it rather than growing a second one beside
 *  it (US4-S1, 008 US2-S5). */
export function drawGlyphText(context: Ctx, text: string, x: number, y: number, size: number, color: string): void {
  strokeLines(context, layoutText(text, x, y, size), color, Math.max(1.5, size * STROKE_WEIGHT));
}

const drawText = drawGlyphText;

/** One portrait, drawn from its recipe into its own canvas at load time (US4-S5). */
function rasterisePortrait(index: number, width: number, height: number): HTMLCanvasElement {
  const [canvas, context] = makeCanvas(width, height);
  if (context == null) return canvas;
  for (const shape of portraitShapes(index)) {
    context.beginPath();
    if (!trace(context, shape.points.map(([x, y]): [number, number] => [x * width, y * height]))) continue;
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

export function createHudSurface(): HudSurface | null {
  const [canvas, context] = makeCanvas(HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  if (context == null) return null;
  const portraits = Array.from({ length: PORTRAIT_COUNT }, (_unused, index) =>
    rasterisePortrait(index, PORTRAIT_BOX.width, PORTRAIT_BOX.height));
  return { canvas, context, portraits, signature: null };
}

const signatureOf = (readout: HudReadout): string =>
  [Math.floor(readout.health), readout.weapon, Math.floor(readout.ammo), readout.keys.silver,
    readout.keys.gold, Math.floor(readout.score), readout.portraitIndex].join('|');

/** Composites one frame and reports whether the canvas changed, which is how the system decides
 *  whether to re-upload. The readout is read afresh either way, so a change is on screen the
 *  next frame (US4-S3). */
export function drawHud(surface: HudSurface, readout: HudReadout): boolean {
  const signature = signatureOf(readout);
  if (signature === surface.signature) return false;
  surface.signature = signature;

  const context = surface.context;
  context.clearRect(0, 0, HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  const columns: readonly [number, string, string][] = [
    [COLUMNS.score, HUD_LABELS.score, formatScore(readout.score)],
    [COLUMNS.health, HUD_LABELS.health, formatCount(readout.health, HUD_DIGITS.health)],
    [COLUMNS.weapon, WEAPON_LABELS[readout.weapon], formatCount(readout.ammo, HUD_DIGITS.ammo)], ];
  for (const [x, label, value] of columns) {
    drawText(context, label, x, LABEL_ROW, LABEL_SIZE, LABEL_INK);
    drawText(context, value, x, VALUE_ROW, VALUE_SIZE, VALUE_INK);
  }

  drawText(context, HUD_LABELS.keys, COLUMNS.keys, LABEL_ROW, LABEL_SIZE, LABEL_INK);
  for (const [kind, row] of KEY_ROWS) {
    drawText(context, KEY_LABELS[kind], COLUMNS.keys, row, SMALL_SIZE, KEY_INK[kind]);
    const at = COLUMNS.keys + textWidth(KEY_LABELS[kind], SMALL_SIZE) + SMALL_SIZE;
    drawText(context, formatCount(readout.keys[kind], HUD_DIGITS.key), at, row, SMALL_SIZE, VALUE_INK);
  }

  const portrait = surface.portraits[readout.portraitIndex];
  if (portrait != null) {
    context.drawImage(portrait, PORTRAIT_BOX.x, PORTRAIT_BOX.y, PORTRAIT_BOX.width, PORTRAIT_BOX.height);
  }
  return true;
}
