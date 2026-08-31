// US4's planning half, asserted where no browser is needed (FR-012, FR-013,
// US4-S1, US4-S4): the declared light count, shadow-map size, depth bias and
// ambient level; every planned lamp on a walkable tile of 002's grid; and a
// fog far plane past the shipped level's longest sight-line, so the exit tile
// cannot be fogged out of existence.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { LEVEL_GRID, PLAYER_SPAWN, TILE_SIZE } from '../../src/level';
import {
  AMBIENT_INTENSITY, FOG_FAR, FOG_NEAR, LIGHT_DISTANCE, LIGHT_HEIGHT,
  MAX_FOG_FACTOR_AT_SIGHT_LINE, POINT_LIGHT_COUNT, SHADOW_BIAS,
  SHADOW_CASTING_LIGHTS, SHADOW_MAP_SIZE,
} from '../../src/lighting/constants';
import {
  fogFactor, findExitTile, longestSightLine, planDarkestTile, planLighting,
  planLights, planShadowProbe, segmentCrossesSolid, sightLineThrough,
} from '../../src/lighting/rig';

const DIR = fileURLToPath(new URL('../../src/lighting/', import.meta.url));
const isOpen = (cell: string | undefined): boolean => cell === '0' || cell === 'E';
const at = (x: number, z: number): string | undefined => LEVEL_GRID[z]?.[x];
/** The harness's own walkability rule, so the rig is not graded against its own. */
const walkable = (x: number, z: number): boolean => isOpen(at(x, z));
const lights = planLights(LEVEL_GRID);
const longest = longestSightLine(LEVEL_GRID);

describe('lighting constants (FR-012, FR-013, US4-S1)', () => {
  it('declares at least two point lights, at least two of them shadow-mapped', () => {
    expect(Number.isInteger(POINT_LIGHT_COUNT)).toBe(true);
    expect(POINT_LIGHT_COUNT).toBeGreaterThanOrEqual(2);
    expect(SHADOW_CASTING_LIGHTS).toBeGreaterThanOrEqual(2);
    expect(SHADOW_CASTING_LIGHTS).toBeLessThanOrEqual(POINT_LIGHT_COUNT);
  });

  it('declares a power-of-two shadow map and a bias that pulls toward the light', () => {
    expect(Number.isInteger(SHADOW_MAP_SIZE)).toBe(true);
    expect(SHADOW_MAP_SIZE & (SHADOW_MAP_SIZE - 1)).toBe(0);
    expect(SHADOW_MAP_SIZE).toBeGreaterThanOrEqual(128);
    expect(SHADOW_BIAS).toBeLessThanOrEqual(0);
  });

  it('declares an ambient term above zero and an ordered fog range', () => {
    expect(AMBIENT_INTENSITY).toBeGreaterThan(0);
    expect(FOG_NEAR).toBeGreaterThan(TILE_SIZE);
    expect(FOG_FAR).toBeGreaterThan(FOG_NEAR);
    expect(MAX_FOG_FACTOR_AT_SIGHT_LINE).toBeLessThan(1);
  });

  // A `three` import here would put placement back out of reach of the test
  // run, which is the whole point of the split.
  it('plans without importing three or reaching a browser global', () => {
    const files = readdirSync(DIR).filter((n) => n.endsWith('.ts'));
    expect(files).toEqual(expect.arrayContaining(['constants.ts', 'rig.ts']));
    for (const name of files) {
      const source = readFileSync(join(DIR, name), 'utf8');
      expect(source, `${name} imports three`).not.toMatch(/from\s+['"]three['"]/);
      expect(source, `${name} reaches a browser global`).not.toMatch(
        /\b(window|document|navigator|requestAnimationFrame)\b/,
      );
    }
  });
});

describe('light placement (FR-012, US4-S1)', () => {
  it('places exactly the declared number of lights, none stacked', () => {
    expect(lights).toHaveLength(POINT_LIGHT_COUNT);
    expect(new Set(lights.map((l) => `${l.tile.x},${l.tile.z}`)).size).toBe(lights.length);
  });

  it('places every light on a walkable tile of the grid, centred and at height', () => {
    for (const l of lights) {
      expect(walkable(l.tile.x, l.tile.z), `light on '${at(l.tile.x, l.tile.z)}'`).toBe(true);
      expect(l.x).toBeCloseTo(l.tile.x + TILE_SIZE / 2, 10);
      expect(l.z).toBeCloseTo(l.tile.z + TILE_SIZE / 2, 10);
      expect(l.y).toBeCloseTo(LIGHT_HEIGHT, 10);
    }
  });

  it('spreads the lights, so two of them are more than one room apart', () => {
    let widest = 0;
    for (const a of lights) for (const b of lights) widest = Math.max(widest, Math.hypot(a.x - b.x, a.z - b.z));
    expect(widest).toBeGreaterThan(20 * TILE_SIZE);
  });

  it('shadow-maps the declared number of lamps, nearest the spawn and exit', () => {
    const casters = lights.filter((l) => l.castsShadow);
    expect(casters).toHaveLength(SHADOW_CASTING_LIGHTS);
    expect(casters.length).toBeGreaterThanOrEqual(2);
    // The planner's own rule, recomputed: no non-caster is nearer an anchor
    // than the furthest caster is.
    const exit = findExitTile(LEVEL_GRID)!;
    const score = (l: (typeof lights)[number]): number => Math.min(
      Math.hypot(l.x - (PLAYER_SPAWN.x + 0.5), l.z - (PLAYER_SPAWN.z + 0.5)),
      Math.hypot(l.x - (exit.x + 0.5), l.z - (exit.z + 0.5)),
    );
    const worst = Math.max(...casters.map(score));
    for (const l of lights.filter((e) => !e.castsShadow)) {
      expect(score(l)).toBeGreaterThanOrEqual(worst - 1e-9);
    }
  });

  it('plans the same placements twice, so a frame never re-rolls the rig', () => {
    expect(planLights(LEVEL_GRID)).toEqual(lights);
  });
});

describe('sight-lines and fog (FR-013, US4-S4)', () => {
  it('measures the longest open run in the shipped level', () => {
    expect(longest.tiles).toBeGreaterThan(1);
    // Recomputed from the grid: every tile of the run is open, and the tile
    // just past each end is not.
    for (let s = 0; s < longest.tiles; s += 1) {
      const row = longest.axis === 'row';
      expect(isOpen(at(longest.from.x + (row ? s : 0), longest.from.z + (row ? 0 : s)))).toBe(true);
    }
    const row = longest.axis === 'row';
    expect(isOpen(at(longest.from.x - (row ? 1 : 0), longest.from.z - (row ? 0 : 1)))).toBe(false);
    expect(isOpen(at(longest.to.x + (row ? 1 : 0), longest.to.z + (row ? 0 : 1)))).toBe(false);
    expect(longest.length).toBeCloseTo((longest.tiles - 1) * TILE_SIZE, 10);
  });

  it('pushes the fog far plane past that sight-line', () => {
    expect(FOG_FAR).toBeGreaterThan(longest.length);
    expect(fogFactor(longest.length)).toBeLessThan(1);
    expect(fogFactor(longest.length)).toBeLessThanOrEqual(MAX_FOG_FACTOR_AT_SIGHT_LINE);
  });

  it('leaves the exit discernible from the far end of its own sight-line', () => {
    const exit = findExitTile(LEVEL_GRID);
    expect(exit).not.toBeNull();
    const line = sightLineThrough(LEVEL_GRID, exit!)!;
    expect(line).not.toBeNull();
    // The exit really lies on the run the rig measured.
    const on = line.axis === 'row'
      ? line.from.z === exit!.z && exit!.x >= line.from.x && exit!.x <= line.to.x
      : line.from.x === exit!.x && exit!.z >= line.from.z && exit!.z <= line.to.z;
    expect(on).toBe(true);
    expect(fogFactor(line.length)).toBeLessThan(MAX_FOG_FACTOR_AT_SIGHT_LINE);
    // And the stricter reading: still short of the fog's far plane from the far
    // end of the *longest* sight-line in the level.
    expect(fogFactor(longest.length)).toBeLessThan(1);
  });

  it('clamps the fog factor to the declared range', () => {
    expect(fogFactor(0)).toBe(0);
    expect(fogFactor(FOG_NEAR)).toBe(0);
    expect(fogFactor(FOG_FAR)).toBe(1);
    expect(fogFactor(FOG_FAR * 2)).toBe(1);
    expect(fogFactor((FOG_NEAR + FOG_FAR) / 2)).toBeCloseTo(0.5, 10);
  });
});

describe('the probe targets the harness renders (US4-S2, US4-S3)', () => {
  it('names a floor tile a wall really occludes from a shadow-casting lamp', () => {
    const probe = planShadowProbe(LEVEL_GRID, lights)!;
    expect(probe).not.toBeNull();
    expect(walkable(probe.tile.x, probe.tile.z)).toBe(true);
    // A lamp with no shadow map lights straight through the wall, so the probe
    // would be comparing two identical samples.
    expect(lights[probe.lightIndex]!.castsShadow).toBe(true);
    // Recomputed independently, by marching the segment far more finely.
    const from = lights[probe.lightIndex]!;
    const to = { x: probe.tile.x + TILE_SIZE / 2, z: probe.tile.z + TILE_SIZE / 2 };
    let solid = false;
    for (let i = 1; i < 4000; i += 1) {
      const t = i / 4000;
      const cell = at(Math.floor(from.x + (to.x - from.x) * t), Math.floor(from.z + (to.z - from.z) * t));
      if (!isOpen(cell)) solid = true;
    }
    expect(solid, 'nothing stands between the lamp and the probe tile').toBe(true);
    // Within reach, or removing the wall would not brighten it either.
    expect(probe.distance).toBeGreaterThan(0);
    expect(probe.distance).toBeLessThan(LIGHT_DISTANCE);
  });

  it('agrees with its own occlusion test', () => {
    expect(segmentCrossesSolid(LEVEL_GRID, { x: 10.5, z: 10.5 }, { x: 12.5, z: 10.5 })).toBe(false);
    // Column 21 is a solid wall between the two western rooms.
    expect(segmentCrossesSolid(LEVEL_GRID, { x: 18.5, z: 5.5 }, { x: 24.5, z: 5.5 })).toBe(true);
  });

  it('names the worst-lit walkable tile, for the not-pure-black sample', () => {
    const dark = planDarkestTile(LEVEL_GRID, lights);
    expect(walkable(dark.tile.x, dark.tile.z)).toBe(true);
    // Recomputed: no lamp has a clear line to it, so what the harness samples
    // there is the ambient term and nothing else (US4-S3).
    expect(dark.visibleDistance).toBeNull();
    for (const l of lights) {
      const c = { x: dark.tile.x + 0.5, z: dark.tile.z + 0.5 };
      const reaches = Math.hypot(l.x - c.x, l.z - c.z) < LIGHT_DISTANCE
        && !segmentCrossesSolid(LEVEL_GRID, { x: l.x, z: l.z }, c);
      expect(reaches, 'a lamp reaches the tile the harness calls unlit').toBe(false);
    }
  });
});

describe('the assembled plan (FR-012, FR-013, US4-S1, US4-S4)', () => {
  const plan = planLighting(LEVEL_GRID);

  it('carries the declared lamps and the sight-line it sized the fog against', () => {
    expect(plan.lights).toEqual(lights);
    expect(plan.longestSightLine.length).toBeCloseTo(longest.length, 10);
    expect(FOG_FAR).toBeGreaterThan(plan.longestSightLine.length);
    expect(plan.fogFactorAtSightLine).toBeCloseTo(fogFactor(longest.length), 10);
  });

  it('carries the exit, its fog, and both probe targets', () => {
    expect(plan.exit).not.toBeNull();
    expect(plan.fogFactorAtExit).toBeLessThan(MAX_FOG_FACTOR_AT_SIGHT_LINE);
    expect(plan.shadowProbe).not.toBeNull();
    expect(plan.darkTile.tile).toBeDefined();
  });
});
