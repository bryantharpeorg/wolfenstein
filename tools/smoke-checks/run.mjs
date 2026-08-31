// The run smoke check (T023; FR-007, FR-008, US2-S1, US2-S2, US2-S6, US2-S7, US2-S8).
// A completed run exists only inside the render loop, so Constitution III verifies it
// here: the level is driven from spawn to the elevator, `__diag.run` is asserted to
// reach `complete`, and every statistic the stats screen displays is compared field for
// field against the counter that owns it. Adding `tools/smoke-checks/<name>.mjs` leaves
// the discovery hook in `tools/smoke.mjs` to find it.
//
// Two things make this a real check rather than a re-read of one object.
//
// The displayed values are read from `window.__run.lines()` — the strings the canvas was
// composited from — and compared against `__diag.combat` and `__diag.interaction`
// directly. A texture cannot be read back as text, so without that seam "the screen
// shows what the counters say" would be asserted by reading `__diag.run` twice.
//
// The route is walked twice. `completions` reaching 2 is the whole of US2-S8, and it is
// the only claim in this spec that a single completed run cannot make: a counter that
// reset with the run, or that counted a frame rather than an arrival, passes every
// one-run assertion above and fails here.
//
// The route itself, and the page-side helpers that walk it, are in
// `tools/smoke-run-route.mjs`: this file is the assertions, that one is the driving.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { driveToExit, frames, installDriver, readAll } from '../smoke-run-route.mjs';

export const name = 'run';

/** The row labels, read from the module that declares them rather than restated here,
 *  so this check asserts the page agrees with `src/run/stats.ts` and not with itself
 *  (the shape `pickups.mjs` and `vitals.mjs` established). */
function readLabels(root) {
  const block = readFileSync(resolve(root, 'src/run/stats.ts'), 'utf8')
    .match(/STATS_LABELS\s*=\s*\{([\s\S]*?)\}\s*as const;/);
  if (block == null) return null;
  const labels = {};
  for (const [, key, value] of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) labels[key] = value;
  return labels;
}

/** FR-008's field set, restated here so a missing field names itself. */
const RUN_FIELDS = [
  'state', 'elapsedMs', 'kills', 'guardsTotal', 'secretsFound', 'secretsTotal',
  'treasureFound', 'treasureTotal', 'score', 'rating', 'completions',
];

export default async function check({ page, root }) {
  const errors = [];
  const claim = (ok, message) => {
    if (!ok) errors.push(message);
  };

  const LABEL = readLabels(root);
  if (LABEL == null) return ['could not read STATS_LABELS from src/run/stats.ts'];

  const ready = await page.evaluate(
    () =>
      window.__diag?.run != null &&
      window.__diag.combat != null &&
      window.__diag.interaction != null &&
      typeof window.__playerDrive === 'function' &&
      typeof window.__run === 'object',
  );
  if (!ready) return ['window.__diag.run / window.__run did not appear: US2 published no run slice'];

  await installDriver(page);
  await frames(page, 3);

  // US2-S7: the contract, before anything is driven. A field missing at spawn is
  // missing at completion too, and this reads better than an undefined comparison below.
  const spawn = await readAll(page);
  for (const field of RUN_FIELDS) {
    claim(
      Object.prototype.hasOwnProperty.call(spawn.run, field),
      `__diag.run is missing the FR-008 field '${field}'`,
    );
  }
  claim(spawn.run.state === 'playing', `__diag.run.state is '${spawn.run.state}' at spawn, not 'playing'`);
  claim(spawn.run.completions === 0, `__diag.run.completions is ${spawn.run.completions} at spawn, not 0`);
  claim(!spawn.screenVisible, 'the stats screen is drawn on a run that has not completed');
  claim(spawn.lines === null, 'the stats screen composited lines before the run completed');

  errors.push(...(await driveToExit(page, 'first run')));
  if (errors.length > 0) return errors;

  // --- US2-S1, US2-S2: what the screen shows, against what the counters say. ---
  const done = await readAll(page);

  claim(done.screenVisible, 'the run is complete but the stats screen is not drawn');
  claim(Array.isArray(done.lines) && done.lines.length === 6,
    `the stats screen composited ${done.lines?.length} lines, expected 6`);

  const shown = new Map((done.lines ?? []).map((line) => [line.label, line.value]));
  const displays = (label, expected) =>
    claim(
      shown.get(label)?.startsWith(expected),
      `the stats screen shows ${label} as '${shown.get(label)}', not '${expected}...'`,
    );

  // FR-006: every displayed value equals the counter that owns it. The screen prints
  // "found/total  pct%", so the ratio is what is compared; the percentage is derived
  // from the same pair and asserted in `run-stats.test.ts`.
  claim(
    /^\d+:\d\d$/.test(shown.get(LABEL.time) ?? ''),
    `the stats screen shows ${LABEL.time} as '${shown.get(LABEL.time)}', not minutes and seconds`,
  );
  displays(LABEL.kills, `${done.combat.kills}/${done.guardsTotal}`);
  displays(LABEL.secrets, `${done.interaction.secretsFound}/${done.interaction.secretsTotal}`);
  displays(LABEL.treasure, `${done.combat.treasureFound}/${done.combat.treasureTotal}`);
  claim(
    shown.get(LABEL.score) === `${done.combat.score}`,
    `the stats screen shows ${LABEL.score} as '${shown.get(LABEL.score)}', not '${done.combat.score}'`,
  );
  claim(
    shown.get(LABEL.rating) === done.run.rating,
    `the stats screen shows ${LABEL.rating} as '${shown.get(LABEL.rating)}', not '${done.run.rating}'`,
  );

  // FR-006 again, on the reported half: `__diag.run` is the same read as the screen.
  claim(done.run.kills === done.combat.kills,
    `__diag.run.kills ${done.run.kills} != __diag.combat.kills ${done.combat.kills}`);
  claim(done.run.secretsFound === done.interaction.secretsFound,
    `__diag.run.secretsFound ${done.run.secretsFound} != __diag.interaction.secretsFound ${done.interaction.secretsFound}`);
  claim(done.run.secretsTotal === done.interaction.secretsTotal,
    `__diag.run.secretsTotal ${done.run.secretsTotal} != __diag.interaction.secretsTotal ${done.interaction.secretsTotal}`);
  claim(done.run.treasureFound === done.combat.treasureFound,
    `__diag.run.treasureFound ${done.run.treasureFound} != __diag.combat.treasureFound ${done.combat.treasureFound}`);
  claim(done.run.treasureTotal === done.combat.treasureTotal,
    `__diag.run.treasureTotal ${done.run.treasureTotal} != __diag.combat.treasureTotal ${done.combat.treasureTotal}`);
  claim(done.run.score === done.combat.score,
    `__diag.run.score ${done.run.score} != __diag.combat.score ${done.combat.score}`);
  claim(done.run.guardsTotal === done.guardsTotal,
    `__diag.run.guardsTotal ${done.run.guardsTotal} != the ${done.guardsTotal} guards on the roster`);

  // The run was actually played, not reported from zeroes: the route walks over a
  // treasure, so the score the screen prints has a source that moved.
  claim(done.run.treasureFound > 0, 'the scripted run collected no treasure, so no counter it reports moved');
  claim(done.run.score > 0, `__diag.run.score is ${done.run.score} after collecting treasure`);
  claim(done.run.elapsedMs > 0, `__diag.run.elapsedMs is ${done.run.elapsedMs} on a completed run`);
  claim(done.run.completions === 1, `__diag.run.completions is ${done.run.completions} after one completed run`);

  // US2-S3: no denominator on the screen produced a NaN, whatever the level offers.
  const text = (done.lines ?? []).map((line) => `${line.label} ${line.value}`).join(' ');
  claim(!/NaN|Infinity|undefined/.test(text), `the stats screen shows '${text}'`);

  // --- US2-S6: restart from the stats screen is 007's reset, field for field. ---
  const firstElapsed = done.run.elapsedMs;
  await page.evaluate(() => {
    window.__runSentinel = 'kept';
    window.__run.restart();
  });
  await frames(page, 4);

  claim(
    (await page.evaluate(() => window.__runSentinel)) === 'kept',
    'the page reloaded on restart from the stats screen: the sentinel did not survive',
  );

  // 007's own judgement of its own reset, read through the seam that exports it, so
  // "exactly 007's reset" is not restated here in different words (FR-007).
  const offending = await page.evaluate(() => {
    const first = window.__combat.firstFrame();
    const after = window.__combat.restartFrame();
    if (first == null || after == null) return null;
    const exempt = new Set(window.__combat.exempt());
    return [...new Set([...Object.keys(first), ...Object.keys(after)])]
      .filter((field) => !exempt.has(field) && !Object.is(first[field], after[field]))
      .sort();
  });
  claim(offending != null, 'the page captured no spawn or post-restart snapshot');
  claim(
    offending == null || offending.length === 0,
    `the restart from the stats screen left the run differing from spawn at: ${(offending ?? []).join(', ')}`,
  );

  const restarted = await readAll(page);
  claim(restarted.run.state === 'playing', `__diag.run.state is '${restarted.run.state}' after a restart`);
  claim(
    restarted.run.elapsedMs < firstElapsed,
    `the run timer did not restart: ${firstElapsed} -> ${restarted.run.elapsedMs}`,
  );
  claim(restarted.run.completions === 1,
    `__diag.run.completions is ${restarted.run.completions} after the restart, expected it to survive as 1`);
  claim(!restarted.screenVisible, 'the stats screen is still drawn after a restart');
  claim(restarted.run.score === 0, `the restart left __diag.run.score at ${restarted.run.score}`);
  claim(restarted.run.treasureFound === 0,
    `the restart left __diag.run.treasureFound at ${restarted.run.treasureFound}`);
  if (errors.length > 0) return errors;

  // --- US2-S8: a second completion reads 2, and every other field is the second run's. ---
  errors.push(...(await driveToExit(page, 'second run')));
  if (errors.length > 0) return errors;

  const second = await readAll(page);
  claim(second.run.completions === 2,
    `__diag.run.completions is ${second.run.completions} after a second completed run, not 2`);
  claim(second.run.score === second.combat.score,
    `__diag.run.score ${second.run.score} != __diag.combat.score ${second.combat.score} on the second run`);
  claim(
    second.run.treasureFound === second.combat.treasureFound,
    `__diag.run.treasureFound ${second.run.treasureFound} != __diag.combat.treasureFound ` +
      `${second.combat.treasureFound} on the second run`,
  );
  // Accumulated across both runs is exactly what US2-S8 forbids: the route collects the
  // same treasure each time, so a counter that added the two would read double.
  claim(
    second.run.treasureFound === done.run.treasureFound,
    `__diag.run.treasureFound accumulated across runs: ${done.run.treasureFound} -> ${second.run.treasureFound}`,
  );
  claim(
    second.run.score === done.run.score,
    `__diag.run.score accumulated across runs: ${done.run.score} -> ${second.run.score}`,
  );

  const finalErrors = await page.evaluate(() => window.__diag.errors);
  claim(finalErrors.length === 0, `__diag.errors: ${finalErrors.join(' | ')}`);

  return errors;
}
