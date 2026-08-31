import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

// FR-001: no src/enemy/ module this story writes may import three.js or touch a
// DOM API. Asserted against the source text, stated once for all three files.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|createElement)\b/;

export const enemySource = (file: string): string =>
  readFileSync(new URL(`../../src/enemy/${file}`, import.meta.url), 'utf8');

export const expectPure = (file: string): void => {
  const source = enemySource(file);
  expect(THREE_IMPORT.test(source), `${file} imports three`).toBe(false);
  expect(DOM_GLOBAL.test(source), `${file} touches a DOM API`).toBe(false);
};
