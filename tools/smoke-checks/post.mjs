// T048 (FR-015, FR-017, FR-018; US4-S3, US4-S5, US4-S6, US4-S9, US4-S10, SC-006, SC-007),
// discovered by `tools/smoke-check-runner.mjs`, so `tools/smoke.mjs` stays untouched. A post
// chain's characteristic failure is invisible to every other gate — a black screen compiles,
// throws nothing and reports a healthy frame rate — so nothing here is asserted from `__diag`
// alone: the toggles go through the *declared keys*, bloom is measured in pixels off the
// composited page, and the cost is driven for two full 120-frame windows.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

export const name = 'post';

/** Read from the source, so "the defaults are declared in one place" is asserted against that
 *  place (US4-S1). */
function declaredEffects(root) {
  const source = readFileSync(resolve(root, 'src/post/state.ts'), 'utf8');
  const ids = source.match(/export const POST_EFFECT_IDS = \[([\s\S]*?)\] as const;/);
  const table = source.matchAll(/id: '(\w+)', enabledByDefault: (true|false), keyCode: '(\w+)'/g);
  return {
    ids: ids == null ? null : [...ids[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    declared: [...table].map(([, id, on, keyCode]) => ({ id, on: on === 'true', keyCode })),
  };
}

const readPost = (page) =>
  page.evaluate(() => ({
    post: window.__diag.post == null ? null : JSON.parse(JSON.stringify(window.__diag.post)),
    ready: window.__diag.ready === true,
    fps: window.__diag.fps,
    drawCalls: window.__diag.drawCalls,
    errors: [...window.__diag.errors],
    hud: window.__hud?.drawn() ?? null,
  }));

/** "A frame still renders", proven by the page producing them rather than a field read twice. */
const frames = (page, count) =>
  page.evaluate((n) => new Promise((done) => {
    let seen = 0;
    const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), count);

const key = (page, type, code) =>
  page.evaluate(([kind, at]) =>
    window.dispatchEvent(new KeyboardEvent(kind, { code: at, bubbles: true })), [type, code]);

const tap = async (page, code) => {
  await key(page, 'keydown', code);
  await key(page, 'keyup', code);
};

/** The composited page, measured; the screenshot is decoded by the browser that produced it,
 *  so no image decoder enters the repository (Constitution I, II). */
async function luminance(page, clip) {
  const shot = await page.screenshot({ clip });
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return sum / (data.length / 4);
  }, `data:image/png;base64,${shot.toString('base64')}`);
}

/** The muzzle at rest, projected: the chaingun's flash sits at about (790, 440) in the
 *  harness's 1280x720 view at 001's 60-degree fov, and the HUD's own strip is the bottom 160
 *  rows, which the chain must composite over rather than through (US4-S10). */
const FLASH_CLIP = { x: 680, y: 340, width: 220, height: 200 };
const HUD_CLIP = { x: 380, y: 660, width: 520, height: 56 };

/** Fires the chaingun and answers the brightest frame around the muzzle plus the same region
 *  unlit, so a bloom claim is a difference rather than a level. */
async function flashLuminance(page, bloomOn) {
  await page.evaluate((on) => {
    window.__post.setAll(false);
    window.__post.set('bloom', on);
  }, bloomOn);
  // A restart puts the magazine back, so both passes fire with the same ammunition.
  await tap(page, 'KeyR');
  await frames(page, 20);
  await tap(page, 'Digit3');
  await frames(page, 25);

  await key(page, 'keydown', 'ControlLeft');
  await frames(page, 5);
  let lit = 0;
  for (let sample = 0; sample < 4; sample += 1) lit = Math.max(lit, await luminance(page, FLASH_CLIP));
  await key(page, 'keyup', 'ControlLeft');
  await frames(page, 25);
  const dark = await luminance(page, FLASH_CLIP);
  const ammo = await page.evaluate(() => window.__diag.combat.ammo.chaingun);
  return { lit, dark, ammo };
}

export default async function check({ page, root }) {
  const failures = [];
  const need = (held, message) => {
    if (!held) failures.push(message);
  };
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const first = await readPost(page);
  if (first.post == null) return ['__diag.post was never published — the post system did not run'];
  const excused = (state, id) => state.fallbacks.some((line) => line.startsWith(`${id}:`));
  const intact = (state, when) => {
    need(state.ready, `__diag.ready went false ${when}`);
    need(state.errors.length === 0, `__diag.errors after ${when}: ${state.errors}`);
  };

  // --- US4-S1: exactly four effects, with the defaults their one declared place holds.
  const { ids, declared } = declaredEffects(root);
  need(ids != null && declared.length > 0, 'could not read the effect table from src/post/state.ts');
  const listed = Object.keys(first.post.effects).sort().join(',');
  need(ids == null || listed === [...ids].sort().join(','), `effects lists ${listed}, not ${ids}`);
  for (const { id, on } of declared) {
    need(typeof first.post.effects[id] === 'boolean', `effects.${id} is not a boolean`);
    need(first.post.defaults[id] === on, `defaults.${id} is not the declared ${on}`);
    const expected = on && !excused(first.post, id);
    need(first.post.effects[id] === expected,
      `${id} reads ${first.post.effects[id]} on the first frame, expected ${expected}`);
  }
  need(Array.isArray(first.post.fallbacks), '__diag.post.fallbacks is not an array');
  intact(first, 'load');

  // --- US4-S2, US4-S3: eight toggles, one effect at a time, through the declared keys. Each
  // effect is pressed twice, so it is switched and switched back and the page is left on its
  // declared defaults.
  for (const { id, keyCode } of declared) {
    const supported = !excused(first.post, id);
    for (const press of [1, 2]) {
      const before = (await readPost(page)).post.effects;
      await tap(page, keyCode); // The binding, not a harness method (FR-014).
      await frames(page, 4);
      const after = await readPost(page);

      // An effect the backend refused stays off however often it is asked for; every other one
      // flips, and says so.
      const expected = supported ? !before[id] : false;
      need(after.post.effects[id] === expected,
        `press ${press} of ${keyCode} left ${id} at ${after.post.effects[id]}, want ${expected}`);
      for (const other of declared) {
        need(other.id === id || after.post.effects[other.id] === before[other.id],
          `toggling ${id} also moved ${other.id}`);
      }
      need(after.fps > 0, `the render loop stopped after toggling ${id}`);
      intact(after, `toggling ${id}`);
    }
    const now = (await readPost(page)).post.effects[id];
    need(now === first.post.effects[id], `${id} did not return to its default after two presses`);
  }

  // --- US4-S9: a resize reaches every render target within one frame, and nothing breaks.
  const beforeResize = await readPost(page);
  await page.setViewportSize({ width: 1024, height: 640 });
  await frames(page, 2);
  const resized = await readPost(page);
  const sized = resized.post.viewport;
  need(resized.post.resizes > beforeResize.post.resizes, 'a resize did not reach the chain');
  need(!resized.post.active || (sized.width === 1024 && sized.height === 640),
    `targets are ${sized.width}x${sized.height} one frame after a resize to 1024x640`);
  intact(resized, 'a resize');
  await page.setViewportSize({ width: 1280, height: 720 });
  await frames(page, 3);

  // --- Edge Cases / T045: a hundred on-off cycles leave the target count where it started.
  const [baseline, cycled] = await page.evaluate(() => {
    window.__post.setAll(false);
    const before = window.__post.renderTargets();
    for (let cycle = 0; cycle < 100; cycle += 1) {
      window.__post.setAll(true);
      window.__post.setAll(false);
    }
    return [before, window.__post.renderTargets()];
  });
  need(cycled === baseline, `100 on/off cycles left ${cycled} render targets, baseline ${baseline}`);
  await frames(page, 5);
  intact(await readPost(page), '100 toggle cycles');

  // --- US4-S5 then US4-S4: the baseline window, then the enabled one, then the cost.
  await page.evaluate(() => window.__post.setAll(false));
  await frames(page, 140);
  const off = await readPost(page);
  need(off.fps > SMOKE_FPS_FLOOR,
    `all four disabled: fps ${off.fps.toFixed(1)} below 001's floor ${SMOKE_FPS_FLOOR}`);
  need(!off.post.active, 'the chain is still active with all four effects disabled');
  need(off.post.renderTargets === 0, `${off.post.renderTargets} targets survive with all four off`);
  need(off.post.costSamples.disabled >= 120,
    `only ${off.post.costSamples.disabled} baseline frames sampled, expected 120`);

  await page.evaluate(() => window.__post.setAll(true));
  await frames(page, 140);
  const on = await readPost(page);
  need(Number.isFinite(on.post.frameCostMs),
    `frameCostMs is ${JSON.stringify(on.post.frameCostMs)}, expected a number`);
  need(on.post.costSamples.enabled >= 120 && on.post.costSamples.disabled >= 120,
    'frameCostMs was reported without both 120-frame windows being measured');
  intact(on, 'enabling all four');
  // An effect quietly declining is the failure this whole check exists for.
  for (const { id } of declared) {
    need(on.post.effects[id] || excused(on.post, id),
      `${id} is off with all four asked for and records no fallback`);
  }

  // --- US4-S10: the budget stays observable, and the HUD composites above the chain.
  need(on.drawCalls > 0, `__diag.drawCalls is ${JSON.stringify(on.drawCalls)} with the chain on`);
  need(on.post.drawCalls >= on.drawCalls,
    `post.drawCalls ${on.post.drawCalls} is below the scene's own ${on.drawCalls}`);
  need(on.hud != null, 'the HUD stopped compositing with all four effects enabled');
  const hudWith = await luminance(page, HUD_CLIP);
  await page.evaluate(() => window.__post.setAll(false));
  await frames(page, 5);
  const hudWithout = await luminance(page, HUD_CLIP);
  // Drawn over the chain, not through it, so its pixels are the same either way; grain alone
  // would move them if it were not.
  need(Math.abs(hudWith - hudWithout) <= 0.5,
    `the HUD reads ${hudWith.toFixed(2)} with the effects and ${hudWithout.toFixed(2)} without ` +
      '— it is rendered through the chain, not above it');

  // --- US4-S6: bloom reaches the muzzle flash. Constructed is not applied.
  const plain = await flashLuminance(page, false);
  const bloomed = await flashLuminance(page, true);
  need(plain.ammo > 0 && bloomed.ammo > 0, 'the chaingun ran dry before the flash was measured');
  need(plain.lit > plain.dark, 'no muzzle flash was measured: the lit region is no brighter');
  need(bloomed.lit > plain.lit,
    `the flash reads ${bloomed.lit.toFixed(2)} with bloom, ${plain.lit.toFixed(2)} without ` +
      '— bloom was constructed, not applied');
  // And it is the *flash* bloom found, not a uniformly brighter frame.
  need(bloomed.lit - bloomed.dark > plain.lit - plain.dark,
    "bloom did not increase the flash's excess over the same region unlit");

  // --- FR-018: nothing in the post path reached the console.
  const fromPost = consoleErrors.filter((text) =>
    /post|bloom|ssao|occlusion|motion ?blur|grain|composer|shader|framebuffer|render ?target/i.test(text));
  need(fromPost.length === 0, `console errors from the post path: ${fromPost.join('; ')}`);

  return failures;
}
