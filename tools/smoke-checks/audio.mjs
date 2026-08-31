// The audio smoke check (T036; FR-012, FR-018, US3-S5, US3-S6, SC-004, SC-005),
// discovered by `tools/smoke-check-runner.mjs`. Adding this file leaves
// `tools/smoke.mjs` untouched.
//
// This is the least self-reporting surface in the project: a WebAudio graph that
// produces silence throws nothing, logs nothing and passes every other gate. The
// gate runs in headless Chromium with no user gesture and possibly no audio
// device, so "a sound played" is unassertable by construction — what is assertable
// is that the context exists, that it is *suspended* before any gesture, that the
// declared inventory was actually synthesized, and that nothing in the audio path
// wrote to the console or to `__diag.errors`.
//
// Every expected value is read from the module that declares it, so this check
// asserts the page agrees with the source rather than with a number retyped here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'audio';

/** The sound ids `src/audio/sound-table.ts` declares, read from the source. */
function declaredSoundIds(root) {
  const source = readFileSync(resolve(root, 'src/audio/sound-table.ts'), 'utf8');
  const block = source.match(/export const SOUND_IDS = \[([\s\S]*?)\] as const;/);
  if (block == null) return null;
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** The declared voice cap, read from `src/audio/voice-pool.ts`. */
function declaredCap(root) {
  const source = readFileSync(resolve(root, 'src/audio/voice-pool.ts'), 'utf8');
  const match = source.match(/export const MAX_VOICES = (\d+);/);
  return match == null ? null : Number(match[1]);
}

const spendFrames = (page, count) =>
  page.evaluate((frames) =>
    new Promise((done) => {
      let seen = 0;
      const tick = () => (++seen >= frames ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }), count);

/** One reading of everything a trigger claim is made against, in one turn so no
 *  frame lands between the resolved counter and the voice it should have made. */
const readTriggers = (page) =>
  page.evaluate(() => ({
    started: window.__diag.audio.voicesStarted,
    voices: window.__diag.audio.voices,
    shots: window.__diag.combat.shotsFired,
    reason: window.__diag.interaction.lastReason,
    x: window.__diag.player.x,
    z: window.__diag.player.z,
  }));

const key = (page, code, type) =>
  page.evaluate(([eventType, eventCode]) =>
    window.dispatchEvent(new KeyboardEvent(eventType, { code: eventCode, bubbles: true })),
  [type, code]);

const readAudio = (page) =>
  page.evaluate(() => ({
    audio: window.__diag.audio == null ? null : { ...window.__diag.audio },
    errors: [...window.__diag.errors],
    ready: window.__diag.ready === true,
    fps: window.__diag.fps,
  }));

/**
 * The three resolved events, driven and compared against `voicesStarted` — the
 * only runtime fact that tells "this event made a sound" apart from "this event
 * was refused", which a suspended graph reports identically.
 */
async function checkResolvedTriggers(page) {
  const failures = [];

  // A shot the gate resolves: one gunfire voice per counted shot, and none for
  // the frames in between. The player is standing still, so nothing else plays.
  const beforeFire = await readTriggers(page);
  await key(page, 'ControlLeft', 'keydown');
  await spendFrames(page, 8);
  await key(page, 'ControlLeft', 'keyup');
  await spendFrames(page, 6);
  const afterFire = await readTriggers(page);

  const shots = afterFire.shots - beforeFire.shots;
  const fireVoices = afterFire.started - beforeFire.started;
  if (shots < 1) failures.push('the fire command resolved no shot, so the gunfire claim is untested');
  else if (fireVoices !== shots) {
    failures.push(`${shots} resolved shots started ${fireVoices} voices, expected one each`);
  }

  // A command that resolved to a refusal: the elevator and the doors both answer
  // a press away from anything interactable, and neither moved (FR-011, US3-S4).
  const beforeUse = await readTriggers(page);
  await key(page, 'Space', 'keydown');
  await spendFrames(page, 8);
  const afterUse = await readTriggers(page);
  if (afterUse.reason === 'opened' || afterUse.reason === 'exit-used') {
    failures.push(`the refusal probe resolved as "${afterUse.reason}"; it must press away from anything usable`);
  } else if (afterUse.started !== beforeUse.started) {
    failures.push(
      `a press resolved as "${afterUse.reason}" started ${afterUse.started - beforeUse.started} voices, expected silence`,
    );
  }

  // A measured cadence: distance actually travelled, which the walk key produces
  // and a player pressed into a wall does not.
  const beforeWalk = await readTriggers(page);
  await key(page, 'KeyW', 'keydown');
  await spendFrames(page, 40);
  await key(page, 'KeyW', 'keyup');
  await spendFrames(page, 6);
  const afterWalk = await readTriggers(page);
  const travelled = Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z);
  if (travelled <= 0) {
    failures.push('the walk probe travelled nowhere, so the footstep claim is untested');
  } else if (afterWalk.started <= beforeWalk.started) {
    failures.push(`walking ${travelled.toFixed(2)} units started no footstep voice`);
  }

  return failures;
}

export default async function check({ page, root }) {
  const failures = [];

  // Console output is captured from here on; the page has already loaded, and the
  // load path is covered by the runner's own `pageerror` listener.
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  // Read BEFORE anything is dispatched: US3-S5 is a claim about the state with no
  // user gesture yet, so the reading has to happen before this check makes one.
  const before = await readAudio(page);
  if (before.audio == null) {
    return ['__diag.audio was never published — the audio system did not run'];
  }

  const audio = before.audio;

  // US3-S5: created suspended, and startup completed normally around it. A context
  // that could not be constructed at all is the declared fallback, not a failure —
  // but only if it said so, which is the whole point of `fallbacks`.
  if (audio.contextState === 'unavailable') {
    if (audio.fallbacks.length === 0) {
      failures.push('contextState is "unavailable" with no fallbacks entry explaining it');
    }
  } else if (audio.contextState !== 'suspended') {
    failures.push(`contextState is "${audio.contextState}" before any gesture, expected "suspended"`);
  }
  if (audio.gestured !== false) failures.push('__diag.audio.gestured is true before any gesture');
  if (audio.droneRunning !== false) failures.push('the drone is running before any gesture');
  if (audio.voices !== 0) failures.push(`${audio.voices} voices are live before any gesture`);
  if (!before.ready) failures.push('startup did not complete: __diag.ready is false');

  // US3-S9 / FR-013: an omission is a fallbacks line, never an errors entry.
  const audioErrors = before.errors.filter((entry) => /audio|sound|voice|drone/i.test(entry));
  if (audioErrors.length > 0) {
    failures.push(`__diag.errors carries audio-path entries: ${audioErrors.join('; ')}`);
  }

  // SC-004: the inventory is what the table declares, and it is at least six.
  const declared = declaredSoundIds(root);
  if (declared == null) {
    failures.push('could not read SOUND_IDS from src/audio/sound-table.ts');
  } else {
    if (declared.length < 6) {
      failures.push(`the source declares only ${declared.length} sounds; FR-010 requires at least six`);
    }
    const missing = declared.filter((id) => !audio.sounds.includes(id));
    if (missing.length > 0) {
      // Silent by declaration is allowed; silent without a fallbacks line is not.
      const unexplained = missing.filter(
        (id) => !audio.fallbacks.some((entry) => entry.startsWith(`${id}:`)),
      );
      if (unexplained.length > 0) {
        failures.push(`synthesized nothing for ${unexplained.join(', ')} and recorded no fallback`);
      }
    }
    if (audio.contextState !== 'unavailable' && audio.sounds.length < 6) {
      failures.push(`the page lists ${audio.sounds.length} synthesized sounds, expected at least six`);
    }
    for (const id of audio.sounds) {
      if (!declared.includes(id)) failures.push(`the page lists an undeclared sound: ${id}`);
    }
  }

  const cap = declaredCap(root);
  if (cap == null) failures.push('could not read MAX_VOICES from src/audio/voice-pool.ts');
  else if (audio.voiceCap !== cap) {
    failures.push(`__diag.audio.voiceCap is ${audio.voiceCap}, the source declares ${cap}`);
  }

  // US3-S6: a gesture arrives and the browser refuses to resume it — which is
  // exactly what a synthetic event in a headless browser produces. The game must
  // stay playable and silent, with no uncaught exception and no errors entry.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await spendFrames(page, 30);

  const after = await readAudio(page);
  if (after.audio == null) {
    failures.push('__diag.audio disappeared after the first gesture');
  } else {
    if (after.audio.gestured !== true) failures.push('a gesture was not recorded by the audio system');
    if (after.audio.voices > after.audio.voiceCap) {
      failures.push(`${after.audio.voices} live voices exceeds the declared cap of ${after.audio.voiceCap}`);
    }
    if (!(after.audio.masterCeiling > 0) || after.audio.masterCeiling > 1) {
      failures.push(`the declared master ceiling is ${after.audio.masterCeiling}, expected a gain in (0, 1]`);
    }
  }
  if (after.errors.length > before.errors.length) {
    failures.push(`the gesture added ${after.errors.length - before.errors.length} entries to __diag.errors`);
  }
  if (!(after.fps > 0)) failures.push('the render loop stopped: __diag.fps is not positive');

  // FR-011 / US3-S4, at runtime. Only meaningful once the context is actually
  // running: a browser that refused the gesture is a silent, playable game and
  // this whole block would be asserting that silence is silent (FR-012).
  if (after.audio != null && after.audio.contextState === 'running') {
    failures.push(...(await checkResolvedTriggers(page)));
  }

  // FR-018: nothing in the audio path writes an error to the console. Chromium's
  // own autoplay *warning* is a warning, not an error, and is not caught here.
  const fromAudio = consoleErrors.filter((text) => /audio|sound|voice|drone|gain|oscillat/i.test(text));
  if (fromAudio.length > 0) {
    failures.push(`console errors from the audio path: ${fromAudio.join('; ')}`);
  }

  return failures;
}
