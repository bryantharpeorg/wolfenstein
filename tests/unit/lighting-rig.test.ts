// US4's planning half, where no browser is needed (FR-012, FR-013, US4-S1,
// US4-S4): the declared count, map size, bias and ambient level; every lamp on
// a walkable tile; and a fog far plane past the level's longest sight-line.
import { it, expect } from 'vitest';
import { LEVEL_GRID, PLAYER_SPAWN, TILE_SIZE } from '../../src/level';
import {
  AMBIENT_INTENSITY, FOG_FAR, FOG_NEAR, POINT_LIGHT_COUNT, SHADOW_BIAS, SHADOW_CASTING_LIGHTS,
  SHADOW_MAP_SIZE,
} from '../../src/lighting/constants';
import { isOpenCell, planLighting, tileCenter } from '../../src/lighting/rig';

const walkable = (t: { x: number; z: number }): boolean => isOpenCell(LEVEL_GRID[t.z]?.[t.x]);
const plan = planLighting(LEVEL_GRID);

it('declares two or more lights, two or more mapped, a power-of-two map and readable ambient (US4-S1)', () => {
  expect(POINT_LIGHT_COUNT).toBeGreaterThanOrEqual(2);
  expect(SHADOW_CASTING_LIGHTS).toBeGreaterThanOrEqual(2);
  expect(SHADOW_CASTING_LIGHTS).toBeLessThanOrEqual(POINT_LIGHT_COUNT);
  expect(SHADOW_MAP_SIZE & (SHADOW_MAP_SIZE - 1)).toBe(0);
  expect(SHADOW_MAP_SIZE).toBeGreaterThanOrEqual(128);
  expect(SHADOW_BIAS).toBeLessThanOrEqual(0);
  expect(AMBIENT_INTENSITY).toBeGreaterThan(0);
  expect(FOG_NEAR).toBeGreaterThan(TILE_SIZE);
  expect(FOG_FAR).toBeGreaterThan(FOG_NEAR);
});

it('hangs every declared lamp over a walkable tile, and maps the ones nearest the spawn (FR-012, US4-S1)', () => {
  const lights = plan.lights;
  expect(lights).toHaveLength(POINT_LIGHT_COUNT);
  for (const l of lights) {
    expect(walkable(l.tile), `lamp on '${LEVEL_GRID[l.tile.z]?.[l.tile.x]}'`).toBe(true);
  }
  const casters = lights.filter((l) => l.castsShadow);
  expect(casters).toHaveLength(SHADOW_CASTING_LIGHTS);
  const spawn = tileCenter(PLAYER_SPAWN);
  const range = (l: (typeof lights)[number]): number => Math.hypot(spawn.x - l.x, spawn.z - l.z);
  const worst = Math.max(...casters.map(range));
  for (const l of lights.filter((e) => !e.castsShadow)) expect(range(l)).toBeGreaterThanOrEqual(worst);
});

it('pushes the fog far plane past the longest open run, leaving the exit discernible (FR-013, US4-S4)', () => {
  let rows = 0;
  for (const row of LEVEL_GRID) {
    for (const run of row.matchAll(/[0E]+/g)) rows = Math.max(rows, (run[0].length - 1) * TILE_SIZE);
  }
  expect(plan.longestSightLine).toBeGreaterThanOrEqual(rows);
  expect(plan.longestSightLine).toBeGreaterThan(TILE_SIZE);
  expect(FOG_FAR).toBeGreaterThan(plan.longestSightLine);
  const exitRow = LEVEL_GRID.findIndex((row) => row.includes('E'));
  expect(walkable({ x: LEVEL_GRID[exitRow]!.indexOf('E'), z: exitRow })).toBe(true);
});

it('names the two tiles the harness probes: one a wall occludes from a mapped lamp, one no lamp reaches', () => {
  const { shadow, dark } = plan;
  expect(shadow).not.toBeNull();
  expect(walkable(shadow!.tile)).toBe(true);
  expect(plan.lights[shadow!.lightIndex]!.castsShadow).toBe(true);
  expect(walkable(dark.tile)).toBe(true);
  expect(dark.lit).toBe(false);
});
