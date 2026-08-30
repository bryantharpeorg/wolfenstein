import { describe, it, expect } from 'vitest';
import { resolveMove } from '../../src/player/collide';
import { integrate } from '../../src/player/integrate';
import { isCircleWalkable } from '../../src/player/tiles';
import { COLLIDER_RADIUS, SPRINT_SPEED, WALK_SPEED } from '../../src/player/params';
import { LEVEL_GRID } from '../../src/level';

const R = COLLIDER_RADIUS;
const OPEN: ReadonlySet<string> = new Set<string>();

// Deterministic LCG so the battery is reproducible across runs.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function isWalkableCell(cell: string): boolean {
  return cell === '0' || cell === 'E';
}

// All walkable tile coordinates of the shipped grid, for picking start tiles.
function walkableTiles(grid: string[]): Array<{ x: number; z: number }> {
  const tiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z]!;
    for (let x = 0; x < row.length; x += 1) {
      if (isWalkableCell(row[x]!)) tiles.push({ x, z });
    }
  }
  return tiles;
}

describe('collision battery (US2-S3, SC-002)', () => {
  it('resolves at least 500 generated cases to a walkable circle', () => {
    const grid = LEVEL_GRID;
    const tiles = walkableTiles(grid);
    const rand = lcg(0x5eed);
    const cases = 600;

    for (let i = 0; i < cases; i += 1) {
      const tile = tiles[Math.floor(rand() * tiles.length)]!;
      // Start somewhere inside the tile, not necessarily centred.
      const startX = tile.x + 0.2 + rand() * 0.6;
      const startZ = tile.z + 0.2 + rand() * 0.6;
      // Random direction and magnitude up to 50 units in a single call.
      const angle = rand() * Math.PI * 2;
      const magnitude = rand() * 50;
      const dx = Math.cos(angle) * magnitude;
      const dz = Math.sin(angle) * magnitude;

      const result = resolveMove(grid, { x: startX, z: startZ }, { x: dx, z: dz }, OPEN);
      expect(
        isCircleWalkable(grid, result.position.x, result.position.z, R, OPEN),
        `case ${i}: start (${startX}, ${startZ}) + (${dx}, ${dz}) -> (${result.position.x}, ${result.position.z})`,
      ).toBe(true);
    }
  });
});

describe('sprint spike (US2-S5)', () => {
  it('cannot cross a one-tile wall on a 1000ms sprint spike', () => {
    const grid = ['010'];
    const start = { x: 0.5, z: 0.5 };
    const result = integrate(grid, start, SPRINT_SPEED, 0, 1000, OPEN);
    // The wall at tile 1 stops the player flush at x = 1 - R = 0.7.
    expect(result.position.x).toBeCloseTo(0.7, 6);
    expect(result.blockedAxes.e).toBe(true);
    expect(isCircleWalkable(grid, result.position.x, result.position.z, R, OPEN)).toBe(true);
  });

  it('substeps a clamped spike into increments no larger than 0.25 units', () => {
    // A 1000ms spike at sprint speed clamps to 250ms -> 1.35 units, split into
    // ceil(1.35 / 0.25) = 6 substeps, each <= 0.25.
    const grid = ['00000000000000000000'];
    const start = { x: 0.5, z: 0.5 };
    const result = integrate(grid, start, SPRINT_SPEED, 0, 1000, OPEN);
    // In open space the full clamped displacement is applied: 5.4 * 0.25 = 1.35.
    expect(result.position.x).toBeCloseTo(0.5 + SPRINT_SPEED * 0.25, 6);
  });
});

describe('frame-rate independence (US2-S6, SC-003)', () => {
  function simulate(
    grid: string[],
    start: { x: number; z: number },
    velFn: (t: number) => [number, number],
    totalMs: number,
    frameMs: number,
  ): { x: number; z: number } {
    let pos = start;
    let t = 0;
    while (t < totalMs) {
      const dt = Math.min(frameMs, totalMs - t);
      const [vx, vz] = velFn(t);
      pos = integrate(grid, pos, vx, vz, dt, OPEN).position;
      t += dt;
    }
    return pos;
  }

  it('converges within 0.3 units at 16ms vs 250ms over identical elapsed time', () => {
    const grid = LEVEL_GRID;
    const start = { x: 10.5, z: 10.5 };
    // A scripted path: east, north, west, south, one second each, repeated.
    const velFn = (t: number): [number, number] => {
      const phase = Math.floor(t / 1000) % 4;
      if (phase === 0) return [WALK_SPEED, 0];
      if (phase === 1) return [0, -WALK_SPEED];
      if (phase === 2) return [-WALK_SPEED, 0];
      return [0, WALK_SPEED];
    };

    const pos16 = simulate(grid, start, velFn, 4000, 16);
    const pos250 = simulate(grid, start, velFn, 4000, 250);

    const dist = Math.hypot(pos16.x - pos250.x, pos16.z - pos250.z);
    expect(dist).toBeLessThanOrEqual(0.3);
    expect(isCircleWalkable(grid, pos16.x, pos16.z, R, OPEN)).toBe(true);
    expect(isCircleWalkable(grid, pos250.x, pos250.z, R, OPEN)).toBe(true);
  });

  it('produces no NaN on a zero-length delta', () => {
    const grid = LEVEL_GRID;
    const result = integrate(grid, { x: 10.5, z: 10.5 }, WALK_SPEED, 0, 0, OPEN);
    expect(Number.isFinite(result.position.x)).toBe(true);
    expect(Number.isFinite(result.position.z)).toBe(true);
    expect(result.position.x).toBeCloseTo(10.5, 9);
    expect(result.position.z).toBeCloseTo(10.5, 9);
  });
});
