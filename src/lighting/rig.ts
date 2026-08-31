// US4's planner (FR-012, FR-013, US4-S1, US4-S4): 002's grid and its anchors
// in; lamp placements, the level's longest sight-line and the harness's two
// probe targets out. No three.js and no browser API, so where a light sits and
// whether the exit survives the fog are decided under `npm run test` rather
// than eyeballed. `src/systems/lighting/register.ts` is the only reader that
// turns any of it into a light; the smoke check reads the same numbers back.
import { LEVEL_GRID, PLAYER_SPAWN, TILE_SIZE } from '../level';
import * as C from './constants';

export interface Tile { readonly x: number; readonly z: number }

/** An unbroken run of open tiles along one row or column. `length` is the
 * centre-to-centre distance between its ends — what a player looks across. */
export interface SightLine {
  readonly axis: 'row' | 'column';
  readonly from: Tile;
  readonly to: Tile;
  readonly tiles: number;
  readonly length: number;
}

/** Open to a lamp and to a player. A door, a secret and every wall type are
 * solid — 002 builds all three as geometry. */
export const isOpenCell = (cell: string | undefined): boolean => cell === '0' || cell === 'E';

const at = (grid: readonly string[], x: number, z: number): string | undefined => grid[z]?.[x];

/** The centre of a tile in world space, where 002 puts its geometry. */
export const tileCenter = (tile: Tile): Tile =>
  ({ x: tile.x + TILE_SIZE / 2, z: tile.z + TILE_SIZE / 2 });

export function findExitTile(grid: readonly string[] = LEVEL_GRID): Tile | null {
  for (let z = 0; z < grid.length; z += 1) {
    const x = grid[z]!.indexOf('E');
    if (x >= 0) return { x, z };
  }
  return null;
}

/** Every maximal open run, rows then columns, in a declared order so two runs
 * of equal length are never picked between by accident. */
function* sightLines(grid: readonly string[]): Generator<SightLine> {
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  const run = (axis: 'row' | 'column', i: number, s: number, e: number): SightLine => ({
    axis,
    from: axis === 'row' ? { x: s, z: i } : { x: i, z: s },
    to: axis === 'row' ? { x: e, z: i } : { x: i, z: e },
    tiles: e - s + 1,
    length: (e - s) * TILE_SIZE,
  });
  for (let z = 0; z < grid.length; z += 1) {
    let s = -1;
    for (let x = 0; x <= width; x += 1) {
      if (isOpenCell(at(grid, x, z))) { if (s < 0) s = x; }
      else if (s >= 0) { yield run('row', z, s, x - 1); s = -1; }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let s = -1;
    for (let z = 0; z <= grid.length; z += 1) {
      if (isOpenCell(at(grid, x, z))) { if (s < 0) s = z; }
      else if (s >= 0) { yield run('column', x, s, z - 1); s = -1; }
    }
  }
}

/** The longest open run in the level — the distance the fog must reach past,
 * or a player looking down it sees grey where the far wall is (US4-S4). */
export function longestSightLine(grid: readonly string[] = LEVEL_GRID): SightLine {
  let best: SightLine | null = null;
  for (const line of sightLines(grid)) if (best == null || line.tiles > best.tiles) best = line;
  if (best == null) throw new Error('the grid has no open tile to sight along');
  return best;
}

/** The longest run containing one tile — the sight-line US4-S4 measures the
 * exit's own visibility along — or null if that tile is not open. */
export function sightLineThrough(grid: readonly string[], tile: Tile): SightLine | null {
  let best: SightLine | null = null;
  for (const line of sightLines(grid)) {
    const on = line.axis === 'row'
      ? line.from.z === tile.z && tile.x >= line.from.x && tile.x <= line.to.x
      : line.from.x === tile.x && tile.z >= line.from.z && tile.z <= line.to.z;
    if (on && (best == null || line.tiles > best.tiles)) best = line;
  }
  return best;
}

/** three.js's linear fog, restated so US4-S4 is decidable without a renderer:
 * 0 at `near` and nearer, 1 at `far` and beyond, linear between. */
export function fogFactor(distance: number, near = C.FOG_NEAR, far = C.FOG_FAR): number {
  if (distance <= near) return 0;
  if (distance >= far) return 1;
  return (distance - near) / (far - near);
}

/** Whether anything solid stands between two floor points. A grid march rather
 * than a fixed sample count, so a wall one tile thick is never stepped over
 * however long the segment is. */
export function segmentCrossesSolid(grid: readonly string[], from: Tile, to: Tile): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dz);
  if (span === 0) return false;
  const steps = Math.ceil((span / TILE_SIZE) * 2);
  const a = { x: Math.floor(from.x), z: Math.floor(from.z) };
  const b = { x: Math.floor(to.x), z: Math.floor(to.z) };
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const x = Math.floor(from.x + dx * t);
    const z = Math.floor(from.z + dz * t);
    // The endpoints are the lamp and the sample, not occluders.
    if ((x === a.x && z === a.z) || (x === b.x && z === b.z)) continue;
    if (!isOpenCell(at(grid, x, z))) return true;
  }
  return false;
}

function* openTiles(grid: readonly string[]): Generator<Tile> {
  for (let z = 0; z < grid.length; z += 1) {
    for (let x = 0; x < grid[z]!.length; x += 1) if (isOpenCell(at(grid, x, z))) yield { x, z };
  }
}

/** The open tile nearest a point, ties broken by tile order so two runs of the
 * planner never disagree. */
function nearestOpenTile(grid: readonly string[], to: Tile, taken: Set<string>): Tile | null {
  let best: Tile | null = null;
  let far = Infinity;
  for (const tile of openTiles(grid)) {
    if (taken.has(`${tile.x},${tile.z}`)) continue;
    const c = tileCenter(tile);
    const d = Math.hypot(c.x - to.x, c.z - to.z);
    if (d < far - 1e-9) { best = tile; far = d; }
  }
  return best;
}

export interface LightPlacement extends Tile {
  readonly tile: Tile;
  readonly y: number;
  readonly castsShadow: boolean;
}

/** Which lamps carry a shadow map: ranked by closeness to 002's own anchors —
 * the tile the player starts on and the tile they are trying to reach — so the
 * shadows the rig can afford are the ones the player is standing in, not the
 * ones the lattice happened to plan first. Planning order breaks ties, making
 * the order total and the choice reproducible. */
function assignShadowCasters(
  grid: readonly string[],
  placed: readonly LightPlacement[],
): LightPlacement[] {
  const anchors = [tileCenter({ x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z })];
  const exit = findExitTile(grid);
  if (exit != null) anchors.push(tileCenter(exit));
  const casters = new Set(
    placed
      .map((p, index) => ({
        index,
        score: Math.min(...anchors.map((a) => Math.hypot(a.x - p.x, a.z - p.z))),
      }))
      .sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score))
      .slice(0, Math.min(C.SHADOW_CASTING_LIGHTS, placed.length))
      .map((e) => e.index),
  );
  return placed.map((p, index) => ({ ...p, castsShadow: casters.has(index) }));
}

/** Where the lamps hang (FR-012, US4-S1). A lattice is laid over the walkable
 * bounds and each cell's lamp takes the open tile nearest that cell's centre —
 * so every light stands where a player could, the set is spread across the
 * level rather than piled in one room, and one grid always plans one rig. */
export function planLights(
  grid: readonly string[] = LEVEL_GRID,
  count: number = C.POINT_LIGHT_COUNT,
): LightPlacement[] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { x, z } of openTiles(grid)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cols = Math.max(1, Math.min(C.LIGHT_LATTICE_COLS, count));
  const rows = Math.ceil(count / cols);
  const cellW = (maxX - minX + 1) / cols;
  const cellH = (maxZ - minZ + 1) / rows;
  const taken = new Set<string>();
  const placed: LightPlacement[] = [];
  for (let row = 0; row < rows && placed.length < count; row += 1) {
    for (let col = 0; col < cols && placed.length < count; col += 1) {
      const tile = nearestOpenTile(
        grid,
        { x: minX + cellW * (col + 0.5), z: minZ + cellH * (row + 0.5) },
        taken,
      );
      if (tile == null) continue;
      taken.add(`${tile.x},${tile.z}`);
      const c = tileCenter(tile);
      placed.push({ tile, x: c.x, y: C.LIGHT_HEIGHT, z: c.z, castsShadow: false });
    }
  }
  return assignShadowCasters(grid, placed);
}

/** The floor tile US4-S2 renders: the open tile *closest* to a shadow-casting
 * lamp that something solid nonetheless stands in front of. Closest, because
 * the gap between shadowed and unshadowed is widest where the lamp would
 * otherwise be brightest, so "measurably darker" holds with room to spare
 * rather than by a rounding error. Only a caster counts: a lamp with no shadow
 * map lights straight through the wall, and the probe would measure nothing. */
export function planShadowProbe(grid: readonly string[], lights: readonly LightPlacement[]) {
  let best: { lightIndex: number; tile: Tile; distance: number } | null = null;
  for (const tile of openTiles(grid)) {
    const c = tileCenter(tile);
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index]!;
      if (!light.castsShadow) continue;
      const distance = Math.hypot(light.x - c.x, light.z - c.z);
      if (distance <= 0 || distance >= C.LIGHT_DISTANCE) continue;
      if (best != null && distance >= best.distance - 1e-9) continue;
      if (!segmentCrossesSolid(grid, { x: light.x, z: light.z }, c)) continue;
      best = { lightIndex: index, tile, distance };
    }
  }
  return best;
}

/** The tile US4-S3 samples: the worst-lit walkable tile there is. A tile no
 * lamp has a clear line to beats every tile some lamp reaches, however far off
 * — occlusion, not distance, is what makes a corner dark in a maze — and among
 * equally unreached tiles the one furthest from any lamp wins. If the ambient
 * term keeps *this* tile readable it keeps every tile readable, so the harness
 * samples the worst case rather than a corner picked by hand. */
export function planDarkestTile(grid: readonly string[], lights: readonly LightPlacement[]) {
  /** Distance to the nearest lamp with a clear line, or null when none reaches
   * the tile at all — which is what "unlit" means here. */
  let best: { tile: Tile; distance: number; visibleDistance: number | null } | null = null;
  for (const tile of openTiles(grid)) {
    const c = tileCenter(tile);
    let distance = Infinity;
    let visibleDistance: number | null = null;
    for (const light of lights) {
      const d = Math.hypot(light.x - c.x, light.z - c.z);
      if (d < distance) distance = d;
      if (d >= C.LIGHT_DISTANCE) continue;
      if (segmentCrossesSolid(grid, { x: light.x, z: light.z }, c)) continue;
      if (visibleDistance == null || d < visibleDistance) visibleDistance = d;
    }
    const unlit = visibleDistance == null;
    const better = best == null
      || (unlit !== (best.visibleDistance == null) ? unlit
        : unlit ? distance > best.distance + 1e-9
          : visibleDistance! > best.visibleDistance! + 1e-9);
    if (better) best = { tile, distance, visibleDistance };
  }
  if (best == null) throw new Error('the grid has no open tile to sample');
  return best;
}

/** The whole rig for one grid: what the lighting system builds and what the
 * smoke check reads back, so the page and the harness cannot drift. Colours,
 * intensities and the bias stay in `constants.ts` and are read from there by
 * the one file that renders them; what is computed lives here. */
export function planLighting(grid: readonly string[] = LEVEL_GRID) {
  const lights = planLights(grid);
  const longest = longestSightLine(grid);
  const exit = findExitTile(grid);
  const exitSightLine = exit == null ? null : sightLineThrough(grid, exit);
  return {
    lights,
    longestSightLine: longest,
    /** The fog at the far end of that run, so US4-S4 is one number. */
    fogFactorAtSightLine: fogFactor(longest.length),
    exit,
    exitSightLine,
    fogFactorAtExit: exitSightLine == null ? null : fogFactor(exitSightLine.length),
    shadowProbe: planShadowProbe(grid, lights),
    darkTile: planDarkestTile(grid, lights),
  };
}

export type LightingPlan = ReturnType<typeof planLighting>;
