import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkNoBinaries, FORBIDDEN_EXTENSIONS } from '../../tools/check-no-binaries.mjs';

async function withTempDir(fn: (dir: string) => Promise<unknown>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-no-binaries-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('check-no-binaries', () => {
  it('lists the expected forbidden extensions', () => {
    const expected = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'webp',
      'mp3', 'wav', 'ogg',
      'glb', 'gltf', 'fbx',
      'ttf', 'woff',
    ]);
    expect(new Set(FORBIDDEN_EXTENSIONS)).toEqual(expected);
  });

  it('returns no violations for an empty directory', async () => {
    const result = await withTempDir(async (dir) => checkNoBinaries([dir]));
    expect((result as { violations: string[] }).violations).toEqual([]);
  });

  it('detects a forbidden file at the root of the search path', async () => {
    await withTempDir(async (dir) => {
      const badFile = path.join(dir, 'texture.png');
      await fs.writeFile(badFile, 'not a real image');
      const result = await checkNoBinaries([dir]);
      expect((result as { violations: string[] }).violations).toContain(badFile);
    });
  });

  it('detects a forbidden file nested in a subdirectory', async () => {
    await withTempDir(async (dir) => {
      const nested = path.join(dir, 'assets', 'models');
      await fs.mkdir(nested, { recursive: true });
      const badFile = path.join(nested, 'mesh.glb');
      await fs.writeFile(badFile, 'not a real model');
      const result = await checkNoBinaries([dir]);
      expect((result as { violations: string[] }).violations).toContain(badFile);
    });
  });

  it('ignores node_modules and dist directories', async () => {
    await withTempDir(async (dir) => {
      const nodeModules = path.join(dir, 'node_modules', 'pkg');
      const dist = path.join(dir, 'dist');
      await fs.mkdir(nodeModules, { recursive: true });
      await fs.mkdir(dist, { recursive: true });
      await fs.writeFile(path.join(nodeModules, 'icon.png'), 'x');
      await fs.writeFile(path.join(dist, 'sprite.jpg'), 'x');
      const result = await checkNoBinaries([dir]);
      expect((result as { violations: string[] }).violations).toEqual([]);
    });
  });
});
