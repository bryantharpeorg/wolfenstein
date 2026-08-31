// The pickups smoke check (T029; FR-013, FR-014, FR-015). US3's systems-level
// claims exist only inside the render loop — proximity collection against the live
// player position, the four counters in `__diag.combat`, and the reset US2's
// restart runs — so Constitution III verifies them here. Adding
// `tools/smoke-checks/<name>.mjs` leaves `tools/smoke.mjs`, which is US4's, alone.
//
// Every expected value is read from the module that declares it — the marker table
// from `src/level.ts`, the maximum from `src/combat/vitals.ts`, the treasure value
// from `src/combat/score.ts` — so the page is asserted to agree with the source
// rather than with a number restated here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'pickups';

const source = (root, file) => readFileSync(resolve(root, file), 'utf8');

/** 002's item spawn table, parsed out of the file that declares it. */
function readMarkers(root) {
  const block = source(root, 'src/level.ts').match(/ITEM_SPAWNS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (block == null) return null;
  return [...block[1].matchAll(/\{\s*x:\s*(\d+),\s*z:\s*(\d+),\s*kind:\s*'([a-z-]+)'\s*\}/g)].map(
    (match) => ({ x: Number(match[1]), z: Number(match[2]), kind: match[3] }),
  );
}

const frames = (page, count) =>
  page.evaluate((n) => {
    let seen = 0;
    return new Promise((done) => {
      const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }, count);

const readState = (page) =>
  page.evaluate(() => ({
    collected: window.__diag.combat.pickupsCollected,
    total: window.__diag.combat.pickupsTotal,
    treasureFound: window.__diag.combat.treasureFound,
    treasureTotal: window.__diag.combat.treasureTotal,
    health: window.__diag.combat.health,
    score: window.__diag.combat.score,
    ammo: { ...window.__diag.combat.ammo },
    keys: { ...window.__diag.interaction.keys },
    x: window.__diag.player.x,
    z: window.__diag.player.z,
    errors: window.__diag.errors.length,
    pickupErrors: window.__diag.pickupErrors ?? null,
  }));

/** Drives the player to a tile centre, in the shape the locked-door pass uses. */
const walkTo = (page, x, z) =>
  page.evaluate(([targetX, targetZ]) => {
    for (let step = 0; step < 400; step += 1) {
      const fromX = window.__diag.player.x;
      const fromZ = window.__diag.player.z;
      const distance = Math.hypot(targetX - fromX, targetZ - fromZ);
      if (distance < 0.05) break;
      window.__playerDrive((4 * (targetX - fromX)) / distance, (4 * (targetZ - fromZ)) / distance, 50);
      if (Math.hypot(window.__diag.player.x - fromX, window.__diag.player.z - fromZ) < 1e-4) break;
    }
    return { x: window.__diag.player.x, z: window.__diag.player.z };
  }, [x, z]);

export default async function check({ page, root }) {
  const errors = [];
  const claim = (ok, message) => {
    if (!ok) errors.push(message);
  };

  const markers = readMarkers(root);
  if (markers == null || markers.length === 0) {
    return ['could not read ITEM_SPAWNS from src/level.ts'];
  }
  const maxHealth = source(root, 'src/combat/vitals.ts').match(/MAX_HEALTH\s*=\s*(\d+)/);
  const treasureValue = source(root, 'src/combat/score.ts').match(/treasure:\s*\{\s*treasure:\s*(\d+)/);
  if (maxHealth == null || treasureValue == null) {
    return ['could not read MAX_HEALTH or the treasure score value from their modules'];
  }
  const MAX_HEALTH = Number(maxHealth[1]);
  const TREASURE = Number(treasureValue[1]);

  if ((await page.evaluate(() => window.__diag.combat)) == null) {
    return ['__diag.combat is missing: the combat diagnostics were never attached'];
  }
  await page.waitForFunction(() => typeof window.__playerDrive === 'function', { timeout: 15000 });
  await frames(page, 3);

  // US3-S1: one pickup per marker, and the totals read from the level.
  const spawn = await readState(page);
  claim(
    spawn.total === markers.length,
    `pickupsTotal is ${spawn.total}, but src/level.ts declares ${markers.length} item markers`,
  );
  claim(
    spawn.treasureTotal === markers.filter((m) => m.kind === 'treasure').length,
    `treasureTotal is ${spawn.treasureTotal}, not the count of treasure markers`,
  );
  claim(spawn.collected === 0 && spawn.treasureFound === 0, 'the run starts with pickups collected');

  // US3-S2: the shipped level declares no undeclared kind, so the record is empty —
  // present and empty, not absent, which is what makes its emptiness a reading.
  claim(Array.isArray(spawn.pickupErrors), '__diag.pickupErrors is not published as an array');
  claim(
    (spawn.pickupErrors ?? []).length === 0,
    `the shipped level recorded marker errors: ${(spawn.pickupErrors ?? []).join(' | ')}`,
  );

  const at = (kind, index = 0) => markers.filter((m) => m.kind === kind)[index];
  const nearest = (kind) => {
    const found = markers
      .filter((m) => m.kind === kind)
      .sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z));
    return found[0];
  };

  // US3-S6, taken first and while it is still true: the guards are firing from the
  // moment the page loads, so "at exactly maximum health" is a window, not a state
  // the check can arrange. Asserted only if health held at the maximum across the
  // whole leg — the unqualified claim is `pickup-effects.test.ts`'s.
  const health = nearest('health');
  const beforeFull = await readState(page);
  await walkTo(page, health.x + 0.5, health.z + 0.5);
  await frames(page, 2);
  const atFull = await readState(page);
  if (beforeFull.health === MAX_HEALTH && atFull.health === MAX_HEALTH) {
    claim(
      atFull.collected === 0,
      'a health pickup was consumed by a player at maximum health, destroying supplies',
    );
  } else {
    // Said aloud rather than skipped quietly: the guards fire from load, and a run
    // wounded before the player reached the tile cannot test a full one. The
    // unqualified claim is `pickup-effects.test.ts`'s and is not weakened here.
    console.log('  pickups.mjs: the guards wounded the run before the full-health leg; it was not asserted');
  }

  // US3-S5: wounded, the same pickup is taken and health rises, clamped. Off the
  // tile *before* the damage: standing in the radius, the next frame would collect
  // it the instant health dropped, and the reading below would be of that frame.
  await walkTo(page, health.x + 0.5, health.z + 2.5);
  await page.evaluate((amount) => window.__combat.damage(amount), Math.floor(MAX_HEALTH / 2));
  await frames(page, 1);
  const wounded = await readState(page);
  await walkTo(page, health.x + 0.5, health.z + 0.5);
  await frames(page, 2);
  const healed = await readState(page);
  claim(healed.collected === wounded.collected + 1, 'a wounded player did not collect the health pickup');
  claim(
    healed.health > wounded.health && healed.health <= MAX_HEALTH,
    `health went ${wounded.health} -> ${healed.health}, not up and inside ${MAX_HEALTH}`,
  );

  // US3-S4: a second pass over the same, now consumed, pickup does nothing at all.
  await walkTo(page, health.x + 0.5, health.z + 2.5);
  await walkTo(page, health.x + 0.5, health.z + 0.5);
  await frames(page, 2);
  const second = await readState(page);
  claim(
    second.collected === healed.collected,
    `a second pass over a consumed pickup raised pickupsCollected ${healed.collected} -> ${second.collected}`,
  );
  claim(second.errors === 0, `__diag.errors grew to ${second.errors} on a second pass`);

  // US3-S8: treasure is always taken, and pays the score-table value.
  const treasure = nearest('treasure');
  const beforeTreasure = await readState(page);
  await walkTo(page, treasure.x + 0.5, treasure.z + 0.5);
  await frames(page, 2);
  const afterTreasure = await readState(page);
  claim(
    afterTreasure.treasureFound === beforeTreasure.treasureFound + 1,
    `treasureFound went ${beforeTreasure.treasureFound} -> ${afterTreasure.treasureFound} over one treasure`,
  );
  claim(
    afterTreasure.score === beforeTreasure.score + TREASURE,
    `score went ${beforeTreasure.score} -> ${afterTreasure.score}, not up by the table's ${TREASURE}`,
  );
  claim(
    afterTreasure.collected === beforeTreasure.collected + 1,
    'collecting treasure did not increment pickupsCollected by exactly one',
  );

  // US3-S7: ammo is added, and no counter is left above its weapon's capacity.
  const ammo = nearest('ammo');
  const beforeAmmo = await readState(page);
  await walkTo(page, ammo.x + 0.5, ammo.z + 0.5);
  await frames(page, 2);
  const afterAmmo = await readState(page);
  claim(
    afterAmmo.collected === beforeAmmo.collected + 1,
    'walking over the ammo pickup collected nothing',
  );
  const capacities = source(root, 'src/combat/weapons.ts');
  for (const [weapon, count] of Object.entries(afterAmmo.ammo)) {
    const declared = capacities.match(new RegExp(`${weapon}:\\s*\\{[^}]*ammoCapacity:\\s*(\\d+)`));
    if (declared == null) continue;
    claim(count <= Number(declared[1]), `${weapon} ammo is ${count}, above its capacity ${declared[1]}`);
  }
  claim(
    afterAmmo.ammo.pistol >= beforeAmmo.ammo.pistol,
    `pistol ammo fell over an ammo pickup: ${beforeAmmo.ammo.pistol} -> ${afterAmmo.ammo.pistol}`,
  );

  // US3-S9: a key is collected by this same path — no second mechanism, and it is
  // counted by these same counters.
  const key = at('silver-key');
  // The route the locked-door pass walks: the key is two rooms away, behind the
  // unlocked door at (10,21), so getting there means opening it and coming at the
  // centre room along row 31 rather than through a wall.
  await walkTo(page, 10.5, 20.5);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })),
  );
  await page.waitForFunction(() => window.__diag.interaction.doorsOpen >= 1, { timeout: 8000 });
  await walkTo(page, 10.5, 31.5);
  await walkTo(page, key.x + 0.5, 31.5);
  const beforeKey = await readState(page);
  await walkTo(page, key.x + 0.5, key.z + 0.5);
  await frames(page, 2);
  const afterKey = await readState(page);
  claim(afterKey.keys.silver === 1, `the silver key was not collected: keys.silver=${afterKey.keys.silver}`);
  claim(
    afterKey.collected === beforeKey.collected + 1,
    'the silver key did not flow through the pickup counters, so it took a second mechanism',
  );

  // US3-S10: neither counter ever ran past its total.
  claim(
    afterKey.collected <= afterKey.total && afterKey.treasureFound <= afterKey.treasureTotal,
    `a counter exceeded its total: ${afterKey.collected}/${afterKey.total}, ` +
      `${afterKey.treasureFound}/${afterKey.treasureTotal}`,
  );

  // US2-S7 for this story's state: restart puts every pickup back on the floor.
  claim(afterKey.collected > 0, 'nothing was collected, so the restart resets nothing');
  await page.evaluate(() => window.__combat.restart());
  await frames(page, 4);
  const restarted = await readState(page);
  claim(restarted.collected === 0, `pickupsCollected is ${restarted.collected} after a restart, not 0`);
  claim(restarted.treasureFound === 0, `treasureFound is ${restarted.treasureFound} after a restart, not 0`);
  claim(
    restarted.total === spawn.total && restarted.treasureTotal === spawn.treasureTotal,
    'a restart moved the totals, which are facts about the level',
  );
  claim(restarted.keys.silver === 0, `keys.silver is ${restarted.keys.silver} after a restart, not 0`);

  // Collectable again: a reset pickup is a pickup, not a consumed one with a zeroed
  // counter beside it.
  // The restart put the player back on 002's spawn tile, so the treasure to walk
  // onto is the one in that room — reachable without reopening a door.
  await walkTo(page, treasure.x + 0.5, treasure.z + 0.5);
  await frames(page, 2);
  const recollected = await readState(page);
  claim(
    recollected.collected >= 1,
    'no pickup could be collected after the restart, so they were reset only on paper',
  );

  const finalErrors = await page.evaluate(() => window.__diag.errors);
  claim(finalErrors.length === 0, `__diag.errors: ${finalErrors.join(' | ')}`);

  return errors;
}
