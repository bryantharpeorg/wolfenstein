// The enemies system (order 60): spawns the guards, ticks them, and publishes
// what the smoke gate reads. It is discovered by `src/boot/discover.ts`'s glob,
// so `src/main.ts` is not edited by this story (FR-011, SC-004).
//
// It runs after the player systems (30-36) so the guards tick against this
// frame's player position, and after doors and secrets (45-47) so a door opened
// this frame counts for sight and pathing on the same frame. The system holds no
// behaviour: everything a test could assert lives in `src/enemy/world.ts`.

import { defineSystem, type GameContext } from '../../boot/registry';
import { createEnemyWorld } from '../../enemy/world';
import type { EnemyWorld, TickReport } from '../../enemy/world';

const NO_TICK: TickReport = { ticks: 0, shots: [], damageToPlayer: 0 };

let world: EnemyWorld | null = null;
let context: GameContext | null = null;
let lastTick: TickReport = NO_TICK;

/** The live guard world, or null before setup. US4's `enemy-billboards` system
 *  reads the records through this and writes each bearing back with
 *  `setViewAngle`, so neither story has to edit the other's file. */
export function getEnemyWorld(): EnemyWorld | null {
  return world;
}

/** What this frame's ticks did, so whichever spec owns player health applies the
 *  damage 006's attack module already computed rather than recomputing falloff
 *  (007 FR-009). Read by the vitals system at order 75. */
export function getLastTickReport(): TickReport {
  return lastTick;
}

/** 007's restart (FR-011): the world is rebuilt rather than rewound, because the
 *  tick accumulator and the queued per-guard damage are its own — a rewind would
 *  land a pre-restart shot on a post-restart guard. The records come back in
 *  spawn order with the same ids, so US4's billboards keep their quads. */
export function resetEnemyRun(): void {
  if (context == null) return;
  world = createEnemyWorld();
  lastTick = NO_TICK;
  context.diag.enemies = world.enemyDiagnostics();
  context.diag.enemiesAlive = world.enemiesAlive();
  context.diag.enemySpawnErrors = [...world.spawnErrors];
}

defineSystem({
  name: 'enemies',
  order: 60,

  setup(ctx) {
    context = ctx;
    world = createEnemyWorld();
    // The diagnostics array is the world's own and is mutated in place, so this
    // reference is published once and stays correct for the life of the page.
    ctx.diag.enemies = world.enemyDiagnostics();
    ctx.diag.enemiesAlive = world.enemiesAlive();
    // Copied rather than aliased: the spawn result is frozen at setup.
    ctx.diag.enemySpawnErrors = [...world.spawnErrors];
  },

  update(ctx, deltaMs) {
    context = ctx;
    if (world === null) return;
    lastTick = world.tickWorld(deltaMs);
    ctx.diag.enemiesAlive = world.enemiesAlive();
  },
});
