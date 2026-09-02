// Legs: getting from where the player is to where the next objective is (009 FR-003, FR-004).
//
// The route comes from the game's own `findPath`, not from a copy of it and not from a table
// of hand-derived waypoints. Node cannot import TypeScript, so `tools/play/nav-entry.ts` is
// compiled here with esbuild -- once per invocation, into a temporary file -- and the module
// that comes back is the same A* the guards path with. A second implementation under
// `tools/` would be free to disagree with the one the game ships, and the first symptom
// would be a playtest that walks into a wall the guards route around.
//
// Routing treats every door and secret as passable, exactly as `src/run/completable.ts` does
// when it proves the level finishable: a door the player must first open is still a route.
// Opening it is this file's job too -- a leg that stops advancing in front of a `D` or `S`
// tile issues the interact command and carries on, which is what a player does.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import {
  HarnessFault, frames, readPlayer, until, yawToward, interact,
  holdKey, releaseKey, wrapAngle,
} from './driver.mjs';

/** How near a waypoint's centre counts as arrival. The collider's radius is 0.3 and a tile
 *  is 1 wide, so this is "standing on the tile" without demanding the exact centre. */
export const ARRIVAL_RADIUS = 0.3;

/** Frames between position re-reads while a movement key is held. Small enough to correct a
 *  drifting heading, large enough that a leg is not one evaluate per frame. */
const STEP_FRAMES = 4;

/** Consecutive checks with no meaningful progress before a leg is declared stuck. */
const STALL_CHECKS = 6;

/** Progress below this over one check counts as none, in world units. */
const STALL_EPSILON = 0.01;

/** Frames a single waypoint may take before the leg fails. At walk speed 3 and 60fps this is
 *  roughly 40 world units -- far longer than any straight run the level offers. */
const WAYPOINT_FRAME_BUDGET = 2400;

/** Frames to wait for a door to finish travelling once it has been asked to open. */
const DOOR_TRAVEL_FRAMES = 90;

let navModule = null;

/**
 * Compiles `tools/play/nav-entry.ts` and returns the module. Compiled once per invocation and
 * reused. A compile failure names the entry and aborts: there is deliberately no fallback to
 * a second pathfinder, because having one is the thing this arrangement exists to prevent.
 */
export async function loadNav(root) {
  if (navModule != null) return navModule;
  const entry = resolve(root, 'tools/play/nav-entry.ts');
  let outfile;
  try {
    const dir = await mkdtemp(join(tmpdir(), 'wolf-nav-'));
    outfile = join(dir, 'nav.mjs');
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      outfile,
      logLevel: 'silent',
    });
  } catch (error) {
    throw new HarnessFault(
      `could not compile ${entry}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  navModule = await import(pathToFileURL(outfile).href);
  return navModule;
}

/** The tile a world position stands on. */
export const tileOf = (position) => ({ x: Math.floor(position.x), z: Math.floor(position.z) });

/** The world centre of a tile. */
export const centreOf = (cell) => ({ x: cell.x + 0.5, z: cell.z + 0.5 });

/** The grid cell at `(x, z)`, or a wall for anything off the grid. */
export const cellAt = (grid, x, z) => grid[z]?.[x] ?? '1';

/**
 * The corners of a path: every cell where the direction changes, plus the last one. Walking
 * a 20-cell corridor cell by cell is 20 stops for one straight line; walking its corners is
 * one held key, which is both faster and what a person looks like.
 */
export function corners(cells) {
  if (cells.length <= 1) return [...cells];
  const out = [];
  for (let i = 1; i < cells.length; i += 1) {
    const previous = cells[i - 1];
    const current = cells[i];
    const next = cells[i + 1];
    if (
      next == null
      || next.x - current.x !== current.x - previous.x
      || next.z - current.z !== current.z - previous.z
    ) {
      out.push(current);
    }
  }
  return out;
}

/** The route between two tiles over the shipped grid, with every door and secret treated as
 *  openable. Returns the path cells, or null when the pathfinder reports no route. */
export function routeBetween(nav, from, to) {
  const result = nav.findPath(nav.LEVEL_GRID, nav.openableTiles(), from, to);
  return nav.isUnreachable(result) ? null : result.cells;
}

/** Asks the tile ahead to open and waits for the travel. Returns what the game said. */
async function openAhead(page) {
  const before = await page.evaluate(() => window.__diag.interaction.doorsOpen);
  await interact(page);
  await until(page, (had) => window.__diag.interaction.doorsOpen > had
    || window.__diag.interaction.secretsFound > 0
    || window.__diag.interaction.lastReason === 'opened', { frameBudget: 90, arg: before });
  const reason = await page.evaluate(() => window.__diag.interaction.lastReason);
  await frames(page, DOOR_TRAVEL_FRAMES);
  return reason;
}

/**
 * Walks to one world point, holding the forward key and correcting the heading as it goes.
 *
 * Returns `{ arrived, position, reason }`. A walk that stops advancing in front of a door or
 * a secret asks it to open and carries on; one that stops advancing anywhere else has found
 * geometry, and says where.
 */
export async function walkTo(page, look, nav, point, { openWhenStuck = true } = {}) {
  await look.turnTo(yawToward(point.x - (await readPlayer(page)).x, point.z - (await readPlayer(page)).z));

  let stalls = 0;
  let previousDistance = Infinity;
  // Sprint. `src/player/keyboard.ts` reads Shift as the sprint flag, and a player crossing a
  // corridor holds it — 5.4 units per second against 3.0, which is also 44% less time under
  // fire on a route that passes three guard markers.
  await holdKey(page, 'ShiftLeft');
  await holdKey(page, 'KeyW');
  try {
    for (let spent = 0; spent < WAYPOINT_FRAME_BUDGET; spent += STEP_FRAMES) {
      await frames(page, STEP_FRAMES);
      const player = await readPlayer(page);
      // Death stops movement resolving at all, so it must be read as death and not as the
      // wall it otherwise looks like (see `readPlayer`).
      if (player.dead || player.runState === 'dead') {
        return {
          arrived: false,
          position: player,
          dead: true,
          reason: `the player was killed at (${player.x.toFixed(2)}, ${player.z.toFixed(2)})`,
        };
      }
      const dx = point.x - player.x;
      const dz = point.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= ARRIVAL_RADIUS) return { arrived: true, position: player };

      if (previousDistance - distance < STALL_EPSILON) stalls += 1;
      else stalls = 0;
      previousDistance = distance;

      if (stalls >= STALL_CHECKS) {
        const ahead = tileOf({ x: player.x - Math.sin(player.yaw) * 0.7, z: player.z - Math.cos(player.yaw) * 0.7 });
        const cell = cellAt(nav.LEVEL_GRID, ahead.x, ahead.z);
        if (openWhenStuck && (cell === 'D' || cell === 'S')) {
          await releaseKey(page, 'KeyW');
          const reason = await openAhead(page);
          await holdKey(page, 'KeyW');
          stalls = 0;
          previousDistance = Infinity;
          if (reason !== 'opened' && cell === 'D') {
            return { arrived: false, position: player, reason: `the door at (${ahead.x},${ahead.z}) refused: ${reason}` };
          }
          continue;
        }
        return {
          arrived: false,
          position: player,
          reason: `stopped advancing at (${player.x.toFixed(2)}, ${player.z.toFixed(2)}) short of (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`,
        };
      }

      // Correct a heading that has drifted -- a slide along a wall moves the player off the
      // line it was aimed down, and a leg that never re-aims arrives at the wrong tile.
      const wanted = yawToward(dx, dz);
      if (Math.abs(wrapAngle(wanted - player.yaw)) > 0.12) {
        await releaseKey(page, 'KeyW');
        await look.turnTo(wanted);
        await holdKey(page, 'KeyW');
      }
    }
    return { arrived: false, position: await readPlayer(page), reason: 'the waypoint budget expired' };
  } finally {
    await releaseKey(page, 'KeyW');
    await releaseKey(page, 'ShiftLeft');
  }
}

/**
 * Walks from wherever the player is to a target tile, routing with the game's own pathfinder
 * and walking the corners of what it returns. Returns `{ arrived, reason }`.
 */
export async function walkToTile(page, look, nav, target, { onWaypoint } = {}) {
  const start = tileOf(await readPlayer(page));
  const cells = routeBetween(nav, start, target);
  if (cells == null) {
    return {
      arrived: false,
      reason: `no route from (${start.x},${start.z}) to (${target.x},${target.z}): the pathfinder reports it unreachable`,
    };
  }
  for (const cell of corners(cells)) {
    const result = await walkTo(page, look, nav, centreOf(cell));
    if (!result.arrived) {
      return { arrived: false, reason: `leg to (${cell.x},${cell.z}): ${result.reason}` };
    }
    onWaypoint?.(cell);
  }
  return { arrived: true };
}
