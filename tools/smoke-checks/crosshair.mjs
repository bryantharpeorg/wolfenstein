// The crosshair smoke check (T007; FR-003, FR-004, FR-005, FR-006; US1-S3,
// US1-S4, US1-S6, US1-S7), discovered by `tools/smoke-check-runner.mjs`, so
// `tools/smoke.mjs` stays untouched. Created by US1 because US1 is the story
// that spends the draw call; US4 extends this file.
//
// A reticle's characteristic failures are invisible to every other gate — a
// quad nobody added to the camera compiles, throws nothing and shows a healthy
// frame rate — so the claims below are read off the page: the diagnostics the
// system publishes, the harness it installed, and the draw-call budget the
// reticle spends one unit of, measured with the crosshair, HUD, view-model,
// muzzle flash and post chain all rendering at once.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'crosshair';

/** Read from the module declaring it, so "the published object carries every
 *  field the diag file declares" is asserted against that place (US1-S6). */
function declaredFields(root) {
  const source = readFileSync(resolve(root, 'src/hud/crosshair-diag.ts'), 'utf8');
  const match = source.match(/export const CROSSHAIR_DIAGNOSTIC_FIELDS = \[([\s\S]*?)\] as const/);
  if (match == null) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((field) => field[1]);
}

/** The declared gap derivation, read from its two declared places: the resting
 *  gap is the weapon's own spread scaled (FR-007) — not a second tuning table. */
function declaredGap(root) {
  const constants = readFileSync(resolve(root, 'src/hud/crosshair-constants.ts'), 'utf8');
  const weapons = readFileSync(resolve(root, 'src/combat/weapons.ts'), 'utf8');
  const scale = constants.match(/CROSSHAIR_GAP_SCALE = (\d+(?:\.\d+)?)/);
  const weapon = weapons.match(/pistol:\s*\{[^}]*maxSpreadRadians: (\d+(?:\.\d+)?)/);
  if (scale == null || weapon == null) return null;
  return Number(scale[1]) * Number(weapon[1]);
}

/** The declared stroke colour, parsed so the tolerance the pixel comparison
 *  below allows is derived from the reticle's own alpha rather than guessed:
 *  a rendered stroke pixel is `alpha * colour + (1 - alpha) * background`, so
 *  the most a background change alone can move it is `(1 - alpha) * 255` per
 *  channel — anything beyond that came from the chain touching the reticle. */
function declaredColour(root) {
  const source = readFileSync(resolve(root, 'src/hud/crosshair-constants.ts'), 'utf8');
  const match = source.match(/CROSSHAIR_COLOUR = 'rgba\((\d+), (\d+), (\d+), (\d+(?:\.\d+)?)\)'/);
  if (match == null) return null;
  return {
    red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha: Number(match[4]),
  };
}

/** Read from the module declaring it, so "the reticle composites at or above
 *  the order the chain keys overlays on" is asserted against that place. */
function declaredHudRenderOrder(root) {
  const source = readFileSync(resolve(root, 'src/systems/hud/register.ts'), 'utf8');
  const match = source.match(/HUD_RENDER_ORDER = (\d+)/);
  return match == null ? null : Number(match[1]);
}

const readCrosshair = (page) =>
  page.evaluate(() => ({
    crosshair: window.__diag.crosshair == null
      ? null
      : JSON.parse(JSON.stringify(window.__diag.crosshair)),
    ready: window.__diag.ready === true,
    drawCalls: window.__diag.drawCalls,
    errors: [...window.__diag.errors],
    harness: typeof window.__crosshair === 'object' && window.__crosshair != null,
    hud: window.__hud?.drawn() ?? null,
  }));

/** "A frame still renders", proven by the page producing them. */
const frames = (page, count) =>
  page.evaluate((n) => new Promise((done) => {
    let seen = 0;
    const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), count);

/** Waits on the thing actually being waited for. */
const until = (page, predicate, argument) =>
  page.waitForFunction(predicate, argument, { timeout: 30000 });

/** The highest `__diag.drawCalls` the page reports over a window of frames, so
 *  a claim about the budget is made against the busiest frame in the window
 *  rather than whichever frame the read landed on. */
const peakDrawCalls = (page, count) =>
  page.evaluate((n) => new Promise((done) => {
    let seen = 0;
    let peak = 0;
    const tick = () => {
      peak = Math.max(peak, window.__diag.drawCalls);
      seen += 1;
      if (seen >= n) return done(peak);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);

/** The rendered pixels of a 48×48 clip centred on (cx, cy), decoded in the
 *  page from the compositor's own screenshot output — what is compared is what
 *  the player is shown, not the texture the quad holds. */
const CLIP_HALF_PX = 24;
const clipPixels = async (page, cx, cy) => {
  const buffer = await page.screenshot({
    clip: { x: cx - CLIP_HALF_PX, y: cy - CLIP_HALF_PX, width: CLIP_HALF_PX * 2, height: CLIP_HALF_PX * 2 },
  });
  const decoded = await page.evaluate(async (data) => {
    const response = await fetch(`data:image/png;base64,${data}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
  }, buffer.toString('base64'));
  return { pixels: decoded, size: CLIP_HALF_PX * 2 };
};

/** Stroke candidates in one arm's window: pixels the reticle's own alpha floor
 *  proves are the stroke's — a full-coverage pixel of a colour drawn at alpha
 *  `a` composites to at least `a * channel` whatever is behind it. Antialiased
 *  edges fall below the floor and are not judged. */
function armStrokePixels(pixels, size, dx, dy, gapPx, armPx, floor) {
  const found = [];
  const centre = size / 2;
  const from = gapPx - 1;
  const to = gapPx + armPx + 1;
  for (let along = Math.floor(from); along <= Math.ceil(to); along += 1) {
    for (let across = -3; across <= 3; across += 1) {
      const x = Math.round(centre + dx * along + (dx === 0 ? across : 0));
      const y = Math.round(centre + dy * along + (dy === 0 ? across : 0));
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const index = (y * size + x) * 4;
      if (pixels[index] >= floor && pixels[index + 1] >= floor
        && pixels[index + 2] >= floor) found.push(index);
    }
  }
  return found;
}

export default async function check({ page, root }) {
  const failures = [];
  const need = (held, message) => {
    if (!held) failures.push(message);
  };

  const first = await readCrosshair(page);
  if (first.crosshair == null) {
    return ['__diag.crosshair was never published — the crosshair system did not run'];
  }
  if (first.harness !== true) {
    return ['window.__crosshair is missing: the crosshair system did not install its seam'];
  }

  // --- US1-S6: the published object carries every declared field.
  const fields = declaredFields(root);
  need(fields != null && fields.length > 0, 'could not read CROSSHAIR_DIAGNOSTIC_FIELDS from src/hud/crosshair-diag.ts');
  if (fields != null) {
    for (const field of fields) {
      need(Object.prototype.hasOwnProperty.call(first.crosshair, field),
        `__diag.crosshair is missing the declared field ${field}`);
    }
  }

  // --- US1-S3: the reticle is on screen, centred, and not the HUD bar's quad.
  need(first.crosshair.hidden === false, `the reticle reads hidden=${first.crosshair.hidden} at rest`);
  need(first.crosshair.armLengthPx > 0, `armLengthPx reads ${first.crosshair.armLengthPx}, expected declared arms`);
  const centre = await page.evaluate(() => window.__crosshair.centre());
  const uuids = await page.evaluate(() => ({
    own: window.__crosshair.uuid(),
    overlays: window.__crosshair.overlayUuids(),
  }));
  need(uuids.own !== '', 'the crosshair quad has no identity — there is no quad');
  need(uuids.overlays.length >= 1,
    'no other overlay quad was found on the camera — the HUD bar is not compositing beside the reticle');
  need(!uuids.overlays.includes(uuids.own),
    'the crosshair quad is the same object as an overlay quad it must be distinct from');
  const centredAt = { width: 1280, height: 720 };
  need(Math.abs(centre.x - centredAt.width / 2) <= 1 && Math.abs(centre.y - centredAt.height / 2) <= 1,
    `the reticle is centred at (${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}), ` +
      `expected (${centredAt.width / 2}, ${centredAt.height / 2})`);

  // --- US1-S6: the gap is derived, not authored — the page agrees with the two
  // declared places the derivation reads.
  const expectedGap = declaredGap(root);
  need(expectedGap != null, 'could not read the declared gap derivation from its sources');
  need(expectedGap != null && Math.abs(first.crosshair.gap - expectedGap) < 1e-9,
    `the resting gap reads ${first.crosshair.gap}, expected the declared ${expectedGap}`);
  need(first.crosshair.sourcesDefined === true,
    'sourcesDefined reads false — the reticle is drawing from sources it does not name');

  // --- US1-S4: a different aspect ratio recentres the reticle and leaves its
  // arms the same length in pixels — it scales with the viewport, not with it.
  const spanBefore = await page.evaluate(() => window.__crosshair.span());
  await page.setViewportSize({ width: 1024, height: 640 });
  await frames(page, 2);
  const resized = await readCrosshair(page);
  const centreAfter = await page.evaluate(() => window.__crosshair.centre());
  const spanAfter = await page.evaluate(() => window.__crosshair.span());
  need(Math.abs(centreAfter.x - 512) <= 1 && Math.abs(centreAfter.y - 320) <= 1,
    `after a resize to 1024x640 the reticle is centred at (${centreAfter.x.toFixed(1)}, ` +
      `${centreAfter.y.toFixed(1)}), expected (512, 320)`);
  need(spanBefore === spanAfter && spanBefore > 0,
    `the reticle's span moved from ${spanBefore} to ${spanAfter} across a resize — ` +
      'its arms stretched with the viewport instead of keeping their pixel length');
  need(resized.crosshair.hidden === false, 'the reticle hid itself across a resize');
  need(resized.errors.length === 0, `__diag.errors after the resize: ${resized.errors}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await frames(page, 2);

  // --- US1-S7 / FR-006: the budget holds with everything rendering at once.
  // Every post effect on puts the chain to work; firing keeps the muzzle flash,
  // the view-model and the HUD readouts live while it samples. The run is
  // restarted first, because the guards fire throughout and a sample taken from
  // a corpse reads no shots, lights no flash and measures a budget nobody spent.
  await page.evaluate(() => window.__post?.setAll(true));
  await until(page, () => window.__diag.post?.active === true);
  await frames(page, 5);
  const restarts = await page.evaluate(() => window.__diag.combat.restarts);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true })));
  await until(page, (was) => window.__diag.combat.restarts > was
    && window.__diag.run != null && window.__diag.run.state === 'playing', restarts);
  const busy = await page.evaluate(() => {
    const before = window.__diag.combat.shotsFired;
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    return new Promise((done) => {
      let peak = 0;
      let seen = 0;
      const tick = () => {
        peak = Math.max(peak, window.__diag.drawCalls);
        seen += 1;
        if (seen >= 40) {
          window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
          return done({
            peak,
            fired: window.__diag.combat.shotsFired > before,
            hud: window.__hud?.drawn() != null,
            post: window.__diag.post?.active === true,
            crosshair: window.__diag.crosshair?.hidden === false,
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  need(busy.post, 'the post chain never became active, so the budget was measured without it');
  need(busy.fired, 'no shot resolved while the budget was being measured — the muzzle flash never rendered');
  need(busy.hud, 'the HUD stopped compositing while the budget was measured');
  need(busy.crosshair, 'the reticle hid itself while the budget was measured');
  need(busy.peak > 0, `__diag.drawCalls read ${JSON.stringify(busy.peak)} with everything rendering`);
  need(busy.peak < 20,
    `__diag.drawCalls peaked at ${busy.peak} with the crosshair, HUD, view-model, muzzle flash ` +
      'and post chain all rendering — the budget is 20 (US1-S7)');
  console.log(`  crosshair: gap ${first.crosshair.gap}, arms ${first.crosshair.armLengthPx}px, ` +
    `centre (${centre.x.toFixed(0)}, ${centre.y.toFixed(0)}); drawCalls peak ${busy.peak} with all effects on`);

  // --- US1-S5 / FR-004: the reticle is composited over 008's post chain, not
  // through it. Judged on the rendered pixels the player is shown: a stroke
  // pixel is `alpha * colour + (1 - alpha) * background`, so no background
  // change alone can move it by more than `(1 - alpha) * 255` per channel —
  // while bloom, blur or a colour grade applied to the reticle itself would
  // move it far more. The composited frame is also required to differ between
  // the two states, so a chain that changed nothing cannot pass vacuously.
  const hudOrder = declaredHudRenderOrder(root);
  need(hudOrder != null, 'could not read HUD_RENDER_ORDER from src/systems/hud/register.ts');
  need(hudOrder != null && first.crosshair.renderOrder >= hudOrder,
    `the reticle composites at renderOrder ${first.crosshair.renderOrder}, below the ` +
      `HUD_RENDER_ORDER ${hudOrder} the chain keys overlays on`);
  const colour = declaredColour(root);
  need(colour != null, 'could not read CROSSHAIR_COLOUR from src/hud/crosshair-constants.ts');
  const tolerance = colour == null ? 0 : Math.ceil((1 - colour.alpha) * 255);
  const alphaFloor = colour == null ? 0 : Math.floor(colour.alpha * Math.min(colour.red, colour.green, colour.blue));

  const centreNow = await page.evaluate(() => window.__crosshair.centre());
  await page.evaluate(() => window.__post?.setAll(false));
  await until(page, () => window.__diag.post?.active === false);
  await frames(page, 3);
  const off = await clipPixels(page, centreNow.x, centreNow.y);
  const frameOff = await page.screenshot();
  await page.evaluate(() => window.__post?.setAll(true));
  await until(page, () => window.__diag.post?.active === true);
  await frames(page, 3);
  const on = await clipPixels(page, centreNow.x, centreNow.y);
  const frameOn = await page.screenshot();
  need(!frameOff.equals(frameOn),
    'the composited frame is byte-identical with the chain on and off — the post chain did ' +
      'nothing the comparison below could have seen, so it would pass vacuously');

  const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of arms) {
    const candidates = armStrokePixels(off.pixels, off.size, dx, dy,
      first.crosshair.gap, first.crosshair.armLengthPx, alphaFloor);
    need(candidates.length >= 4,
      `no rendered stroke was found along the (${dx}, ${dy}) arm — ${candidates.length} pixels ` +
        `at or above the declared colour's alpha floor of ${alphaFloor}`);
    const stable = candidates.filter((index) =>
      Math.abs(on.pixels[index] - off.pixels[index]) <= tolerance
      && Math.abs(on.pixels[index + 1] - off.pixels[index + 1]) <= tolerance
      && Math.abs(on.pixels[index + 2] - off.pixels[index + 2]) <= tolerance);
    need(stable.length / candidates.length >= 0.8,
      `${candidates.length - stable.length} of ${candidates.length} stroke pixels along the ` +
        `(${dx}, ${dy}) arm moved by more than ${tolerance} per channel when the post chain was ` +
        'enabled — the chain bloomed, blurred or colour-graded the reticle instead of ' +
        'compositing it over its effects');
  }
  console.log(`  crosshair: stroke pixels stable over the post chain within ±${tolerance} ` +
    'per channel, with the chain visibly altering the frame around them');

  // --- Put the page back the way it was found: the effects off, nothing held.
  await page.evaluate(() => window.__post?.setAll(false));
  await frames(page, 3);

  return failures;
}