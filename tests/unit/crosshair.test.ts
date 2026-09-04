import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CROSSHAIR_STROKE_BUFFER_SIZE, CROSSHAIR_STROKE_COUNT, crosshairStrokes,
  fillCrosshairStrokes, type CrosshairStroke,
} from '../../src/hud/crosshair';
import {
  CROSSHAIR_DIAGNOSTIC_FIELDS, createCrosshairDiagnostics, ensureCrosshairDiag,
} from '../../src/hud/crosshair-diag';
import {
  CROSSHAIR_TOGGLE_KEY_CODES, crosshairCommandForEvent, crosshairCommandForKeyCode,
  toggleCrosshairHidden,
} from '../../src/hud/crosshair-bindings';
import {
  INTERACT_KEY_CODES, commandForKeyCode as interactCommandForKeyCode,
} from '../../src/interaction/bindings';
import { WEAPON_SELECT_KEY_CODES, weaponForKeyCode } from '../../src/combat/weapons';
import { createDiagnostics } from '../../src/diag/diag';

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

// T006 (FR-006, plan.md Performance Goals). Order 92 recomputes the stroke set
// every frame, and 005 established per-frame derivation as the cost that
// matters on this project — so the render edge fills a buffer it owns rather
// than allocating. These are the semantics that make that safe: filling writes
// the same values the allocating form returns, in place, and a buffer reused
// across calls carries nothing over.
describe('filling a reused stroke buffer (T006)', () => {
  const input = { gapPx: GAP_PX, armLengthPx: ARM_PX, viewport: { heightPx: VIEWPORT_HEIGHT_PX } };

  it('writes exactly the stroke set the allocating form returns, into the caller\'s buffer', () => {
    const buffer = new Float64Array(CROSSHAIR_STROKE_BUFFER_SIZE).fill(-7);
    const count = fillCrosshairStrokes(input, buffer);
    expect(count).toBe(CROSSHAIR_STROKE_COUNT);
    const allocated = crosshairStrokes(input);
    for (let index = 0; index < count; index += 1) {
      const stroke = allocated[index]!;
      const base = index * 4;
      expect([buffer[base], buffer[base + 1], buffer[base + 2], buffer[base + 3]]).toEqual([
        stroke.x1, stroke.y1, stroke.x2, stroke.y2,
      ]);
    }
    // Nothing outside the stroke set was touched.
    expect([...buffer].slice(count * 4).every((value) => value === -7)).toBe(true);
  });

  it('carries nothing over between fills of the same buffer', () => {
    const buffer = new Float64Array(CROSSHAIR_STROKE_BUFFER_SIZE);
    fillCrosshairStrokes({ ...input, gapPx: GAP_PX }, buffer);
    const narrow = [...buffer];
    fillCrosshairStrokes({ ...input, gapPx: GAP_PX + ARM_PX }, buffer);
    const wide = [...buffer];
    expect(wide).not.toEqual(narrow);
    // And re-filling the original answer reproduces it exactly: no hidden state.
    fillCrosshairStrokes({ ...input, gapPx: GAP_PX }, buffer);
    expect([...buffer]).toEqual(narrow);
  });

  it('honours a buffer smaller than the full set rather than writing past its end', () => {
    const short = new Float64Array(4);
    expect(fillCrosshairStrokes(input, short)).toBe(1);
  });
});

// FR-005 / US1-S6. The published shape is declared here, zeroed, and attached
// additively: the fields the smoke harness checks the running page against are
// the ones this file lists, and nothing 001–009 published moves.
describe('the crosshair diagnostics shape (FR-005, US1-S6)', () => {
  it('declares its whole field set, zeroed', () => {
    const crosshair = createCrosshairDiagnostics();
    expect(Object.keys(crosshair).sort()).toEqual([...CROSSHAIR_DIAGNOSTIC_FIELDS].sort());
    // US1-S6 names the three fields the story is verified against.
    expect(crosshair.gap).toBe(0);
    expect(crosshair.hidden).toBe(false);
    expect(crosshair.sourcesDefined).toBe(false);
  });

  it('attaches additively: every 001–009 field survives, and only `crosshair` is added', () => {
    const diag = createDiagnostics('webgl');
    const before = Object.keys(diag).sort();
    expect(ensureCrosshairDiag(diag)).toBe(ensureCrosshairDiag(diag));
    expect(Object.keys(diag).sort()).toEqual([...before, 'crosshair'].sort());
  });
});

// FR-014, US4-S1 / US4-S2 / US4-S5. The toggle is a binding like 004's interact
// keys and 007's weapon selects: one table both directions of one command resolve
// through, declared beside them in its own module because it governs the reticle
// and reaches into neither of theirs. The tests need no KeyboardEvent — the
// resolver is structural — and the "one table" claim is held by a scan of every
// source file, not just the system's own.
describe('the crosshair toggle binding (FR-014, US4-S1, US4-S2, US4-S5)', () => {
  const SRC_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));

  /** Every `.ts` file under `src/`, recursive — the whole call-site surface the
   *  one-table claim is made against. */
  function everySourceFile(root: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) found.push(...everySourceFile(resolve(root, entry.name)));
      else if (entry.name.endsWith('.ts')) found.push(resolve(root, entry.name));
    }
    return found;
  }

  const otherCodes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'Space', 'KeyE', 'F1',
    'ControlLeft', 'ControlRight', 'Digit1', 'Digit2', 'Digit3', 'Digit5', 'Digit8',
    'ShiftLeft', 'Escape', 'Enter', 'keyH', 'KeyH ', '', 'KeyJ'];

  it('maps the declared toggle key to the one toggle command, and nothing else to it', () => {
    expect([...CROSSHAIR_TOGGLE_KEY_CODES]).toEqual(['KeyH']);
    expect(crosshairCommandForKeyCode('KeyH')).toBe('toggle-crosshair');
    for (const code of otherCodes) expect(crosshairCommandForKeyCode(code), code).toBeNull();
  });

  it('resolves a keyboard event through the same table', () => {
    expect(crosshairCommandForEvent({ code: 'KeyH' })).toBe('toggle-crosshair');
    expect(crosshairCommandForEvent({ code: 'KeyJ' })).toBeNull();
    expect(crosshairCommandForEvent({})).toBeNull();
  });

  it('collides with neither 004\'s interact bindings nor 007\'s weapon selects', () => {
    const interact = new Set<string>(INTERACT_KEY_CODES);
    const weaponSelects = new Set(Object.keys(WEAPON_SELECT_KEY_CODES));
    for (const code of CROSSHAIR_TOGGLE_KEY_CODES) {
      expect(interact.has(code), `${code} collides with 004's interact bindings`).toBe(false);
      expect(weaponSelects.has(code), `${code} collides with 007's weapon selects`).toBe(false);
      expect(interactCommandForKeyCode(code), `${code} answers the interact command`).toBeNull();
      expect(weaponForKeyCode(code), `${code} answers a weapon select`).toBeNull();
    }
    // And the reverse direction: the toggle key is not inside either table.
    expect(crosshairCommandForKeyCode('Space')).toBeNull();
    expect(crosshairCommandForKeyCode('KeyE')).toBeNull();
    expect(crosshairCommandForKeyCode('Digit1')).toBeNull();
    expect(crosshairCommandForKeyCode('Digit2')).toBeNull();
    expect(crosshairCommandForKeyCode('Digit3')).toBeNull();
  });

  it('is declared in one table, and no call site maps the key itself', () => {
    const declaring = everySourceFile(SRC_ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('KeyH');
    });
    expect(declaring).toEqual([resolve(SRC_ROOT, 'hud/crosshair-bindings.ts')]);
  });

  it('installs exactly one keydown listener in the crosshair system, through the table', () => {
    const system = readFileSync(resolve(SRC_ROOT, 'systems/crosshair/register.ts'), 'utf8');
    expect(system.match(/addEventListener\(\s*'keydown'/g) ?? []).toHaveLength(1);
    expect(system).toMatch(/crosshairCommandFor(Event|KeyCode)/);
    expect(/'KeyH'|"KeyH"/.test(system)).toBe(false);
  });

  it('toggling twice returns to the original state — one command, both directions', () => {
    expect(toggleCrosshairHidden(false)).toBe(true);
    expect(toggleCrosshairHidden(true)).toBe(false);
    expect(toggleCrosshairHidden(toggleCrosshairHidden(false))).toBe(false);
    expect(toggleCrosshairHidden(toggleCrosshairHidden(true))).toBe(true);
  });
});