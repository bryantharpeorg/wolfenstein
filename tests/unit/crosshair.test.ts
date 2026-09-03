import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  crosshairStrokes, type CrosshairStroke,
} from '../../src/hud/crosshair';

// FR-001 / FR-002, US1-S1 / US1-S2. The reticle's geometry is a pure function:
// a gap, an arm length and a viewport in, four stroke segments out, as plain
// numbers. *Purity*: neither `three` nor a DOM API appears anywhere in the
// module's import graph, walked transitively because a pure file importing an
// impure one is not pure; the import above loading under vitest's node
// environment is half the proof, the source scan catches a lazy-branch
// reference. The viewport is an argument, not a read of the window, and the
// same call with a different argument answers differently.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|HTMLImageElement|CanvasRenderingContext2D|ImageData|createImageBitmap|requestAnimationFrame|addEventListener|removeEventListener|getElementById|createElement|MouseEvent|KeyboardEvent)\b/;

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const ENTRY = 'hud/crosshair.ts';
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

const readSource = (path: string): string => readFileSync(path, 'utf8');

/** Every file reachable from `entry` by relative import, `entry` included. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const match of readSource(path).matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1]!;
      queue.push(resolve(dirname(path), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
    }
  }
  return [...seen].sort();
}

const graph = importGraph(ENTRY);

// The declared values the scenarios name: a gap the reticle opens to and the
// arm length beyond it, on a viewport tall enough never to clamp them.
const GAP_PX = 6;
const ARM_PX = 14;
const VIEWPORT_HEIGHT_PX = 720;

const strokesAt = (gap: number, arm: number, height: number): readonly CrosshairStroke[] =>
  crosshairStrokes({ gapPx: gap, armLengthPx: arm, viewport: { heightPx: height } });

const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  a.x === b.x && a.y === b.y;

/** Every coordinate the stroke set touches, as points. */
const points = (strokes: readonly CrosshairStroke[]): { x: number; y: number }[] =>
  strokes.flatMap((s) => [
    { x: s.x1, y: s.y1 },
    { x: s.x2, y: s.y2 },
  ]);

describe('crosshair geometry module purity (FR-001, US1-S1)', () => {
  it('reaches only files free of three and of the DOM', () => {
    expect(graph).toContain(resolve(SRC, ENTRY));
    for (const path of graph) {
      const source = readSource(path);
      expect(THREE_IMPORT.test(source), `${path} imports three`).toBe(false);
      const dom = DOM_GLOBAL.exec(source);
      if (dom) throw new Error(`${path} references the browser global ${dom[0]}`);
    }
  });

  it('loads from a test file that defines no window', () => {
    expect('window' in globalThis).toBe(false);
    expect(crosshairStrokes).toBeTypeOf('function');
  });
});

describe('the reticle stroke set (FR-002, US1-S2)', () => {
  it('is exactly four segments', () => {
    expect(strokesAt(GAP_PX, ARM_PX, VIEWPORT_HEIGHT_PX)).toHaveLength(4);
  });

  it('is symmetric about the origin in both axes', () => {
    const strokes = strokesAt(GAP_PX, ARM_PX, VIEWPORT_HEIGHT_PX);
    const touched = points(strokes);
    for (const stroke of strokes) {
      // Point symmetry about the origin: the stroke's negation is also a stroke.
      const negated = { x: -stroke.x1, y: -stroke.y1 };
      expect(touched.some((p) => samePoint(negated, p))).toBe(true);
      // And each single-axis mirror is too, so the set is symmetric in x and in y.
      const mirroredX = { x: -stroke.x1, y: stroke.y1 };
      const mirroredY = { x: stroke.x1, y: -stroke.y1 };
      expect(touched.some((p) => samePoint(mirroredX, p))).toBe(true);
      expect(touched.some((p) => samePoint(mirroredY, p))).toBe(true);
    }
  });

  it('begins each arm at the gap and extends it outward by the arm length', () => {
    const strokes = strokesAt(GAP_PX, ARM_PX, VIEWPORT_HEIGHT_PX);
    const vertical = strokes.filter((s) => s.x1 === 0 && s.x2 === 0);
    const horizontal = strokes.filter((s) => s.y1 === 0 && s.y2 === 0);
    expect(vertical).toHaveLength(2);
    expect(horizontal).toHaveLength(2);

    for (const stroke of vertical) {
      expect(Math.abs(stroke.y1)).toBeCloseTo(GAP_PX, 10);
      expect(Math.abs(stroke.y2)).toBeCloseTo(GAP_PX + ARM_PX, 10);
      // Outward: the far end is farther from the origin than the near end.
      expect(Math.abs(stroke.y2)).toBeGreaterThan(Math.abs(stroke.y1));
    }
    expect(Math.sign(vertical[0]!.y1)).toBe(-Math.sign(vertical[1]!.y1));

    for (const stroke of horizontal) {
      expect(Math.abs(stroke.x1)).toBeCloseTo(GAP_PX, 10);
      expect(Math.abs(stroke.x2)).toBeCloseTo(GAP_PX + ARM_PX, 10);
      expect(Math.abs(stroke.x2)).toBeGreaterThan(Math.abs(stroke.x1));
    }
    expect(Math.sign(horizontal[0]!.x1)).toBe(-Math.sign(horizontal[1]!.x1));
  });

  it('answers differently for a different gap', () => {
    const narrow = strokesAt(GAP_PX, ARM_PX, VIEWPORT_HEIGHT_PX);
    const wide = strokesAt(GAP_PX + ARM_PX, ARM_PX, VIEWPORT_HEIGHT_PX);
    const widest = Math.max(...points(wide).map((p) => Math.abs(p.x) + Math.abs(p.y)));
    const narrowest = Math.max(...points(narrow).map((p) => Math.abs(p.x) + Math.abs(p.y)));
    expect(widest).toBeGreaterThan(narrowest);
  });
});

describe('degenerate inputs still answer with finite coordinates (Edge Cases)', () => {
  const finitePoints = (strokes: readonly CrosshairStroke[]): boolean =>
    points(strokes).every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );

  it('a zero gap', () => {
    const strokes = strokesAt(0, ARM_PX, VIEWPORT_HEIGHT_PX);
    expect(strokes).toHaveLength(4);
    expect(finitePoints(strokes)).toBe(true);
    // Nothing is NaN, and every arm still reaches out from the origin.
    for (const stroke of strokes) {
      expect(Math.abs(stroke.x1) + Math.abs(stroke.y1)).toBe(0);
      expect(Math.abs(stroke.x2) + Math.abs(stroke.y2)).toBeGreaterThan(0);
    }
  });

  it('a zero-height viewport', () => {
    const strokes = strokesAt(GAP_PX, ARM_PX, 0);
    expect(strokes).toHaveLength(4);
    expect(finitePoints(strokes)).toBe(true);
  });

  it('a viewport too small to hold the reticle clamps it inside rather than answering NaN', () => {
    const strokes = strokesAt(GAP_PX, ARM_PX, ARM_PX); // half the viewport is one arm
    expect(finitePoints(strokes)).toBe(true);
    const reach = Math.max(...points(strokes).map((p) => Math.abs(p.x) + Math.abs(p.y)));
    expect(reach).toBeLessThanOrEqual(ARM_PX);
  });

  it('inputs that are not numbers at all', () => {
    expect(finitePoints(strokesAt(Number.NaN, ARM_PX, VIEWPORT_HEIGHT_PX))).toBe(true);
    expect(finitePoints(strokesAt(GAP_PX, Number.POSITIVE_INFINITY, VIEWPORT_HEIGHT_PX))).toBe(true);
    expect(finitePoints(strokesAt(GAP_PX, ARM_PX, Number.NaN))).toBe(true);
    expect(finitePoints(strokesAt(Number.NaN, ARM_PX, 0))).toBe(true);
  });
});