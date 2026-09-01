import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TEXTURE_SIZE } from '../../src/materials/constants';
import { MATERIAL_TABLE } from '../../src/materials/table';
import { generateAlbedo } from '../../src/materials/generate';
import { fbm2D } from '../../src/materials/noise';
import { hashBuffer, makeRng } from '../../src/materials/rng';

// FR-001 / US1-S1: the generating path imports no renderer and no browser API,
// so every texel is assertable under `npm run test`. FR-004 / US1-S7: the
// resolution is one named constant, never a literal at a call site.

const MATERIALS_DIR = fileURLToPath(new URL('../../src/materials/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|HTMLImageElement|CanvasRenderingContext2D|ImageData|createImageBitmap|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;
const SIZE_LITERAL = /\b512\b/;
const NAMED_SIZE_DECLARATION = /^export const [A-Z0-9_]+ = 512;$/;

function tsFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsFilesUnder(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const materialFiles = tsFilesUnder(MATERIALS_DIR).sort();
const sources = new Map(materialFiles.map((path) => [path, readFileSync(path, 'utf8')]));

describe('generating-path purity', () => {
  it('ships the five generating modules US1 declares', () => {
    const names = materialFiles.map((path) => path.slice(MATERIALS_DIR.length));
    expect(names).toEqual(
      expect.arrayContaining([
        'constants.ts',
        'generate.ts',
        'noise.ts',
        'patterns.ts',
        'rng.ts',
        'table.ts',
      ]),
    );
  });

  it.each(materialFiles.filter((p) => !p.endsWith('texture-adapter.ts')))('%s imports three nowhere', (path: string) => {
    expect(THREE_IMPORT.test(sources.get(path)!)).toBe(false);
  });

  it('texture-adapter.ts is the only materials file that imports three', () => {
    const adapter = materialFiles.find((p) => p.endsWith('texture-adapter.ts'));
    expect(adapter).toBeDefined();
    expect(THREE_IMPORT.test(sources.get(adapter!)!)).toBe(true);
  });

  it.each(materialFiles)('%s touches no browser API', (path: string) => {
    const match = DOM_GLOBAL.exec(sources.get(path)!);
    if (match) throw new Error(`${path} references the browser global ${match[0]}`);
    expect(match).toBeNull();
  });

  it('loads from a test file that defines no window', () => {
    // vitest's node environment has no `window`; reaching this line with real
    // buffers in hand is the import-graph claim made executable.
    expect('window' in globalThis).toBe(false);
    expect(typeof makeRng).toBe('function');
    expect(typeof fbm2D).toBe('function');
    expect(hashBuffer(generateAlbedo('stone', 32).albedo)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('the declared size constant', () => {
  it('is 512 and lives in constants.ts alone', () => {
    expect(TEXTURE_SIZE).toBe(512);
    const constantsPath = join(MATERIALS_DIR, 'constants.ts');
    const declarations = sources
      .get(constantsPath)!
      .split('\n')
      .filter((line) => NAMED_SIZE_DECLARATION.test(line.trim()));
    expect(declarations).toEqual(['export const TEXTURE_SIZE = 512;']);
  });

  it('appears at no call site anywhere under src/', () => {
    for (const path of tsFilesUnder(SRC_DIR)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!SIZE_LITERAL.test(line)) return;
        // The only permitted shape is a named constant declaration; a bare 512
        // passed to a generator or a map size is the regression this catches.
        if (!NAMED_SIZE_DECLARATION.test(line.trim())) {
          throw new Error(`${path}:${index + 1} uses 512 as a literal: ${line.trim()}`);
        }
      });
    }
    expect(true).toBe(true);
  });

  it('is what the table and the generator default to', () => {
    expect(generateAlbedo('brick').albedo.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4);
    expect(Object.keys(MATERIAL_TABLE)).toHaveLength(5);
  });
});
