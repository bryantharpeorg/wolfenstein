/**
 * The seam's actual contract: a story adds `src/systems/<name>/register.ts` and no
 * shared file changes. This asserts the discovery glob matches that shape, so a
 * refactor that quietly reintroduces an index file fails here rather than in a
 * merge-queue conflict three stories later.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const systemsDir = resolve(root, 'src/systems');

describe('system discovery', () => {
  it('gives every system directory a register.ts', () => {
    const dirs = readdirSync(systemsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      expect(existsSync(resolve(systemsDir, dir, 'register.ts'))).toBe(true);
    }
  });

  it('discovers by glob, so adding a system edits no shared file', () => {
    const discover = readFileSync(resolve(root, 'src/boot/discover.ts'), 'utf8');
    expect(discover).toMatch(/import\.meta\.glob\(\s*'\.\.\/systems\/\*\/register\.ts'/);
  });

  it('keeps main.ts out of the business of naming individual systems', () => {
    const main = readFileSync(resolve(root, 'src/main.ts'), 'utf8');
    expect(main).not.toMatch(/from '\.\/systems\//);
  });
});
