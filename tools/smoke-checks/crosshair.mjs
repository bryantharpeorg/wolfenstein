// The crosshair smoke check (T007; FR-003..FR-006, US1; FR-014..FR-016, US4),
// discovered by `tools/smoke-check-runner.mjs`, so `tools/smoke.mjs` stays
// untouched.
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

/** The declared resting gaps, read from their two declared places: each weapon's
 *  resting gap is that weapon's own spread scaled (FR-007) — not a second tuning
 *  table. All three, so the ordering US4 asserts is asserted against the table. */
function declaredRestingGaps(root) {
  const constants = readFileSync(resolve(root, 'src/hud/crosshair-constants.ts'), 'utf8');
  const weapons = readFileSync(resolve(root, 'src/combat/weapons.ts'), 'utf8');
  const scale = constants.match(/CROSSHAIR_GAP_SCALE = (\d+(?:\.\d+)?)/);
  if (scale == null) return null;
  const gaps = {};
  for (const kind of ['pistol', 'smg', 'chaingun']) {
    const weapon = weapons.match(new RegExp(`${kind}:\\s*\\{[^}]*maxSpreadRadians: (\\d+(?:\\.\\d+)?)`));
    if (weapon == null) return null;
    gaps[kind] = Number(scale[1]) * Number(weapon[1]);
  }
  return gaps;
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
  const restingGaps = declaredRestingGaps(root);
  need(restingGaps != null, 'could not read the declared gap derivation from its sources');
  const expectedGap = restingGaps == null ? null : restingGaps.pistol;
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

  // --- US4 / FR-014..FR-016: one key toggles the reticle, the gap orders across
  // the three weapons and answers movement, and a hidden reticle costs no draw
  // call. A fresh run first, so no claim is made through a run the guards have
  // been shooting through; each gap is waited for, not sampled.
  const restartRun = async () => {
    const was = await page.evaluate(() => window.__diag.combat.restarts);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true })));
    await until(page, (seen) => window.__diag.combat.restarts > seen
      && window.__diag.run != null && window.__diag.run.state === 'playing', was);
  };
  const press = (code) => page.evaluate((c) => window.dispatchEvent(
    new KeyboardEvent('keydown', { code: c, bubbles: true })), code);
  const readGap = () => page.evaluate(() => window.__diag.crosshair?.gap ?? -1);
  const settleTo = async (code, expected) => {
    await press(code);
    await until(page, (want) => Math.abs((window.__diag.crosshair?.gap ?? -1) - want) < 0.25, expected);
    return readGap();
  };
  await restartRun();

  // US4-S6 / FR-016: the resting gaps order pistol < smg < chaingun, each the
  // weapon table's own spread scaled, reached through the digit keys a player
  // presses.
  need(restingGaps != null && restingGaps.pistol < restingGaps.smg
    && restingGaps.smg < restingGaps.chaingun,
    `the declared resting gaps do not order pistol < smg < chaingun: ${JSON.stringify(restingGaps)}`);
  const settled = {};
  for (const [kind, code] of [['pistol', 'Digit1'], ['smg', 'Digit2'], ['chaingun', 'Digit3']]) {
    settled[kind] = restingGaps == null ? -1 : await settleTo(code, restingGaps[kind]);
    need(Math.abs(settled[kind] - (restingGaps?.[kind] ?? NaN)) < 0.25,
      `with ${kind} selected the gap read ${settled[kind]}, never settling onto the declared ` +
        `resting gap ${restingGaps?.[kind]}`);
  }
  need(settled.pistol < settled.smg && settled.smg < settled.chaingun,
    `the gaps the page reported do not order pistol ${settled.pistol} < smg ${settled.smg} < ` +
      `chaingun ${settled.chaingun} — the reticle is not reading the weapon table's spread`);
  await settleTo('Digit1', restingGaps?.pistol ?? 0);

  // US4-S6 / FR-016: the gap opens under movement — holding the forward key sets
  // the speed the locomotion diagnostics report, whatever geometry lies ahead.
  const atRest = await readGap();
  await press('KeyW');
  await frames(page, 12);
  const moving = await page.evaluate(() => ({
    speed: window.__diag.player?.speed ?? 0, gap: window.__diag.crosshair?.gap ?? -1,
  }));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })));
  need(moving.speed > 0, 'holding the forward key read speed 0 — the gap\'s response to movement could not be measured');
  need(moving.gap > atRest + 1,
    `holding the forward key read gap ${moving.gap.toFixed(2)} against a resting ${atRest.toFixed(2)} ` +
      '— the gap did not open with movement');
  need(await until(page, (rest) => Math.abs((window.__diag.crosshair?.gap ?? -1) - rest) < 0.5, atRest),
    `the gap did not return to its resting ${atRest.toFixed(2)} once the player stopped`);

  // US4-S1..S3 / FR-014, FR-015: one key, both directions, and hidden costs no
  // draw call — the peak over the same span of frames in both states.
  const toggleTo = async (wanted, label) => {
    await press('KeyH');
    const held = await until(page, (goal) => window.__diag.crosshair?.hidden === goal, wanted);
    need(held, label);
  };
  await toggleTo(true, 'the declared toggle key did not hide the reticle');
  const hiddenPeak = await peakDrawCalls(page, 40);
  await toggleTo(false, 'the same toggle key did not show the reticle again — one key must serve both directions');
  const shownPeak = await peakDrawCalls(page, 40);
  need(hiddenPeak <= shownPeak,
    `with the reticle hidden drawCalls peaked at ${hiddenPeak}, above the ${shownPeak} measured ` +
      'with it shown — a hidden crosshair must cost no draw call (FR-015)');

  // US4-S4: the preference is not run state — the restart leaves it hidden.
  await toggleTo(true, 'the toggle key did not hide the reticle before the restart');
  await restartRun();
  need(await page.evaluate(() => window.__diag.crosshair?.hidden === true),
    'the reticle came back shown after 007\'s restart — a preference is not run state (US4-S4)');
  await toggleTo(false, 'the toggle key did not bring the reticle back after the restart');
  console.log(`  crosshair: resting gaps ${settled.pistol.toFixed(1)} < ${settled.smg.toFixed(1)} < ` +
    `${settled.chaingun.toFixed(1)} px; gap opened ${(moving.gap - atRest).toFixed(1)} px under ` +
    `movement; drawCalls peak ${hiddenPeak} hidden vs ${shownPeak} shown; hidden survived a restart`);

  // --- Put the page back the way it was found: the effects off, nothing held.
  await page.evaluate(() => window.__post?.setAll(false));
  await frames(page, 3);

  return failures;
}