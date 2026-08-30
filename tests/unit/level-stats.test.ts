import { describe, it, expect } from 'vitest';
import { computeLevelStats, corruptGrid } from '../../src/level-stats';
import { LEVEL_GRID } from '../../src/level';
import { validateLevel } from '../../src/level-validate';
import { emitFaces } from '../../src/geometry/faces';

// Hand-computed values for the shipped 64x64 grid, derived independently of
// `src/level-stats.ts` so a stats bug cannot agree with itself (US3-S4).
const HAND_COUNTS = {
  floorTiles: 3604,
  wallTilesByType: { '1': 252, '2': 57, '3': 57, '4': 59, '5': 59 },
  doorTiles: 5,
  secretTiles: 2,
  exitTiles: 1,
  // 240 border + 118 brick + 116 metal + 116 wood + 116 panel + 10 door + 4 secret.
  wallFaces: 720,
};

describe('computeLevelStats', () => {
  const report = validateLevel(LEVEL_GRID);
  const faces = emitFaces(LEVEL_GRID);
  const stats = computeLevelStats(LEVEL_GRID, report, faces);

  it('reports floorTiles equal to the hand-computed count', () => {
    expect(stats.floorTiles).toBe(HAND_COUNTS.floorTiles);
  });

  it('reports wallTilesByType equal to the hand-computed counts', () => {
    expect(stats.wallTilesByType).toEqual(HAND_COUNTS.wallTilesByType);
  });

  it('reports doorTiles, secretTiles and exitTiles', () => {
    expect(stats.doorTiles).toBe(HAND_COUNTS.doorTiles);
    expect(stats.secretTiles).toBe(HAND_COUNTS.secretTiles);
    expect(stats.exitTiles).toBe(HAND_COUNTS.exitTiles);
  });

  it('reports wallFaces equal to the hand-computed count', () => {
    expect(stats.wallFaces).toBe(HAND_COUNTS.wallFaces);
  });

  it('reports bounds spanning at least 40x40 walkable tiles', () => {
    expect(stats.bounds).toEqual({ minX: 1, maxX: 62, minZ: 1, maxZ: 62 });
    expect(stats.bounds.maxX - stats.bounds.minX + 1).toBeGreaterThanOrEqual(40);
    expect(stats.bounds.maxZ - stats.bounds.minZ + 1).toBeGreaterThanOrEqual(40);
  });

  it('reports valid true and empty errors for the shipped grid', () => {
    expect(stats.valid).toBe(true);
    expect(stats.errors).toEqual([]);
  });
});

describe('corruptGrid', () => {
  it('returns a copy, leaving the original grid untouched', () => {
    const corrupted = corruptGrid(LEVEL_GRID);
    expect(corrupted).not.toBe(LEVEL_GRID);
    expect(LEVEL_GRID[0]).toBe('1111111111111111111111111111111111111111111111111111111111111111');
  });

  it('produces a grid that validates false with at least one named error', () => {
    const corrupted = corruptGrid(LEVEL_GRID);
    const report = validateLevel(corrupted);
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.category).toBe('dimensions');
  });
});
