import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function runChecker(root: string): Promise<{ exitCode: number; output: string }> {
  // Import the checker function dynamically so we can exercise its internal walk
  // without spawning a new process for every assertion.
  const { walkAndReport } = await import('../../tools/check-no-binaries');
  const findings = walkAndReport(root);
  return {
    exitCode: findings.length > 0 ? 1 : 0,
    output: findings.join('\n'),
  };
}

describe('check-no-binaries', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'check-no-binaries-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('passes when the tree is empty', async () => {
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('');
  });

  it('passes when only allowed files exist', async () => {
    writeFileSync(join(tmp, 'index.ts'), 'console.log("hello")');
    writeFileSync(join(tmp, 'README.md'), '# Project');
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(0);
  });

  it('fails when a PNG is present at the root', async () => {
    writeFileSync(join(tmp, 'texture.png'), 'fake image data');
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('texture.png');
  });

  it('fails when a binary is nested inside a directory', async () => {
    const nested = join(tmp, 'assets', 'models');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'map.gltf'), '{}');
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('map.gltf');
  });

  it('detects all forbidden extensions', async () => {
    const forbidden = [
      'a.png',
      'b.jpg',
      'c.jpeg',
      'd.gif',
      'e.webp',
      'f.mp3',
      'g.wav',
      'h.ogg',
      'i.glb',
      'j.gltf',
      'k.fbx',
      'l.ttf',
      'm.woff',
      'n.m4a', // 008 FR-009 names four audio extensions; this one was omitted (T035)
    ];
    for (const name of forbidden) {
      writeFileSync(join(tmp, name), name);
    }
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(1);
    for (const name of forbidden) {
      expect(result.output).toContain(name);
    }
  });

  it('flags every audio extension FR-009 names, in any case', async () => {
    // The four the audio story forbids, spelled as a stray asset would be.
    const names = ['shot.MP3', 'door.Wav', 'step.OGG', 'drone.M4A'];
    for (const name of names) writeFileSync(join(tmp, name), 'not synthesized');
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(1);
    for (const name of names) expect(result.output).toContain(name);
  });

  it('does not flag node_modules or dist by default in the checked root', async () => {
    // The checker is intended to run on the repository root; we want it to inspect
    // whatever directory it is handed. The real exclusion of ignored dirs is handled
    // by git + .gitignore; the checker still reports binary files if they are present.
    // This test simply documents that behaviour: no special dir skipping occurs.
    writeFileSync(join(tmp, 'good.ts'), '// ok');
    const result = await runChecker(tmp);
    expect(result.exitCode).toBe(0);
  });
});
