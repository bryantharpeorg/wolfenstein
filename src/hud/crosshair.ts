// The reticle's geometry (US1, FR-001, FR-002): a gap, an arm length and a
// viewport in, four stroke segments out, as plain numbers. The module imports
// nothing — no `three`, no DOM API — which is what lets `npm run test` exercise
// it and what the import-graph scan in `tests/unit/crosshair.test.ts` holds.
// The viewport arrives as an argument rather than being read off the browser.
//
// Every mark the crosshair ever draws is a stroke computed here. There is no
// image file, no font and no glyph table (FR-002, Constitution II): a stroke is
// two endpoints, and four of them are the whole reticle.

/** The viewport the strokes must fit inside, as an argument rather than a read
 *  of the browser's own dimensions. Only the height bears on the geometry: the reticle is square
 *  in reach, so fitting the height fits the width. */
export interface CrosshairViewport {
  readonly heightPx: number;
}

/** One stroke, in pixels relative to the screen centre. The near endpoint sits
 *  at the gap, the far one an arm length beyond it. */
export interface CrosshairStroke {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface CrosshairStrokesInput {
  /** Distance in pixels from the centre to the near end of each arm. */
  readonly gapPx: number;
  /** Length in pixels of each arm beyond the gap. */
  readonly armLengthPx: number;
  readonly viewport: CrosshairViewport;
}

/** Four strokes: up, down, left and right of the centre. */
export const CROSSHAIR_STROKE_COUNT = 4;

/** The coordinates one stroke carries: `x1, y1, x2, y2`. */
export const CROSSHAIR_STROKE_COORDS = 4;

/** What one stroke set occupies in a flat buffer. */
export const CROSSHAIR_STROKE_BUFFER_SIZE = CROSSHAIR_STROKE_COUNT * CROSSHAIR_STROKE_COORDS;

/** A viewport with no measurable height still answers with a stroke set — held
 *  at this many pixels of half-height, so a clamped set never degenerates to
 *  NaN and never collapses a real arm to zero. */
const MIN_HALF_HEIGHT_PX = 1;

/** Non-positive and non-finite inputs mean "absent", not "infinite": a gap of
 *  NaN is a gap of zero, because a reticle that answers NaN draws nothing and
 *  the frame still has to render. */
function clamped(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The strokes, written into `out` — `CROSSHAIR_STROKE_BUFFER_SIZE` numbers, four
 *  per stroke — rather than allocated, because the caller recomputes them every
 *  frame. Returns the stroke count written. The viewport is a fit clamp, not a
 *  scale: arms keep their declared pixel length in any viewport that fits them,
 *  and a viewport that cannot hold the reticle scales the whole set down to
 *  half its height rather than drawing past the screen edge. */
export function fillCrosshairStrokes(
  input: CrosshairStrokesInput,
  out: Float64Array,
): number {
  const gap = clamped(input.gapPx);
  const arm = clamped(input.armLengthPx);
  const height = input.viewport.heightPx;
  const half = Number.isFinite(height) && height > 0 ? height / 2 : MIN_HALF_HEIGHT_PX;
  // The longest coordinate any stroke touches from the origin.
  const reach = gap + arm;
  const scale = reach > 0 ? Math.min(1, half / reach) : 1;

  const vertical = gap * scale;
  const outer = reach * scale;
  const strokes = [
    // up, down, left, right — a fixed order, so index arithmetic in the buffer
    // is stable for the callers that write straight into one.
    { x1: 0, y1: -vertical, x2: 0, y2: -outer },
    { x1: 0, y1: vertical, x2: 0, y2: outer },
    { x1: -vertical, y1: 0, x2: -outer, y2: 0 },
    { x1: vertical, y1: 0, x2: outer, y2: 0 },
  ];
  for (let index = 0; index < strokes.length && index * CROSSHAIR_STROKE_COORDS < out.length; index += 1) {
    const stroke = strokes[index]!;
    const base = index * CROSSHAIR_STROKE_COORDS;
    out[base] = stroke.x1;
    out[base + 1] = stroke.y1;
    out[base + 2] = stroke.x2;
    out[base + 3] = stroke.y2;
  }
  return Math.min(CROSSHAIR_STROKE_COUNT, Math.floor(out.length / CROSSHAIR_STROKE_COORDS));
}

/** The stroke set, allocated: the shape tests and one-shot callers read. The
 *  render edge uses `fillCrosshairStrokes` into a buffer it owns instead. */
export function crosshairStrokes(input: CrosshairStrokesInput): readonly CrosshairStroke[] {
  const out = new Float64Array(CROSSHAIR_STROKE_BUFFER_SIZE);
  const count = fillCrosshairStrokes(input, out);
  const strokes: CrosshairStroke[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = index * CROSSHAIR_STROKE_COORDS;
    strokes.push({
      x1: out[base]!,
      y1: out[base + 1]!,
      x2: out[base + 2]!,
      y2: out[base + 3]!,
    });
  }
  return strokes;
}