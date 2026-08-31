// The vitals smoke check (T021, T022; FR-009..FR-012). US2's systems-level claims
// exist only inside the render loop, so Constitution III has them verified here:
// damage reaching health, the gate death closes over movement and firing, the
// prompt, and a restart in place with no page reload. Adding
// `tools/smoke-checks/<name>.mjs` leaves `tools/smoke.mjs` — US4's, for FR-019 —
// untouched.
//
// The two snapshots compared below are captured *in the page*, one frame after
// the world was built and one frame after the reset completed, so each has seen
// the same simulation and a difference is a leak rather than the harness racing
// the loop. Per-guard state is asserted there and only there: guard 0 sees the
// spawn tile and goes `alert` on its second tick in a freshly built world too, so
// reading it later would assert 006's live behaviour, not this reset.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'vitals';

/** A declared constant read from the module declaring it, so the check asserts
 *  the page agrees with the source rather than with itself. */
function readDeclared(root, file, pattern) {
  return readFileSync(resolve(root, file), 'utf8').match(pattern);
}

/** Waits `count` rendered frames. */
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
    health: window.__diag.combat.health,
    score: window.__diag.combat.score,
    dead: window.__diag.combat.dead,
    deaths: window.__diag.combat.deaths,
    restarts: window.__diag.combat.restarts,
    shotsFired: window.__diag.combat.shotsFired,
    ammo: window.__diag.combat.ammo.pistol,
    x: window.__diag.player.x,
    z: window.__diag.player.z,
    enemiesAlive: window.__diag.enemiesAlive,
    prompt: window.__combat.promptVisible(),
    errors: window.__diag.errors.length,
  }));

/** Holds the fire binding down for `count` frames, then releases it. */
async function fireFor(page, count) {
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })));
  await frames(page, count);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
}

export default async function check({ page, root }) {
  const errors = [];
  /** Records `message` unless `ok`, so each assertion reads as its claim. */
  const claim = (ok, message) => {
    if (!ok) errors.push(message);
  };
  const declaredMax = readDeclared(root, 'src/combat/vitals.ts', /MAX_HEALTH\s*=\s*(\d+)/);
  if (declaredMax == null) return ['could not read MAX_HEALTH from src/combat/vitals.ts'];
  const maxHealth = Number(declaredMax[1]);

  if ((await page.evaluate(() => typeof window.__combat)) !== 'object') {
    return ['window.__combat is missing: the vitals system did not install its seam'];
  }

  await frames(page, 3);

  // US2-S1: health at spawn is the declared maximum, and the run is not over.
  const spawn = await readState(page);
  claim(spawn.health === maxHealth, `spawn health ${spawn.health}, declared ${maxHealth}`);
  claim(!spawn.dead, 'the run is `dead` at spawn');
  claim(!spawn.prompt, 'the restart prompt is presented at spawn');
  claim(
    spawn.deaths === 0 && spawn.restarts === 0,
    `spawn counters are deaths=${spawn.deaths} restarts=${spawn.restarts}, not zero`,
  );

  // US2-S3: damage that leaves health standing keeps the run alive, and movement
  // and firing go on resolving.
  await page.evaluate((amount) => window.__combat.damage(amount), maxHealth - 1);
  await frames(page, 2);
  const wounded = await readState(page);
  claim(wounded.health === 1, `health ${wounded.health} after ${maxHealth - 1} damage, expected 1`);
  claim(!wounded.dead, 'the run entered `dead` with health still above zero');
  claim(wounded.errors === 0, `__diag.errors grew to ${wounded.errors} on taking damage`);

  await fireFor(page, 60);
  const firedAlive = await readState(page);
  claim(firedAlive.shotsFired > wounded.shotsFired, 'firing stopped resolving while the player was alive');

  // US2-S4: health reaching zero ends the run. Movement and firing stop
  // resolving, the prompt is presented, and `deaths` counts one.
  await page.evaluate(() => window.__combat.damage(1));
  await frames(page, 2);
  const dead = await readState(page);
  claim(dead.health === 0, `health ${dead.health} at death, expected 0`);
  claim(dead.dead, 'health reached zero without entering the `dead` state');
  claim(dead.prompt, 'no restart prompt was presented on death');
  claim(dead.deaths === 1, `deaths is ${dead.deaths} after one death, expected 1`);

  await page.evaluate(() => window.__playerDrive(3, 3, 500));
  await fireFor(page, 60);
  const stilled = await readState(page);
  claim(
    stilled.x === dead.x && stilled.z === dead.z,
    `movement resolved while dead: (${dead.x}, ${dead.z}) -> (${stilled.x}, ${stilled.z})`,
  );
  claim(
    stilled.shotsFired === dead.shotsFired,
    `firing resolved while dead: ${dead.shotsFired} -> ${stilled.shotsFired}`,
  );

  // US2-S5: further shots leave health at zero and fire no second transition.
  await page.evaluate((amount) => window.__combat.damage(amount * 10), maxHealth);
  await frames(page, 2);
  const stillDead = await readState(page);
  claim(stillDead.health === 0, `health ${stillDead.health} after damage in the dead state`);
  claim(stillDead.deaths === 1, `deaths rose to ${stillDead.deaths} on a second shot`);

  // US2-S6, US2-S7, US2-S8: the restart resets in place. The sentinel proves the
  // page was not reloaded — a reload would take it with the window.
  await page.evaluate(() => {
    window.__vitalsSentinel = 'kept';
    window.__combat.restart();
  });
  await frames(page, 4);

  claim(
    (await page.evaluate(() => window.__vitalsSentinel)) === 'kept',
    'the page reloaded on restart: the sentinel did not survive',
  );

  // US2-S6, US2-S7: the DOM prompt, which no snapshot carries, and the guard
  // count — which `enemies.mjs` has already tied to the marker table in
  // `src/level.ts`, so the spawn reading here is the declared count. Health,
  // ammo, score, position, doors, secrets, keys and per-guard state are not
  // restated: the comparison below names any of them that leaked.
  const restarted = await readState(page);
  claim(!restarted.dead, 'the run is still `dead` after a restart');
  claim(!restarted.prompt, 'the restart prompt is still presented after a restart');
  claim(
    restarted.enemiesAlive === spawn.enemiesAlive,
    `enemiesAlive ${restarted.enemiesAlive} after restart, spawn count is ${spawn.enemiesAlive}`,
  );

  // The session counters are the only fields permitted to accumulate (SC-002).
  claim(restarted.deaths === 1, `deaths ${restarted.deaths} after restart, expected it to survive as 1`);
  claim(restarted.restarts === 1, `restarts ${restarted.restarts} after one restart`);

  // US2-S8 itself: field for field, including every guard's state, against the
  // exempt set read from the module that exports it rather than restated here.
  const offending = await page.evaluate(() => {
    const first = window.__combat.firstFrame();
    const after = window.__combat.restartFrame();
    if (first == null || after == null) return null;
    const exempt = new Set(window.__combat.exempt());
    return [...new Set([...Object.keys(first), ...Object.keys(after)])]
      .filter((field) => !exempt.has(field) && !Object.is(first[field], after[field]))
      .sort();
  });
  claim(offending != null, 'the page captured no first-frame or post-restart snapshot');
  claim(
    offending == null || offending.length === 0,
    `post-restart snapshot differs from the first frame at: ${(offending ?? []).join(', ')}`,
  );

  // Commands resolve again — also the proof the render loop kept running through
  // the dead state, since nothing below would resolve otherwise.
  await fireFor(page, 90);
  const revived = await readState(page);
  claim(revived.shotsFired > 0, 'firing does not resolve again after a restart');
  claim(revived.ammo < spawn.ammo, 'a shot after restart spent no ammo');

  // US2-S9: restart is not exclusive to death. The run above spent ammo and
  // fired shots; walking off the spawn tile gives this reset position too.
  for (let step = 0; step < 20; step += 1) {
    await page.evaluate(() => window.__playerDrive(0, 3, 340));
    await frames(page, 1);
  }
  const beforeAlive = await readState(page);
  claim(!beforeAlive.dead, 'the run is dead going into the alive-restart case');
  claim(
    beforeAlive.x !== spawn.x || beforeAlive.z !== spawn.z,
    'the player never left the spawn tile, so the alive restart resets nothing',
  );
  await page.evaluate(() => window.__combat.restart());
  await frames(page, 4);
  const afterAlive = await readState(page);
  claim(afterAlive.ammo === spawn.ammo, `an alive restart left pistol ammo at ${afterAlive.ammo}`);
  claim(afterAlive.shotsFired === 0, `an alive restart left shotsFired at ${afterAlive.shotsFired}`);
  claim(afterAlive.score === 0, `an alive restart left score at ${afterAlive.score}`);
  claim(afterAlive.health === maxHealth, `an alive restart left health at ${afterAlive.health}`);
  claim(!afterAlive.dead, 'an alive restart entered the dead state');
  claim(
    afterAlive.x === spawn.x && afterAlive.z === spawn.z,
    `an alive restart left the player at (${afterAlive.x}, ${afterAlive.z})`,
  );
  claim(
    afterAlive.deaths === beforeAlive.deaths,
    `an alive restart changed deaths: ${beforeAlive.deaths} -> ${afterAlive.deaths}`,
  );
  claim(
    afterAlive.restarts === beforeAlive.restarts + 1,
    `restarts went ${beforeAlive.restarts} -> ${afterAlive.restarts} across one restart`,
  );

  const finalErrors = await page.evaluate(() => window.__diag.errors);
  claim(finalErrors.length === 0, `__diag.errors: ${finalErrors.join(' | ')}`);

  return errors;
}
