// Answering a guard (009 FR-007, US1-S9..S11).
//
// Self-defence is part of crossing the level, not part of clearing it: the level ships eight
// guards, the routed path passes three of their markers, and the agent starts holding a
// loaded pistol. An agent that walks through a firefight without returning fire is testing
// less of the game than it is running -- it never fires a weapon, never resolves a hitscan,
// never moves the kill counter and never sees the HUD change. US2 decides which guards to go
// *looking* for; this file is what happens when one shoots first.
//
// Aiming needs a bearing, and until 009 the diagnostics roster published none: `viewAngle` is
// the sprite column, which is the guard's facing relative to the camera and not the direction
// to it. `src/enemy/world.ts` now publishes each guard's `x` and `z` additively over 006's
// FR-011 shape -- a read-only fact the harness could not otherwise report, which is the
// extension Constitution III asks for. It is perception, not input: every shot below is still
// a real `mousedown` on the binding the game already listens to.

import { fire, frames, readPlayer, tapKey, wrapAngle, yawToward } from './driver.mjs';

/** How far away a guard is still worth answering, in tiles. Past the pistol's 34-cell range
 *  there is nothing to gain, and a guard that has not closed is one the agent can outrun. */
export const ENGAGE_RANGE_TILES = 14;

/** Frames the trigger is held per burst. */
export const BURST_FRAMES = 8;

/** Bursts one guard may take before the agent gives up and keeps walking. Six pistol rounds
 *  kill a guard, and a burst is worth roughly one or two, so this is generous. */
export const MAX_BURSTS = 14;

/** The states that mean a guard is dealing with the player rather than idling. */
const ENGAGED_STATES = new Set(['alert', 'chase', 'attack']);

/** Weapons by preference, with the digit code that selects each one. */
const WEAPONS = [
  { kind: 'chaingun', code: 'Digit3' },
  { kind: 'smg', code: 'Digit2' },
  { kind: 'pistol', code: 'Digit1' },
];

/** Everything a decision here needs, read in one turn so no frame lands mid-read. */
export function readCombat(page) {
  return page.evaluate(() => ({
    enemies: window.__diag.enemies.map((e) => ({ state: e.state, x: e.x, z: e.z })),
    kills: window.__diag.combat.kills,
    weapon: window.__diag.combat.weapon,
    ammo: { ...window.__diag.combat.ammo },
    health: window.__diag.combat.health,
    dead: window.__diag.combat.dead,
    runState: window.__diag.run.state,
  }));
}

/**
 * Is the straight line from `from` to `to` clear of level geometry?
 *
 * Sampled rather than swept: a shot is a ray from the camera and this only has to be right
 * enough not to spend ammunition on a wall. Digits are walls; a `D` is a door, which blocks
 * until it is opened and is therefore treated as blocking, since a guard on the far side of
 * a closed door is not a threat worth turning for.
 */
export function hasLineOfSight(grid, from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const steps = Math.ceil(Math.hypot(dx, dz) * 4);
  for (let step = 1; step < steps; step += 1) {
    const x = Math.floor(from.x + (dx * step) / steps);
    const z = Math.floor(from.z + (dz * step) / steps);
    const cell = grid[z]?.[x] ?? '1';
    if ((cell >= '1' && cell <= '9') || cell === 'D') return false;
  }
  return true;
}

/**
 * The guards worth answering right now: engaged, alive, within range, and in view. Nearest
 * first, because the one closest is the one hurting the player fastest.
 */
export function threats(enemies, player, grid, { range = ENGAGE_RANGE_TILES } = {}) {
  return enemies
    .map((enemy, index) => ({ ...enemy, index, distance: Math.hypot(enemy.x - player.x, enemy.z - player.z) }))
    .filter((enemy) => ENGAGED_STATES.has(enemy.state)
      && enemy.distance <= range
      && hasLineOfSight(grid, player, enemy))
    .sort((a, b) => a.distance - b.distance);
}

/** Selects a weapon that has ammunition, through the digit binding a player would press.
 *  Returns the weapon now held, or null when every weapon is empty. */
export async function selectArmedWeapon(page, state) {
  if ((state.ammo[state.weapon] ?? 0) > 0) return state.weapon;
  for (const weapon of WEAPONS) {
    if ((state.ammo[weapon.kind] ?? 0) > 0) {
      await tapKey(page, weapon.code);
      await frames(page, 2);
      return weapon.kind;
    }
  }
  return null;
}

/**
 * Turns to one guard and fires until it dies, the agent runs dry, or the budget expires.
 * Re-aims between bursts because a chasing guard keeps moving. Returns what happened.
 */
export async function engage(page, look, grid, index) {
  for (let burst = 0; burst < MAX_BURSTS; burst += 1) {
    const state = await readCombat(page);
    // Never fire at a stats screen, and never fight on after dying (FR-007, US1-S11).
    if (state.dead || state.runState !== 'playing') return { killed: false, reason: 'the run stopped' };

    const guard = state.enemies[index];
    if (guard == null || guard.state === 'death') return { killed: true, kills: state.kills };

    const player = await readPlayer(page);
    if (!hasLineOfSight(grid, player, guard)) return { killed: false, reason: 'lost sight of it' };

    const armed = await selectArmedWeapon(page, state);
    if (armed == null) return { killed: false, reason: 'out of ammunition' };

    const bearing = yawToward(guard.x - player.x, guard.z - player.z);
    if (Math.abs(wrapAngle(bearing - player.yaw)) > 0.02) await look.turnTo(bearing);
    await fire(page, { framesHeld: BURST_FRAMES });
  }
  return { killed: false, reason: `it survived ${MAX_BURSTS} bursts` };
}

/**
 * Answers everything currently shooting at the agent, nearest first. Returns the number
 * killed, so a caller can report a firefight rather than a pause.
 */
export async function answerThreats(page, look, grid, { range = ENGAGE_RANGE_TILES } = {}) {
  let killed = 0;
  for (let round = 0; round < 4; round += 1) {
    const state = await readCombat(page);
    if (state.dead || state.runState !== 'playing') break;
    const player = await readPlayer(page);
    const found = threats(state.enemies, player, grid, { range });
    if (found.length === 0) break;
    const result = await engage(page, look, grid, found[0].index);
    if (result.killed) killed += 1;
    else break;
  }
  return killed;
}
