import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEVEL_GRID } from '../../src/level';
import { validateLevel } from '../../src/level-validate';

// A module that imports `three` or touches a DOM global at load time cannot be
// imported from a vitest file running in the node environment (no `window`).
// The imports above succeeding is itself part of the proof; the source-text
// assertions below make the claim explicit and catch a DOM/three reference that
// happens to sit behind a lazy branch.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

const levelSource = readFileSync(new URL('../../src/level.ts', import.meta.url), 'utf8');
const validateSource = readFileSync(
  new URL('../../src/level-validate.ts', import.meta.url),
  'utf8',
);

describe('level module purity', () => {
  it('src/level.ts imports neither three nor a DOM API', () => {
    expect(THREE_IMPORT.test(levelSource)).toBe(false);
    expect(DOM_GLOBAL.test(levelSource)).toBe(false);
  });

  it('src/level-validate.ts imports neither three nor a DOM API', () => {
    expect(THREE_IMPORT.test(validateSource)).toBe(false);
    expect(DOM_GLOBAL.test(validateSource)).toBe(false);
  });

  it('imports both modules from a test file that defines no window', () => {
    // In vitest's node environment there is no `window`; reaching this line
    // means both modules loaded without touching the DOM.
    expect(LEVEL_GRID).toBeDefined();
    expect(validateLevel).toBeTypeOf('function');
  });
});
