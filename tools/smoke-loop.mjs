// US4's full-loop smoke pass (T040-T042; FR-018, FR-019, SC-001, SC-002, SC-006). One run of
// the built page: every weapon fired, a guard killed by a ray from the camera centre, health
// walked down the declared portrait bands to zero, and a restart compared to the first frame
// field for field. (Pickup collection is US3's `tools/smoke-checks/pickups.mjs`, which runs
// in this same `npm run smoke`.) Every failure names its step. It lives beside
// `tools/smoke.mjs`, which calls it, because that harness is already past Constitution IV's

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** FR-018's contract, and the 001-006 fields as those specs shipped them: `name:type`, or
 *  `name:*` where the source declares the field nullable. Restated rather than read from the
 *  modules under test, which would pass whatever they declared. `combat` is additive over the
 *  rest; a rename, a removal or a repurposing fails here (T042, US4-S10). */
const CONTRACT = {
  __diag: `ready:boolean renderer:string fps:number frameTimeMs:number drawCalls:number
    errors:object fallbackReason:* level:object enemies:object enemiesAlive:number
    enemySpawnErrors:object`,
  player: `x:number z:number yaw:number pitch:number speed:number sprinting:boolean
    pointerLocked:boolean stuck:boolean bobOffset:number`,
  interaction: `doorsTotal:number doorsOpen:number secretsFound:number secretsTotal:number
    keys:object lastReason:* lastRefusalKeyKind:* keyConsumed:boolean`,
  combat: `weapon:string ammo:object health:number score:number shotsFired:number hits:number
    kills:number pickupsCollected:number pickupsTotal:number treasureFound:number
    treasureTotal:number dead:boolean deaths:number restarts:number muzzleFlash:number
    hudReady:boolean`,
};

const WEAPONS = { pistol: 'Digit1', smg: 'Digit2', chaingun: 'Digit3' };

const source = (root, file) => readFileSync(resolve(root, file), 'utf8');

const readTable = (root, file, name, pattern) => {
  const block = source(root, file).match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`));
  return block == null ? [] : [...block[1].matchAll(pattern)].map((m) => m.slice(1).map(Number));
};

/** The portrait the declared ladder gives a reading, recomputed here rather than taken
 *  from the page (US4-S4). */
const declaredPortrait = (bands, health) => bands.find((b) => health >= b.minHealth)?.index ?? bands.length;

const state = (page) =>
  page.evaluate(() => ({
    ...window.__diag.combat,
    ammo: { ...window.__diag.combat.ammo },
    keys: { ...window.__diag.interaction.keys },
    drawCalls: window.__diag.drawCalls,
    errors: window.__diag.errors.length,
    x: window.__diag.player.x,
    z: window.__diag.player.z,
  }));

const installDriver = (page) =>
  page.evaluate(() => {
    const combat = () => window.__diag.combat;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const hold = () => window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const release = () => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    const aim = (guard, step) => window.__enemySprites.orbit(guard, step, { radius: 1.8 });

    window.__loop = {
      async frames(count) {
        for (let seen = 0; seen < count; seen += 1) await frame();
      },

      async select(code, kind) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        for (let seen = 0; seen < 120 && combat().weapon !== kind; seen += 1) await frame();
        return combat().weapon;
      },

      /** Holds the trigger, watching *every* frame for the peak flash and what was drawn on
       *  it. `wanted` false is the US4-S7 case: hold, expecting no shot and no light. */
      async fire(cap, wanted) {
        const before = { shots: combat().shotsFired, ammo: { ...combat().ammo } };
        const peak = { flash: 0, drawCalls: 0, pose: null };
        let after = 0;
        hold();
        for (let seen = 0; seen < cap && (!wanted || after < 3); seen += 1) {
          await frame();
          if (combat().muzzleFlash > peak.flash) {
            peak.flash = combat().muzzleFlash;
            peak.drawCalls = window.__diag.drawCalls;
            peak.pose = window.__hud.viewModel()?.pose ?? null;
          }
          if (after > 0 || combat().shotsFired > before.shots) after += 1;
        }
        release();
        return { fired: after > 0, before, peak, ammo: { ...combat().ammo }, shots: combat().shotsFired };
      },

      async rest(seconds) {
        const until = performance.now() + seconds * 1000;
        while (performance.now() < until) await frame();
        return { muzzleFlash: combat().muzzleFlash, view: window.__hud.viewModel() };
      },

      /** One scripted change and what the HUD composited on the very next frame, both
       *  in the page: US4-S3 is a claim about *one* frame. */
      async hudNextFrame(damage) {
        const before = window.__hud.composites();
        if (damage > 0) window.__combat.damage(damage);
        await frame();
        const live = combat();
        return {
          composites: { before, after: window.__hud.composites() },
          drawn: window.__hud.drawn(),
          live: { health: live.health, weapon: live.weapon, ammo: live.ammo[live.weapon],
            score: live.score, keys: { ...window.__diag.interaction.keys } },
        };
      },

      /** Stands the camera in front of one guard after another and fires until one dies. 006's
       *  orbit seam moves the *camera*, never the player -- US4-S8's arrangement exactly: the
       *  ray leaves the camera centre, so aiming the camera is aiming the shot wherever the
       *  view-model is drawn. */
      async killOne(guards) {
        const start = { hits: combat().hits, kills: combat().kills };
        const done = () => combat().kills > start.kills;
        try {
          for (let guard = 0; guard < guards && !done(); guard += 1) {
            for (let step = 0; step < 8 && !done(); step += 1) {
              const hits = combat().hits;
              hold();
              for (let seen = 0; seen < 5 || (combat().hits > hits && seen < 120); seen += 1) {
                if (done()) break;
                aim(guard, step);
                await frame();
              }
              release();
            }
          }
        } finally {
          release();
          window.__enemySprites.release();
        }
        return { hits: combat().hits - start.hits, kills: combat().kills - start.kills };
      },

      async walkBands(rungs) {
        const readings = [];
        for (const rung of rungs) {
          const health = combat().health;
          if (health > rung) window.__combat.damage(health - rung);
          await frame();
          const shown = window.__hud.drawn();
          readings.push({ health: combat().health, index: shown?.portraitIndex ?? null,
            shownHealth: shown?.health ?? null });
          if (combat().dead) break;
        }
        return readings;
      },

    };
  });

const drive = (page, method, ...args) => page.evaluate(([name, rest]) => window.__loop[name](...rest), [method, args]);

export async function runCombatLoopPass(browser, url, root) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  let step = 'load';
  page.on('pageerror', (error) => errors.push(`combat loop: pageerror: ${error.message}`));
  const fail = (message) => errors.push(`combat loop step '${step}': ${message}`);
  const claim = (ok, message) => { if (!ok) fail(message); };
  const finish = async () => { await context.close(); return errors; };

  const bands = readTable(root, 'src/hud/portrait.ts', 'HEALTH_BANDS',
    /index:\s*(\d+),\s*minHealth:\s*([\d.]+)/g).map(([index, minHealth]) => ({ index, minHealth }));
  const decay = source(root, 'src/hud/flash.ts').match(/MUZZLE_FLASH_DECAY_SECONDS\s*=\s*([\d.]+)/);
  if (bands.length === 0 || decay == null) {
    fail('HEALTH_BANDS or MUZZLE_FLASH_DECAY_SECONDS could not be read from their own modules');
    return finish();
  }
  const decaySeconds = Number(decay[1]);

  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(
      () => window.__diag?.combat?.hudReady === true && window.__hud != null && window.__combat != null &&
        typeof window.__playerDrive === 'function' && typeof window.__enemySprites?.orbit === 'function',
      { timeout: 20000 },
    );
  } catch (error) {
    fail(`hudReady and the scripted seams did not appear within 20s (${error})`);
    return finish();
  }
  await installDriver(page);

  step = 'the __diag contract';
  const spawn = await state(page);
  claim(spawn.hudReady === true, 'hudReady is not true after the first frame');
  claim(spawn.muzzleFlash === 0, `muzzleFlash ${spawn.muzzleFlash} before any shot`);
  claim(spawn.drawCalls < 20, `drawCalls ${spawn.drawCalls} with the HUD drawn`);
  const problems = await page.evaluate((groups) => {
    const found = [];
    for (const [label, declared] of Object.entries(groups)) {
      const target = label === '__diag' ? window.__diag : window.__diag?.[label];
      if (target == null) { found.push(`__diag.${label} is missing`); continue; }
      for (const entry of declared.split(/\s+/).filter(Boolean)) {
        const [field, type] = entry.split(':');
        if (!(field in target)) found.push(`${label}.${field} absent: renamed or removed`);
        else if (type !== '*' && typeof target[field] !== type) {
          found.push(`${label}.${field} is a ${typeof target[field]}, not ${type}: repurposed`);
        }
      }
    }
    return found;
  }, CONTRACT);
  errors.push(...problems.map((message) => `combat loop step '${step}': ${message}`));

  const rest = await page.evaluate(() => window.__hud.viewModel());
  if (rest == null) { fail('__hud.viewModel() is null: the view-model was never built'); return finish(); }
  const atRest = (pose) => pose.x === rest.rest.x && pose.y === rest.rest.y && pose.z === rest.rest.z;
  claim(atRest(rest.pose), `starts at ${JSON.stringify(rest.pose)}, not its rest`);
  claim(rest.pose.flashVisible === false, 'the flash is drawn before any shot');

  // T040: fire every weapon (US4-S6, US4-S7, US4-S9).
  for (const [kind, code] of Object.entries(WEAPONS)) {
    step = `fire the ${kind}`;
    claim((await drive(page, 'select', code, kind)) === kind, 'selecting the weapon did not take');
    const shot = await drive(page, 'fire', 900, true);
    claim(shot.fired && shot.shots > shot.before.shots, 'holding fire resolved no shot');
    claim(shot.ammo[kind] < shot.before.ammo[kind], `no ammo spent: ${shot.before.ammo[kind]}`);
    claim(shot.peak.flash > 0, 'no muzzle flash on the frame the shot resolved');
    claim(shot.peak.drawCalls > 0 && shot.peak.drawCalls < 20, `drawCalls ${shot.peak.drawCalls} while lit`);
    // US4-S6's other half: the view-model plays its fire motion on that frame.
    claim(shot.peak.pose?.z > rest.rest.z && shot.peak.pose?.y < rest.rest.y, 'no kick back and drop');
    claim(shot.peak.pose?.flashVisible === true, 'the flash mesh was not drawn on the firing frame');
    // US4-S7: no shot for longer than the decay, and both are back at rest.
    const settled = await drive(page, 'rest', decaySeconds * 3);
    claim(settled.muzzleFlash === 0, `muzzleFlash ${settled.muzzleFlash} after the decay`);
    claim(settled.view != null && atRest(settled.view.pose) && settled.view.pose.pitch === rest.pose.pitch,
      `settled at ${JSON.stringify(settled.view?.pose)}, not its rest`);
    claim(settled.view?.pose.flashVisible === false, 'the flash mesh is still drawn after the decay');
  }

  // US4-S2, US4-S3: the HUD shows the state, within one frame.
  step = 'the HUD reads live state';
  const shown = await drive(page, 'hudNextFrame', 7);
  if (shown.drawn == null) { fail('__hud.drawn() is null after the HUD has composited'); return finish(); }
  for (const field of ['health', 'weapon', 'ammo', 'score']) {
    claim(shown.drawn[field] === shown.live[field], `${field}: drawn ${shown.drawn[field]}, live ${shown.live[field]}`);
  }
  claim(shown.drawn.keys.silver === shown.live.keys.silver && shown.drawn.keys.gold === shown.live.keys.gold,
    `keys: drawn ${JSON.stringify(shown.drawn.keys)}, live ${JSON.stringify(shown.live.keys)}`);
  claim(shown.composites.after > shown.composites.before, 'no recomposite after health changed');

  step = 'hit and kill a guard';
  const guards = await page.evaluate(() => window.__diag.enemies.length);
  claim(guards > 0, 'the level published no guards to shoot at');
  await drive(page, 'select', WEAPONS.smg, 'smg');
  const fight = await drive(page, 'killOne', guards);
  claim(fight.hits > 0, 'no shot reached a guard, though the camera was aimed at one');
  claim(fight.kills > 0, `${fight.hits} shots reached a guard and none killed it`);

  step = 'restart in the middle of the run';
  await page.evaluate(() => { window.__loopSentinel = 'kept'; window.__combat.restart(); });
  await drive(page, 'frames', 4);
  const revived = await state(page);
  claim(revived.restarts === 1 && revived.deaths === 0, `restarts ${revived.restarts}, deaths ${revived.deaths}`);
  claim(revived.dead === false, 'an alive restart entered the dead state');

  // US4-S4: the portrait ladder, walked down to death.
  step = 'walk the portrait bands down to zero health';
  const rungs = bands.flatMap((band, index) =>
    index + 1 < bands.length ? [band.minHealth, band.minHealth - 0.5] : [band.minHealth]);
  const readings = await drive(page, 'walkBands', [...rungs, 0]);
  claim(readings.length > 0, 'the band walk took no readings');
  for (const reading of readings) {
    const expected = declaredPortrait(bands, reading.health);
    claim(reading.index === expected, `health ${reading.health}: portrait ${reading.index}, bands give ${expected}`);
    claim(reading.shownHealth === reading.health, `drawn health ${reading.shownHealth}, live ${reading.health}`);
  }
  const seen = readings.map((reading) => reading.index);
  claim(new Set(seen).size >= 3, `only portraits ${[...new Set(seen)]} reported`);
  claim(seen.every((index, at) => at === 0 || index >= seen[at - 1]), `portraits not monotonic: ${seen.join(', ')}`);
  claim(seen.at(-1) === bands.length, `at zero: portrait ${seen.at(-1)}, not ${bands.length}`);

  step = 'reach zero health';
  const dead = await state(page);
  claim(dead.health === 0 && dead.dead === true, `health ${dead.health}, dead ${dead.dead}`);
  claim(dead.deaths === 1 && dead.hudReady === true, `deaths ${dead.deaths}, hudReady ${dead.hudReady}`);
  // US4-S7 on the live page: the trigger is held, no shot resolves, nothing lights.
  const trigger = await drive(page, 'fire', 45, false);
  claim(!trigger.fired, `firing resolved while dead: ${trigger.before.shots} -> ${trigger.shots}`);
  claim(trigger.peak.flash === 0, `the fire key lit the flash to ${trigger.peak.flash} with no shot`);

  step = 'restart';
  await page.evaluate(() => window.__combat.restart());
  await drive(page, 'frames', 4);
  claim((await page.evaluate(() => window.__loopSentinel)) === 'kept', 'the page reloaded on restart');
  const restarted = await state(page);
  claim(restarted.dead === false, 'the run is still dead after a restart');
  claim(restarted.restarts === 2, `restarts ${restarted.restarts} after two restarts`);
  claim(restarted.deaths === 1, `deaths ${restarted.deaths}: it must survive a restart as 1`);
  claim(restarted.muzzleFlash === 0 && restarted.hudReady, 'the flash or hudReady broke on restart');
  claim(restarted.drawCalls < 20, `drawCalls ${restarted.drawCalls} after a restart`);

  step = 'the post-restart snapshot';
  const offending = await page.evaluate(() => {
    const first = window.__combat.firstFrame();
    const after = window.__combat.restartFrame();
    if (first == null || after == null) return null;
    // The exempt set is US2's export, read here rather than restated (SC-002).
    const exempt = new Set(window.__combat.exempt());
    return [...new Set([...Object.keys(first), ...Object.keys(after)])]
      .filter((field) => !exempt.has(field) && !Object.is(first[field], after[field])).sort();
  });
  claim(offending != null, 'the page captured no spawn or post-restart snapshot');
  claim(offending == null || offending.length === 0,
    `the post-restart snapshot differs from the first frame at: ${offending}`);

  step = 'the page reported no errors';
  claim((await state(page)).errors === 0, 'the page reported errors during the loop');

  if (errors.length === 0) {
    console.log(`  combat loop: every weapon fired, ${fight.hits} shots on a guard, ${fight.kills} killed, ` +
      `portraits ${[...new Set(seen)].join('>')}, deaths ${restarted.deaths}, restarts ${restarted.restarts}`);
  }

  return finish();
}
