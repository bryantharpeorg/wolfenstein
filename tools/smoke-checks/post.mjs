// The post-processing smoke check (T048; FR-015, FR-017, FR-018, US4-S3, US4-S5, US4-S6,
// US4-S9, US4-S10, SC-006, SC-007), discovered by `tools/smoke-check-runner.mjs`, so
// `tools/smoke.mjs` stays untouched.
//
// A post chain is the one subsystem in this project whose characteristic failure is
// invisible to every other gate: a black screen compiles, type-checks, throws nothing and
// reports a healthy frame rate. So nothing here is asserted from `__diag` alone. The four
// toggles are driven through the *declared keys* rather than through a harness method;
// the bloom assertion is made against pixels read back off the composited page while a
// muzzle flash is lit; the leak assertion counts live render targets across a hundred
// cycles; and the cost is driven for two full 120-frame windows so `frameCostMs` is a
// measurement rather than a field that happens to be a number.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

export const name = 'post';

/** The four effects exactly as `src/post/state.ts` declares them -- read from the source,
 *  so "the defaults are declared in one place" is asserted against that place (US4-S1). */
function declaredEffects(root) {
  const source = readFileSync(resolve(root, 'src/post/state.ts'), 'utf8');
  const ids = source.match(/export const POST_EFFECT_IDS = \[([\s\S]*?)\] as const;/);
  const table = [
    ...source.matchAll(
      /id: '(\w+)',\s*\n\s*enabledByDefault: (true|false),\s*\n\s*keyCode: '(\w+)',/g,
    ),
  ];
  return {
    ids: ids == null ? null : [...ids[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    declared: table.map(([, id, enabled, keyCode]) => ({ id, default: enabled === 'true', keyCode })),
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

/** Waits for `count` animation frames, so "a frame still renders" is proven by the page
 *  producing them rather than by a field being read twice. */
const frames = (page, count) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let seen = 0;
        const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

const key = (page, type, code) =>
  page.evaluate(
    ([eventType, eventCode]) =>
      window.dispatchEvent(new KeyboardEvent(eventType, { code: eventCode, bubbles: true })),
    [type, code],
  );

/** The composited page, measured. A screenshot is decoded by the browser that produced it,
 *  so no image decoder enters the repository for one assertion (Constitution I, II). */
async function luminance(page, clip) {
  const shot = await page.screenshot({ clip });
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;
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
  }, dataUrl);
}

/** Where the muzzle flash lands with the view-model at rest, found by diffing a firing
 *  frame against an idle one across the viewport. */
const FLASH_CLIP = { x: 620, y: 340, width: 360, height: 280 };
/** The HUD readout's own strip, which the chain must not touch (US4-S10). */
const HUD_CLIP = { x: 380, y: 660, width: 520, height: 56 };

/** Fires the chaingun and answers the brightest frame around the muzzle, plus the same
 *  region once the flash is out, so a bloom claim is a difference rather than a level. */
async function flashLuminance(page, bloomOn) {
  await page.evaluate((on) => {
    window.__post.setAll(false);
    window.__post.set('bloom', on);
  }, bloomOn);
  // A restart puts the magazine back, so the second pass fires with the ammunition the
  // first one did rather than with what it left behind.
  await key(page, 'keydown', 'KeyR');
  await key(page, 'keyup', 'KeyR');
  await frames(page, 20);
  await key(page, 'keydown', 'Digit3');
  await key(page, 'keyup', 'Digit3');
  await frames(page, 25);

  await key(page, 'keydown', 'ControlLeft');
  await frames(page, 5);
  let lit = 0;
  for (let sample = 0; sample < 4; sample += 1) {
    lit = Math.max(lit, await luminance(page, FLASH_CLIP));
  }
  await key(page, 'keyup', 'ControlLeft');
  await frames(page, 25);
  const dark = await luminance(page, FLASH_CLIP);
  const ammo = await page.evaluate(() => window.__diag.combat.ammo.chaingun);
  return { lit, dark, ammo };
}

export default async function check({ page, root }) {
  const failures = [];
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const first = await readPost(page);
  if (first.post == null) {
    return ['__diag.post was never published — the post system did not run'];
  }

  // --- US4-S1: exactly four effects, with the defaults their one declared place holds.
  const { ids, declared } = declaredEffects(root);
  if (ids == null || declared.length === 0) {
    failures.push('could not read POST_EFFECT_IDS / POST_EFFECTS from src/post/state.ts');
  } else {
    const published = Object.keys(first.post.effects);
    if (published.sort().join(',') !== [...ids].sort().join(',')) {
      failures.push(`__diag.post.effects lists ${published.join(',')}, the source declares ${ids.join(',')}`);
    }
    for (const effect of declared) {
      if (typeof first.post.effects[effect.id] !== 'boolean') {
        failures.push(`__diag.post.effects.${effect.id} is not a boolean`);
      }
      if (first.post.defaults[effect.id] !== effect.default) {
        failures.push(
          `__diag.post.defaults.${effect.id} is ${first.post.defaults[effect.id]}, the source declares ${effect.default}`,
        );
      }
      if (first.post.bindings[effect.id] !== effect.keyCode) {
        failures.push(
          `__diag.post.bindings.${effect.id} is ${first.post.bindings[effect.id]}, the source declares ${effect.keyCode}`,
        );
      }
      // A default that is on but reads off is only allowed if the chain said why.
      const expected =
        effect.default && !first.post.fallbacks.some((line) => line.startsWith(`${effect.id}:`));
      if (first.post.effects[effect.id] !== expected) {
        failures.push(
          `${effect.id} reads ${first.post.effects[effect.id]} on the first frame, expected ${expected}`,
        );
      }
    }
  }
  if (!Array.isArray(first.post.fallbacks)) failures.push('__diag.post.fallbacks is not an array');
  if (first.errors.length > 0) failures.push(`__diag.errors is not empty at load: ${first.errors.join('; ')}`);

  // --- US4-S2, US4-S3: eight toggles, one effect at a time, through the declared keys.
  // Every effect is pressed twice, so each is genuinely switched and switched back and the
  // page is left on its declared defaults.
  for (const effect of declared) {
    const supported = !first.post.fallbacks.some((line) => line.startsWith(`${effect.id}:`));
    for (const press of [1, 2]) {
      const before = (await readPost(page)).post.effects;
      // The binding, not a harness method: FR-014 asks for a *declared* toggle.
      await key(page, 'keydown', effect.keyCode);
      await key(page, 'keyup', effect.keyCode);
      await frames(page, 4);
      const after = await readPost(page);

      // An effect the backend refused stays off however often it is asked for; every
      // other one flips, and says so.
      const expected = supported ? !before[effect.id] : false;
      if (after.post.effects[effect.id] !== expected) {
        failures.push(
          `press ${press} of ${effect.keyCode} left ${effect.id} at ${after.post.effects[effect.id]}, expected ${expected}`,
        );
      }
      for (const other of declared) {
        if (other.id === effect.id) continue;
        if (after.post.effects[other.id] !== before[other.id]) {
          failures.push(`toggling ${effect.id} also moved ${other.id}`);
        }
      }
      if (!after.ready) failures.push(`__diag.ready went false after toggling ${effect.id}`);
      if (!(after.fps > 0)) failures.push(`the render loop stopped after toggling ${effect.id}`);
      if (after.errors.length > 0) {
        failures.push(`toggling ${effect.id} added to __diag.errors: ${after.errors.join('; ')}`);
      }
    }
    const restored = (await readPost(page)).post.effects[effect.id];
    if (restored !== first.post.effects[effect.id]) {
      failures.push(`${effect.id} did not return to its declared default after two presses`);
    }
  }

  // --- US4-S9: a resize reaches every render target within one frame, and nothing breaks.
  const beforeResize = await readPost(page);
  await page.setViewportSize({ width: 1024, height: 640 });
  await frames(page, 2);
  const resized = await readPost(page);
  if (resized.post.resizes <= beforeResize.post.resizes) {
    failures.push('a viewport change did not reach the post chain');
  }
  if (resized.post.active && (resized.post.viewport.width !== 1024 || resized.post.viewport.height !== 640)) {
    failures.push(
      `render targets are ${resized.post.viewport.width}x${resized.post.viewport.height} one frame after a resize to 1024x640`,
    );
  }
  if (!resized.ready || resized.errors.length > 0) {
    failures.push(`a resize left ready=${resized.ready} errors=${resized.errors.join('; ')}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await frames(page, 3);

  // --- Edge Cases / T045: a hundred on-off cycles leave the target count where it started.
  const baselineTargets = await page.evaluate(() => {
    window.__post.setAll(false);
    return window.__post.renderTargets();
  });
  const cycled = await page.evaluate(() => {
    for (let cycle = 0; cycle < 100; cycle += 1) {
      window.__post.setAll(true);
      window.__post.setAll(false);
    }
    return window.__post.renderTargets();
  });
  if (cycled !== baselineTargets) {
    failures.push(`100 on/off cycles left ${cycled} render targets against a baseline of ${baselineTargets}`);
  }
  await frames(page, 5);
  const afterCycles = await readPost(page);
  if (!afterCycles.ready || afterCycles.errors.length > 0) {
    failures.push(`100 toggle cycles left ready=${afterCycles.ready} errors=${afterCycles.errors.join('; ')}`);
  }

  // --- US4-S5 and US4-S4: the baseline window, then the enabled one, then the cost.
  await page.evaluate(() => window.__post.setAll(false));
  await frames(page, 140);
  const disabled = await readPost(page);
  if (!(disabled.fps > SMOKE_FPS_FLOOR)) {
    failures.push(
      `with all four effects disabled fps ${disabled.fps.toFixed(1)} did not exceed 001's floor ${SMOKE_FPS_FLOOR}`,
    );
  }
  if (disabled.post.active) failures.push('the chain is still active with all four effects disabled');
  if (disabled.post.renderTargets !== 0) {
    failures.push(`${disabled.post.renderTargets} render targets survive with all four effects disabled`);
  }
  if (disabled.post.costSamples.disabled < 120) {
    failures.push(`only ${disabled.post.costSamples.disabled} baseline frames were sampled, expected 120`);
  }

  await page.evaluate(() => window.__post.setAll(true));
  await frames(page, 140);
  const enabled = await readPost(page);
  if (typeof enabled.post.frameCostMs !== 'number' || !Number.isFinite(enabled.post.frameCostMs)) {
    failures.push(`__diag.post.frameCostMs is ${JSON.stringify(enabled.post.frameCostMs)} with all four enabled, expected a number`);
  }
  if (typeof enabled.post.baselineFrameMs !== 'number' || typeof enabled.post.enabledFrameMs !== 'number') {
    failures.push('frameCostMs was reported without both windows being measured');
  }
  if (!enabled.ready || enabled.errors.length > 0) {
    failures.push(`all four enabled left ready=${enabled.ready} errors=${enabled.errors.join('; ')}`);
  }
  // Every effect that is not in `fallbacks` must actually be on when all four are asked
  // for -- an effect quietly declining is the failure this whole check exists for.
  for (const effect of declared) {
    const excused = enabled.post.fallbacks.some((line) => line.startsWith(`${effect.id}:`));
    if (!enabled.post.effects[effect.id] && !excused) {
      failures.push(`${effect.id} is off with all four asked for and records no fallback`);
    }
  }

  // --- US4-S10: the budget stays observable, and the HUD is composited above the chain.
  if (typeof enabled.drawCalls !== 'number' || !(enabled.drawCalls > 0)) {
    failures.push(`__diag.drawCalls is ${JSON.stringify(enabled.drawCalls)} with the chain active`);
  }
  if (!(enabled.post.drawCalls >= enabled.drawCalls)) {
    failures.push(
      `__diag.post.drawCalls ${enabled.post.drawCalls} is below the scene's own ${enabled.drawCalls}`,
    );
  }
  if (enabled.hud == null) failures.push('the HUD stopped compositing with all four effects enabled');
  const hudWithEffects = await luminance(page, HUD_CLIP);
  await page.evaluate(() => window.__post.setAll(false));
  await frames(page, 5);
  const hudWithout = await luminance(page, HUD_CLIP);
  // The readout is drawn over the chain, not through it, so its own pixels are the same
  // whether the chain ran or not. Grain alone would move them if it were not.
  if (Math.abs(hudWithEffects - hudWithout) > 0.5) {
    failures.push(
      `the HUD strip reads ${hudWithEffects.toFixed(2)} with the effects on and ${hudWithout.toFixed(2)} with them off — it is being rendered through the chain, not above it`,
    );
  }

  // --- US4-S6: bloom reaches the muzzle flash. Constructed is not applied.
  const withoutBloom = await flashLuminance(page, false);
  const withBloom = await flashLuminance(page, true);
  if (withoutBloom.ammo <= 0 || withBloom.ammo <= 0) {
    failures.push('the chaingun ran dry before the flash was measured — the reading is not a flash');
  }
  if (!(withoutBloom.lit > withoutBloom.dark)) {
    failures.push('no muzzle flash was measured at all: the lit region is no brighter than the idle one');
  }
  if (!(withBloom.lit > withoutBloom.lit)) {
    failures.push(
      `the flash region reads ${withBloom.lit.toFixed(2)} with bloom and ${withoutBloom.lit.toFixed(2)} without it — bloom was constructed, not applied`,
    );
  }
  // And it is the *flash* bloom found, not a uniformly brighter frame.
  if (!(withBloom.lit - withBloom.dark > withoutBloom.lit - withoutBloom.dark)) {
    failures.push('bloom did not increase the flash\'s excess over the same region unlit');
  }

  // --- FR-018: nothing in the post path reached the console.
  const fromPost = consoleErrors.filter((text) =>
    /post|bloom|ssao|occlusion|motion ?blur|grain|composer|shader|framebuffer|render ?target/i.test(text),
  );
  if (fromPost.length > 0) failures.push(`console errors from the post path: ${fromPost.join('; ')}`);

  return failures;
}
