import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GENERATE_REQUEST, startGeneration } from '../../src/systems/materials/generation';

// US3-S11: the story's title says "without breaking the budget", and generating
// five 512px materials with their derived maps is a third of a second. Spent on
// the main thread it is a third of a second of animation frames, and `__diag.fps`
// is a trailing window read the moment the loop reports ready — the harness read
// 4.6 fps against a floor of 5. So the generating path runs on a worker, and what
// makes that possible is US1's purity: no three.js, no DOM, nothing a second
// thread lacks. These assertions hold that seam open and hold the degradation
// honest, because vitest's node environment is itself a platform with no worker.

const WORKER = fileURLToPath(new URL('../../src/systems/materials/generation-worker.ts', import.meta.url));
const workerSource = readFileSync(WORKER, 'utf8');

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const IMPORT_SOURCE = /^\s*import\s[^;]*?from\s+'([^']+)';/gm;

describe('generation on a worker', () => {
  it('imports only the generating path, so no renderer is loaded on a second thread', () => {
    expect(THREE_IMPORT.test(workerSource)).toBe(false);
    const sources = [...workerSource.matchAll(IMPORT_SOURCE)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toMatch(/^(\.\.\/\.\.\/materials\/|\.\/generation$)/);
    }
  });

  it('answers one declared request, so an unrelated message generates nothing', () => {
    expect(GENERATE_REQUEST).toBeTypeOf('string');
    expect(GENERATE_REQUEST.length).toBeGreaterThan(0);
    expect(workerSource).toContain('GENERATE_REQUEST');
  });

  it('degrades to the caller on a platform with no worker rather than throwing', () => {
    expect('Worker' in globalThis).toBe(false);

    const delivered: unknown[] = [];
    let failures = 0;
    const run = startGeneration(
      5,
      (maps) => delivered.push(maps),
      () => {
        failures += 1;
      },
    );

    // The caller reads `offThread` and generates the materials itself; it is not
    // told through a callback, because a callback that may or may not fire is a
    // second way to learn the same fact.
    expect(run.offThread).toBe(false);
    expect(delivered).toEqual([]);
    expect(failures).toBe(0);
  });

  it('can be stopped more than once, including when it never started', () => {
    const run = startGeneration(5, () => {}, () => {});
    expect(() => {
      run.stop();
      run.stop();
    }).not.toThrow();
  });
});
