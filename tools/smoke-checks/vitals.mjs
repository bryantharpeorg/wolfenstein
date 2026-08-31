// The vitals smoke check (T021, T022; FR-009..FR-012). US2's systems-level claims
// exist only inside the render loop, so Constitution III verifies them here: damage
// reaching health, the gate death closes over movement and firing, the prompt, and a
// restart in place with no page reload. Adding `tools/smoke-checks/<name>.mjs` leaves
// `tools/smoke.mjs` — US4's — untouched.
//
// The two snapshots compared below are captured *in the page*, both at the same
// simulation age — zero — so a difference is a leak, not the harness racing the loop.
// Per-guard state is asserted there and only there: guard 0 sees the spawn tile and
// re-alerts within a tick or two of any world.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'vitals';

/** Read from the module declaring it, so the check asserts the page agrees with
 *  the source rather than with itself. */
function readDeclared(root, file, pattern) {
  return readFileSync(resolve(root, file), 'utf8').match(pattern);
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
    health: window.__diag.combat.health,
    dead: window.__diag.combat.dead,
    deaths: window.__diag.combat.deaths,
    restarts: window.__diag.combat.restarts,
    shotsFired: window.__diag.combat.shotsFired,
    ammo: window.__diag.combat.ammo.pistol,
    x: window.__diag.player.x,
    z: window.__diag.player.z,
    prompt: window.__combat.promptVisible(),
    errors: window.__diag.errors.length,
  }));

/** The fields on which the last completed reset differs from spawn, ignoring the
 *  exempt set read from the module that exports it (FR-019). */
const snapshotDiff = (page) =>
  page.evaluate(() => {
    const first = window.__combat.firstFrame();
    const after = window.__combat.restartFrame();
    if (first == null || after == null) return null;
    const exempt = new Set(window.__combat.exempt());
    return [...new Set([...Object.keys(first), ...Object.keys(after)])]
      .filter((field) => !exempt.has(field) && !Object.is(first[field], after[field]))
      .sort();
  });

/** Holds fire for `count` frames — for the claim that *no* shot resolves. */
async function fireFor(page, count) {
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })));
  await frames(page, count);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
}

/** Holds fire only until a shot resolves, and reports whether one did. The fire
 *  interval is elapsed *seconds*, so a frame count is the wrong unit: too few to reach
 *  it on a quick machine, far too many seconds on a slow one — seconds the guards can
 *  end the run in. */
async function fireUntilShot(page, capFrames = 600) {
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })));
  const fired = await page.evaluate(
    (cap) =>
      new Promise((done) => {
        const before = window.__diag.combat.shotsFired;
        let seen = 0;
        const tick = () => {
          if (window.__diag.combat.shotsFired > before) return done(true);
          if (++seen >= cap) return done(false);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    capFrames,
  );
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
  return fired;
}

export default async function check({ page, root }) {
  const errors = [];
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

  // US2-S1: the declared maximum at spawn, and the run not over.
  const spawn = await readState(page);
  claim(spawn.health === maxHealth, `spawn health ${spawn.health}, declared ${maxHealth}`);
  claim(!spawn.dead, 'the run is `dead` at spawn');
  claim(!spawn.prompt, 'the restart prompt is presented at spawn');
  claim(
    spawn.deaths === 0 && spawn.restarts === 0,
    `spawn counters are deaths=${spawn.deaths} restarts=${spawn.restarts}, not zero`,
  );

  // US2-S3: damage leaving health standing keeps the run alive. Applied and read in
  // one `evaluate`, so no guard shot lands between; the exact-damage claim is
  // `vitals.test.ts`'s. Half the maximum, not all but one: the guards fire throughout,
  // and a run one point from death would be ended by them.
  const woundBy = Math.floor(maxHealth / 2);
  const wound = await page.evaluate((amount) => {
    const before = window.__diag.combat.health;
    return { before, after: window.__combat.damage(amount) };
  }, woundBy);
  claim(
    wound.after === wound.before - woundBy,
    `damage of ${woundBy} took health ${wound.before} -> ${wound.after}`,
  );

  await frames(page, 2);
  const wounded = await readState(page);
  claim(!wounded.dead, 'the run entered `dead` with health still above zero');
  claim(wounded.errors === 0, `__diag.errors grew to ${wounded.errors} on taking damage`);

  claim(await fireUntilShot(page), 'firing stopped resolving while the player was alive');

  // US2-S3 again, and the setup for the comparison below: movement resolves while
  // alive, and leaves the player off the spawn tile, so the restart has a position
  // to put back rather than one that never changed (US2-S6).
  await page.evaluate(() => window.__playerDrive(0, 3, 340));
  await frames(page, 1);
  const walked = await readState(page);
  claim(
    walked.x !== spawn.x || walked.z !== spawn.z,
    'movement stopped resolving while the player was alive',
  );
  claim(!walked.dead, 'the guards ended the run before the scripted death could');

  // US2-S4: health reaching zero ends the run — movement and firing stop resolving,
  // the prompt is presented, `deaths` counts one. Whatever the guards left is read and
  // spent together, so the run reaches exactly zero.
  await page.evaluate(() => window.__combat.damage(window.__diag.combat.health));
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

  // US2-S6..S8: the restart resets in place. The sentinel proves no page reload.
  await page.evaluate(() => {
    window.__vitalsSentinel = 'kept';
    window.__combat.restart();
  });
  await frames(page, 4);

  claim(
    (await page.evaluate(() => window.__vitalsSentinel)) === 'kept',
    'the page reloaded on restart: the sentinel did not survive',
  );

  // US2-S6: the DOM prompt, which no snapshot carries. Nothing else is restated —
  // the comparison below names any field that leaked.
  const restarted = await readState(page);
  claim(!restarted.dead, 'the run is still `dead` after a restart');
  claim(!restarted.prompt, 'the restart prompt is still presented after a restart');

  // The only fields permitted to accumulate (SC-002).
  claim(restarted.deaths === 1, `deaths ${restarted.deaths} after restart, expected it to survive as 1`);
  claim(restarted.restarts === 1, `restarts ${restarted.restarts} after one restart`);

  // US2-S8 itself: field for field, guards included, against the exempt set read
  // from the module that exports it rather than restated here.
  const offending = await snapshotDiff(page);
  claim(offending != null, 'the page captured no spawn or post-restart snapshot');
  claim(
    offending == null || offending.length === 0,
    `post-restart snapshot differs from the spawn one at: ${(offending ?? []).join(', ')}`,
  );

  // Commands resolve again — also proof the render loop kept running through the
  // dead state.
  claim(await fireUntilShot(page), 'firing does not resolve again after a restart');
  const revived = await readState(page);
  claim(revived.ammo < spawn.ammo, 'a shot after restart spent no ammo');

  // US2-S9: restart is not exclusive to death. The run above spent ammo and fired
  // shots; walking off the spawn tile gives this reset position too. Three steps, not
  // twenty: every extra frame is one more for the guards to end the run in.
  for (let step = 0; step < 3; step += 1) {
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
  claim(!afterAlive.dead, 'an alive restart entered the dead state');
  // The same full reset, judged the same way: `restartFrame()` is the snapshot of
  // whichever reset completed last, so any field that leaked is named here.
  const aliveOffending = await snapshotDiff(page);
  claim(
    aliveOffending == null || aliveOffending.length === 0,
    `an alive restart left the run differing from spawn at: ${(aliveOffending ?? []).join(', ')}`,
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
