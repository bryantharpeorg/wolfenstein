// The enemies system (order 60): spawns the guards, ticks them, and publishes
// what the smoke gate reads. It is discovered by `src/boot/discover.ts`'s glob,
// so `src/main.ts` is not edited by this story (FR-011, SC-004).
//
// It runs after the player systems (30-36) so the guards tick against this
// frame's player position, and after doors and secrets (45-47) so a door opened
// this frame counts for sight and pathing on the same frame. The system holds no
// behaviour: everything a test could assert lives in `src/enemy/world.ts`.

import { defineSystem } from '../../boot/registry';
import { createEnemyWorld } from '../../enemy/world';
import type { EnemyWorld } from '../../enemy/world';

let world: EnemyWorld | null = null;

/** The live guard world, or null before setup. US4's `enemy-billboards` system
 *  reads the records through this and writes each bearing back with
 *  `setViewAngle`, so neither story has to edit the other's file. */
export function getEnemyWorld(): EnemyWorld | null {
  return world;
}

defineSystem({
  name: 'enemies',
  order: 60,

  setup(ctx) {
    world = createEnemyWorld();
    // The diagnostics array is the world's own and is mutated in place, so this
    // reference is published once and stays correct for the life of the page.
    ctx.diag.enemies = world.enemyDiagnostics();
    ctx.diag.enemiesAlive = world.enemiesAlive();
    // Copied rather than aliased: the spawn result is frozen at setup.
    ctx.diag.enemySpawnErrors = [...world.spawnErrors];
  },

  update(ctx, deltaMs) {
    if (world === null) return;
    world.tickWorld(deltaMs);
    ctx.diag.enemiesAlive = world.enemiesAlive();
  },
});
