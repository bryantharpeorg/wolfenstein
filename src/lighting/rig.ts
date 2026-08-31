// US4's planner (FR-012, FR-013): 002's grid in; lamp placements, the longest
// sight-line and the harness's two probe tiles out, with no three.js and no
// browser API. Occlusion is 003's `hasLineOfSight` with the doors shut.
import { hasLineOfSight } from '../enemy/los';
import { LEVEL_GRID, PLAYER_SPAWN, TILE_SIZE } from '../level';
import type { OpenState } from '../player/tiles';
import * as C from './constants';

export interface Tile { readonly x: number; readonly z: number }
export interface LightPlacement extends Tile {
  readonly tile: Tile; readonly y: number; readonly castsShadow: boolean;
}

const SHUT: OpenState = new Set<string>();
export const isOpenCell = (c: string | undefined): boolean => c === '0' || c === 'E';
export const tileCenter = (t: Tile): Tile => ({ x: t.x + TILE_SIZE / 2, z: t.z + TILE_SIZE / 2 });
const dist = (a: Tile, b: Tile): number => Math.hypot(a.x - b.x, a.z - b.z);
const openTiles = (g: string[]): Tile[] =>
  g.flatMap((row, z) => [...row].flatMap((c, x) => (isOpenCell(c) ? [{ x, z }] : [])));

export function longestSightLine(grid: string[] = LEVEL_GRID): number {
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  const columns = Array.from({ length: width }, (_, x) => grid.map((row) => row[x] ?? '#').join(''));
  return [...grid, ...columns].reduce((longest, line) => [...line.matchAll(/[0E]+/g)]
    .reduce((best, run) => Math.max(best, (run[0].length - 1) * TILE_SIZE), longest), 0);
}

/** Lamps hang over open tiles at even intervals; the ones nearest 002's spawn
 * carry the maps (FR-012, US4-S1). */
export function planLights(grid: string[] = LEVEL_GRID, count = C.POINT_LIGHT_COUNT): LightPlacement[] {
  const open = openTiles(grid);
  const placed = Array.from({ length: Math.min(count, open.length) }, (_, i) => {
    const tile = open[Math.floor(((i + 0.5) / count) * open.length)]!;
    return { tile, ...tileCenter(tile), y: C.LIGHT_HEIGHT, castsShadow: false };
  });
  const spawn = tileCenter(PLAYER_SPAWN);
  const byRange = placed.map((_, i) => i).sort((a, b) => dist(spawn, placed[a]!) - dist(spawn, placed[b]!));
  const casters = new Set(byRange.slice(0, C.SHADOW_CASTING_LIGHTS));
  return placed.map((p, i) => ({ ...p, castsShadow: casters.has(i) }));
}

/** US4-S2's floor tile, and US4-S3's unreached one. */
interface Probes {
  shadow: { lightIndex: number; tile: Tile } | null;
  dark: { tile: Tile; lit: boolean };
}

export function planProbes(grid: string[], lights: readonly LightPlacement[]): Probes {
  let shadow: (Probes['shadow'] & { distance: number }) | null = null;
  let dark: (Probes['dark'] & { rank: number }) | null = null;
  for (const tile of openTiles(grid)) {
    const c = tileCenter(tile);
    let near = Infinity, lit = false;
    lights.forEach((l, lightIndex) => {
      const distance = dist(l, c);
      near = Math.min(near, distance);
      if (distance >= C.LIGHT_DISTANCE) return;
      if (hasLineOfSight(grid, SHUT, l, c)) { lit = true; return; }
      if (l.castsShadow && (shadow == null || distance < shadow.distance)) shadow = { lightIndex, tile, distance };
    });
    const rank = (lit ? 0 : 1e6) + near;
    if (dark == null || rank > dark.rank) dark = { tile, lit, rank };
  }
  if (dark == null) throw new Error('the grid has no open tile to sample');
  return { shadow, dark };
}

export function planLighting(grid: string[] = LEVEL_GRID) {
  const lights = planLights(grid);
  return { lights, longestSightLine: longestSightLine(grid), ...planProbes(grid, lights) };
}

export type LightingPlan = ReturnType<typeof planLighting>;
