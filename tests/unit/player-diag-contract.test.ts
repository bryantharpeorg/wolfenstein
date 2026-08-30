import { describe, it, expect } from 'vitest';
import { createDiagnostics } from '../../src/diag/diag';
import { ensurePlayerDiag } from '../../src/player/diag-player';
import type { LevelStats } from '../../src/level-stats';

function mockLevel(): LevelStats {
  return {
    floorTiles: 10,
    wallTilesByType: { '1': 5 },
    doorTiles: 1,
    secretTiles: 1,
    exitTiles: 1,
    wallFaces: 20,
    bounds: { minX: 0, maxX: 63, minZ: 0, maxZ: 63 },
    valid: true,
    errors: [],
  };
}

describe('player diag contract', () => {
  it('adds the full player shape with the declared types', () => {
    const diag = createDiagnostics('webgl');
    const player = ensurePlayerDiag(diag);

    expect(diag.player).toBe(player);
    expect(typeof player.x).toBe('number');
    expect(typeof player.z).toBe('number');
    expect(typeof player.yaw).toBe('number');
    expect(typeof player.pitch).toBe('number');
    expect(typeof player.speed).toBe('number');
    expect(typeof player.sprinting).toBe('boolean');
    expect(typeof player.pointerLocked).toBe('boolean');
    expect(typeof player.stuck).toBe('boolean');
    expect(typeof player.bobOffset).toBe('number');
  });

  it('leaves every field owned by 001 and 002 present and unchanged', () => {
    const diag = createDiagnostics('webgpu');
    diag.ready = true;
    diag.fps = 60;
    diag.frameTimeMs = 16.67;
    diag.drawCalls = 5;
    diag.errors.push('boom');
    diag.fallbackReason = 'no gpu';
    const level = mockLevel();
    diag.level = level;

    ensurePlayerDiag(diag);

    expect(diag.ready).toBe(true);
    expect(diag.renderer).toBe('webgpu');
    expect(diag.fps).toBe(60);
    expect(diag.frameTimeMs).toBe(16.67);
    expect(diag.drawCalls).toBe(5);
    expect(diag.errors).toEqual(['boom']);
    expect(diag.fallbackReason).toBe('no gpu');
    expect(diag.level).toBe(level);
  });

  it('is idempotent: a second call returns the same object', () => {
    const diag = createDiagnostics('webgl');
    const first = ensurePlayerDiag(diag);
    const second = ensurePlayerDiag(diag);
    expect(second).toBe(first);
  });
});
