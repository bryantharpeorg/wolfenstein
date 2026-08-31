// The audio smoke check (T036; FR-012, FR-018, US3-S5, US3-S6), discovered by
// `tools/smoke-check-runner.mjs`, so `tools/smoke.mjs` stays untouched. The gate has no
// user gesture and possibly no audio device, so "a sound played" is unassertable by
// construction; what is assertable is that the context exists and is suspended with
// nothing yet played, that the declared inventory was synthesized, that a gesture the
// browser refuses leaves the game playable and silent, and that nothing in the audio
// path reached the console or `__diag.errors`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'audio';

function declaredSoundIds(root) {
  const source = readFileSync(resolve(root, 'src/audio/sound-table.ts'), 'utf8');
  const block = source.match(/export const SOUND_IDS = \[([\s\S]*?)\] as const;/);
  return block == null ? null : [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const readAudio = (page) =>
  page.evaluate(() => ({
    audio: window.__diag.audio == null ? null : { ...window.__diag.audio },
    errors: [...window.__diag.errors],
    ready: window.__diag.ready === true,
    fps: window.__diag.fps,
  }));

export default async function check({ page, root }) {
  const failures = [];
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  // Read BEFORE anything is dispatched: US3-S5 is a claim about the state with no user
  // gesture yet, so the reading has to happen before this check makes one.
  const before = await readAudio(page);
  if (before.audio == null) return ['__diag.audio was never published — the audio system did not run'];
  const audio = before.audio;

  // US3-S5: created suspended, with startup completed normally around it. A context
  // that could not be constructed at all is the declared fallback rather than a
  // failure — but only if it said so, which is the whole point of `fallbacks`.
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
  if (audio.voicesStarted !== 0) {
    failures.push(`${audio.voicesStarted} voices had already started before any gesture`);
  }
  if (!before.ready) failures.push('startup did not complete: __diag.ready is false');

  const audioErrors = before.errors.filter((entry) => /audio|sound|voice|drone/i.test(entry));
  if (audioErrors.length > 0) {
    failures.push(`__diag.errors carries audio-path entries: ${audioErrors.join('; ')}`);
  }

  const declared = declaredSoundIds(root);
  if (declared == null) failures.push('could not read SOUND_IDS from src/audio/sound-table.ts');
  else {
    if (declared.length < 6) {
      failures.push(`the source declares only ${declared.length} sounds; FR-010 requires at least six`);
    }
    // Silent by declaration is allowed; silent without a fallbacks line is not.
    const unexplained = declared.filter(
      (id) => !audio.sounds.includes(id) && !audio.fallbacks.some((line) => line.startsWith(`${id}:`)),
    );
    if (unexplained.length > 0) {
      failures.push(`synthesized nothing for ${unexplained.join(', ')} and recorded no fallback`);
    }
    if (audio.contextState !== 'unavailable' && audio.sounds.length < 6) {
      failures.push(`the page lists ${audio.sounds.length} synthesized sounds, expected at least six`);
    }
    for (const id of audio.sounds) {
      if (!declared.includes(id)) failures.push(`the page lists an undeclared sound: ${id}`);
    }
  }

  // US3-S6: a gesture arrives and the browser refuses to resume it, which is what a
  // synthetic event in a headless browser produces. The game stays playable and
  // silent, with no uncaught exception and no new errors entry.
  await page.evaluate(() =>
    new Promise((done) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));
      document.dispatchEvent(new Event('visibilitychange'));
      let frames = 0;
      const tick = () => (++frames >= 30 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }));

  const after = await readAudio(page);
  if (after.audio == null) failures.push('__diag.audio disappeared after the first gesture');
  else {
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

  // FR-018: nothing in the audio path writes an error to the console. Chromium's own
  // autoplay *warning* is a warning, and is not caught here.
  const fromAudio = consoleErrors.filter((text) => /audio|sound|voice|drone|gain|oscillat/i.test(text));
  if (fromAudio.length > 0) failures.push(`console errors from the audio path: ${fromAudio.join('; ')}`);

  return failures;
}
