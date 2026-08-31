// The driving half of US4's full-loop smoke pass (T040; FR-019, SC-001).
//
// `tools/smoke.mjs` owns the assertions -- what must be true, and which step is
// named when it is not. This module owns the *driving*: selecting a weapon,
// holding fire until a shot actually resolves, standing the camera where a guard
// is in front of it, walking to a marker, and pressing interact. It lives beside
// the harness rather than inside it for the reason `006` recorded when it split
// out `smoke-check-runner.mjs`: `tools/smoke.mjs` is already past Constitution
// IV's 400-line ceiling, and this story is not the one that rewrites it.
//
// Everything that has to observe consecutive frames runs *in the page*, in one
// `evaluate`, rather than as a sequence of round trips from node. That is not a
// style preference: the muzzle flash decays in a declared tenth of a second, and a
// harness that reads it over a CDP round trip is reading whatever frame the round
// trip happened to land in.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const WEAPON_SELECT_CODES = { pistol: 'Digit1', smg: 'Digit2', chaingun: 'Digit3' };

/** Read a declared constant from the module that declares it, so the harness
 *  asserts the page agrees with the source rather than with itself. */
export function readDeclared(root, file, pattern) {
  const found = readFileSync(resolve(root, file), 'utf8').match(pattern);
  return found == null ? null : found[1];
}

/** 002's item spawn table, parsed out of the file that declares it. */
export function readMarkers(root) {
  const block = readFileSync(resolve(root, 'src/level.ts'), 'utf8').match(
    /ITEM_SPAWNS[^=]*=\s*\[([\s\S]*?)\n\];/,
  );
  if (block == null) return null;
  return [...block[1].matchAll(/\{\s*x:\s*(\d+),\s*z:\s*(\d+),\s*kind:\s*'([a-z-]+)'\s*\}/g)].map(
    (match) => ({ x: Number(match[1]), z: Number(match[2]), kind: match[3] }),
  );
}

/** The field names of a TypeScript interface, read from its own declaration. */
export function interfaceFields(source, name) {
  const block = source.match(new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (block == null) return null;
  const fields = [];
  for (const line of block[1].split('\n')) {
    const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const match = stripped.match(/^\s*(?:readonly\s+)?([A-Za-z_][\w]*)(\??)\s*:\s*(.+?);?\s*$/);
    if (match == null) continue;
    fields.push({ name: match[1], optional: match[2] === '?', type: match[3].trim() });
  }
  return fields;
}

export const frames = (page, count) =>
  page.evaluate((n) => {
    let seen = 0;
    return new Promise((done) => {
      const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }, count);

/** The whole combat readout, by copy. */
export const combatState = (page) =>
  page.evaluate(() => ({
    ...window.__diag.combat,
    ammo: { ...window.__diag.combat.ammo },
    keys: { ...window.__diag.interaction.keys },
    drawCalls: window.__diag.drawCalls,
    errors: window.__diag.errors.length,
    x: window.__diag.player.x,
    z: window.__diag.player.z,
  }));

/**
 * Installs the page-side driver. Every helper below runs inside the page, so a
 * loop that has to watch consecutive frames watches them where they happen.
 */
export function installLoopDrive(page) {
  return page.evaluate(() => {
    const combat = () => window.__diag.combat;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const hold = () => window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const release = () => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));

    window.__smokeLoop = {
      /** Presses a select key and waits for the published weapon to change. */
      async select(code, kind, cap) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        for (let seen = 0; seen < cap && combat().weapon !== kind; seen += 1) await frame();
        return combat().weapon;
      },

      /**
       * Holds fire until one shot resolves, watching every frame for the peak
       * muzzle flash rather than sampling once — a shot's flash is out in a
       * declared tenth of a second, and the frame the harness gets to look at is
       * not necessarily the frame the shot resolved in.
       */
      async fireOnce(cap, settleFrames) {
        const before = {
          shots: combat().shotsFired,
          ammo: { ...combat().ammo },
          weapon: combat().weapon,
        };
        let peakFlash = 0;
        let drawCallsWhenLit = 0;
        let peakDrawCalls = 0;
        let fired = false;
        let settled = 0;

        hold();
        for (let seen = 0; seen < cap; seen += 1) {
          await frame();
          const flash = combat().muzzleFlash;
          if (window.__diag.drawCalls > peakDrawCalls) peakDrawCalls = window.__diag.drawCalls;
          if (flash > peakFlash) {
            peakFlash = flash;
            drawCallsWhenLit = window.__diag.drawCalls;
          }
          if (!fired && combat().shotsFired > before.shots) fired = true;
          // A few frames past the shot, so the peak is not missed by one frame.
          if (fired && ++settled >= settleFrames) break;
        }
        release();

        return {
          fired,
          before,
          peakFlash,
          drawCallsWhenLit,
          peakDrawCalls,
          after: { shots: combat().shotsFired, ammo: { ...combat().ammo }, weapon: combat().weapon },
        };
      },

      /** Holds fire for `count` frames and reports what moved. For the claim that
       *  a trigger resolving nothing lights nothing (US4-S7). */
      async holdWithoutFiring(count) {
        const shots = combat().shotsFired;
        let peakFlash = 0;
        hold();
        for (let seen = 0; seen < count; seen += 1) {
          await frame();
          if (combat().muzzleFlash > peakFlash) peakFlash = combat().muzzleFlash;
        }
        release();
        return { shots, movedTo: combat().shotsFired, peakFlash, flashNow: combat().muzzleFlash };
      },

      /**
       * Applies one scripted change and reads what the HUD composited on the very
       * next frame, both in the page. The change and the read are one round trip
       * on purpose: US4-S3 is a claim about *one frame*, and a claim measured
       * across two CDP round trips is not measuring that.
       */
      hudWithinOneFrame(damage) {
        const before = window.__hud.composites();
        if (damage > 0) window.__combat.damage(damage);
        return new Promise((done) => {
          requestAnimationFrame(() => {
            const live = combat();
            done({
              composites: { before, after: window.__hud.composites() },
              drawn: window.__hud.drawn(),
              live: {
                health: live.health,
                weapon: live.weapon,
                ammo: live.ammo[live.weapon],
                score: live.score,
                keys: { ...window.__diag.interaction.keys },
              },
            });
          });
        });
      },

      /** Waits out `seconds` of wall clock with the trigger up. */
      async rest(seconds) {
        const until = performance.now() + seconds * 1000;
        while (performance.now() < until) await frame();
        return { muzzleFlash: combat().muzzleFlash, shots: combat().shotsFired };
      },

      /**
       * Stands the camera in front of one guard after another and fires, until
       * one dies. `006`'s orbit seam moves the *camera* and never the player,
       * which is exactly the arrangement US4-S8 describes: the ray leaves the
       * camera centre, so aiming the camera is aiming the shot, and where the
       * view-model happens to be drawn has nothing to do with it.
       *
       * Bearings are swept in short bursts rather than held, because a bearing
       * whose camera lands inside a wall spends ammo on the wall.
       */
      async killOne(guards, burstFrames, holdFrames) {
        const startHits = combat().hits;
        const startKills = combat().kills;
        const aim = (guard, step) => window.__enemySprites.orbit(guard, step, { radius: 1.8 });

        try {
          for (let guard = 0; guard < guards; guard += 1) {
            for (let step = 0; step < 8; step += 1) {
              const hitsBefore = combat().hits;
              hold();
              for (let seen = 0; seen < burstFrames; seen += 1) {
                aim(guard, step);
                await frame();
                if (combat().kills > startKills) {
                  release();
                  return { hits: combat().hits - startHits, kills: combat().kills - startKills };
                }
              }
              // This bearing sees the guard: stay on it rather than sweeping past.
              if (combat().hits > hitsBefore) {
                for (let seen = 0; seen < holdFrames; seen += 1) {
                  aim(guard, step);
                  await frame();
                  if (combat().kills > startKills) break;
                }
              }
              release();
              if (combat().kills > startKills) break;
            }
            if (combat().kills > startKills) break;
          }
        } finally {
          release();
          window.__enemySprites.release();
        }
        return { hits: combat().hits - startHits, kills: combat().kills - startKills };
      },

      /**
       * Walks health down the declared band ladder, reading the portrait index
       * the HUD actually composited at each rung. Each reading carries the health
       * it was taken at, so the caller compares the index against the band that
       * health falls in rather than against the band it was aimed at -- the
       * guards are firing throughout, and a shot landing between the damage and
       * the read would otherwise fail a correct HUD.
       */
      async walkBands(targets) {
        const readings = [];
        for (const target of targets) {
          const health = combat().health;
          if (health > target) window.__combat.damage(health - target);
          await frame();
          const shown = window.__hud.drawn();
          readings.push({
            target,
            health: combat().health,
            index: shown == null ? null : shown.portraitIndex,
            shownHealth: shown == null ? null : shown.health,
            dead: combat().dead,
          });
          if (combat().dead) break;
        }
        return readings;
      },

      /** The scripted walk, in the shape the locked-door pass established. */
      walkTo(targetX, targetZ) {
        for (let step = 0; step < 400; step += 1) {
          const fromX = window.__diag.player.x;
          const fromZ = window.__diag.player.z;
          const distance = Math.hypot(targetX - fromX, targetZ - fromZ);
          if (distance < 0.05) break;
          window.__playerDrive(
            (4 * (targetX - fromX)) / distance,
            (4 * (targetZ - fromZ)) / distance,
            50,
          );
          if (Math.hypot(window.__diag.player.x - fromX, window.__diag.player.z - fromZ) < 1e-4) {
            break;
          }
        }
        return { x: window.__diag.player.x, z: window.__diag.player.z };
      },

      interact() {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      },
    };
  });
}

export const select = (page, kind, cap = 120) =>
  page.evaluate(
    ([code, wanted, frameCap]) => window.__smokeLoop.select(code, wanted, frameCap),
    [WEAPON_SELECT_CODES[kind], kind, cap],
  );

export const fireOnce = (page, cap = 900, settleFrames = 3) =>
  page.evaluate(([frameCap, settle]) => window.__smokeLoop.fireOnce(frameCap, settle), [cap, settleFrames]);

export const holdWithoutFiring = (page, count) =>
  page.evaluate((n) => window.__smokeLoop.holdWithoutFiring(n), count);

export const rest = (page, seconds) => page.evaluate((s) => window.__smokeLoop.rest(s), seconds);

export const killOne = (page, guards, burstFrames = 5, holdFrames = 120) =>
  page.evaluate(
    ([count, burst, hold]) => window.__smokeLoop.killOne(count, burst, hold),
    [guards, burstFrames, holdFrames],
  );

export const hudWithinOneFrame = (page, damage = 0) =>
  page.evaluate((amount) => window.__smokeLoop.hudWithinOneFrame(amount), damage);

export const walkBands = (page, targets) =>
  page.evaluate((rungs) => window.__smokeLoop.walkBands(rungs), targets);

/** The declared health bands, read from the module that declares them. */
export function readHealthBands(root) {
  const block = readFileSync(resolve(root, 'src/hud/portrait.ts'), 'utf8').match(
    /HEALTH_BANDS[^=]*=\s*\[([\s\S]*?)\n\];/,
  );
  if (block == null) return null;
  return [...block[1].matchAll(/\{\s*index:\s*(\d+),\s*minHealth:\s*([\d.]+)/g)].map((match) => ({
    index: Number(match[1]),
    minHealth: Number(match[2]),
  }));
}

/** The index the declared ladder gives a health reading, recomputed here rather
 *  than taken from the page (US4-S4). */
export function declaredPortraitIndex(bands, health) {
  for (const band of bands) {
    if (health >= band.minHealth) return band.index;
  }
  return bands.length;
}

export const walkTo = (page, x, z) =>
  page.evaluate(([tx, tz]) => window.__smokeLoop.walkTo(tx, tz), [x, z]);

export const interact = (page) => page.evaluate(() => window.__smokeLoop.interact());
