// The run smoke check (T023; FR-007, FR-008, US2-S1..S8), discovered by `tools/smoke.mjs`.
// A completed run exists only inside the render loop, so Constitution III verifies it here:
// the level is driven from spawn to the elevator and every statistic the screen displays is
// compared field for field against the counter that owns it. The displayed values come from
// `window.__run.lines()` because a texture cannot be read back as text; the route is walked
// twice because a counter that reset with the run fails only US2-S8.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The exit tile 002 ships, and 004's door travel with room to spare, inside its dwell. */
const EXIT_TILE = { x: 55, z: 55 };
const DOOR_OPEN_WAIT_MS = 1200;

export const name = 'run';

/** Spends `count` frames, or `ms` of *frame* time: a door opens on 004's elapsed-time
 *  interpolation, so only frames spent turn a press into a doorway. */
const spend = (page, { count = 0, ms = 0 }) =>
  page.evaluate(([frames, span]) =>
    new Promise((done) => {
      let seen = 0;
      const started = performance.now();
      const tick = () =>
        (++seen >= frames && performance.now() - started >= span ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }), [count, ms]);

/** Waits for a reading; the assertion that follows reports what was actually read. */
async function settle(page, predicate, timeout = 10000, arg = undefined) {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch {
    /* reported by the assertion that follows */
  }
}

/** Drives the player through a list of tile centres, as the locked-door pass in
 *  `tools/smoke.mjs` does. `__playerDrive` integrates synchronously, so a leg passes no
 *  frames and the guards take no tick during one. */
const walkLegs = (page, legs) =>
  page.evaluate((list) => {
    for (const [targetX, targetZ] of list) {
      for (let step = 0; step < 600; step += 1) {
        const fromX = window.__diag.player.x;
        const fromZ = window.__diag.player.z;
        const distance = Math.hypot(targetX - fromX, targetZ - fromZ);
        if (distance < 0.05) break;
        window.__playerDrive((4 * (targetX - fromX)) / distance, (4 * (targetZ - fromZ)) / distance, 50);
        if (Math.hypot(window.__diag.player.x - fromX, window.__diag.player.z - fromZ) < 1e-4) break;
      }
    }
    return { x: window.__diag.player.x, z: window.__diag.player.z };
  }, legs);

/** 004's one interact command, as the key that issues it. */
const press = (page) =>
  page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })));

/** Everything the figures are compared against, read in one turn so no frame lands between
 *  the source counters and the object reporting them. */
const readAll = (page) =>
  page.evaluate(() => {
    const diag = window.__diag;
    const { kills, score, treasureFound, treasureTotal } = diag.combat;
    const { secretsFound, secretsTotal } = diag.interaction;
    return {
      run: { ...diag.run },
      combat: { kills, score, treasureFound, treasureTotal },
      interaction: { secretsFound, secretsTotal },
      guardsTotal: diag.enemies.length,
      lines: window.__run.lines(),
      screenVisible: window.__run.visible(),
    };
  });

/**
 * Drives one run to `complete`, returning what went wrong — empty on a run that finished.
 * The route is 002's layout: the only way from the north-west room to the south-east one
 * runs through the unlocked door at (10,21), the opening at (21,31), the silver-locked door
 * at (42,31) — hence the silver key at (30,30) first — and the opening at (52,42). Every
 * wait is bounded and every failure names its leg.
 */
async function driveToExit(page, label) {
  const errors = [];
  const stop = (message) => {
    errors.push(`${label}: ${message}`);
    return errors;
  };
  const walk = async (legs, what) => {
    const [x, z] = legs[legs.length - 1];
    const at = await walkLegs(page, legs);
    if (Math.abs(at.x - x) < 1.2 && Math.abs(at.z - z) < 1.2) return null;
    return stop(`the walk to ${what} ended at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`);
  };

  // Leg 1: south to the unlocked door in the north wall, and open it.
  await walkLegs(page, [[10.5, 20.5]]);
  await press(page);
  await settle(page, () => window.__diag.interaction.doorsOpen >= 1);
  if (!(await page.evaluate(() => window.__diag.interaction.doorsOpen >= 1))) {
    return stop('the door at (10,21) did not open');
  }
  await spend(page, { ms: DOOR_OPEN_WAIT_MS });

  // Leg 2: through it, east along the opening at (21,31), to the silver key.
  if (await walk([[10.5, 22.5], [10.5, 31.5], [30.5, 31.5], [30.5, 30.5]], 'the silver key')) return errors;
  await settle(page, () => window.__diag.interaction.keys.silver === 1, 4000);
  if ((await page.evaluate(() => window.__diag.interaction.keys.silver)) !== 1) {
    return stop('the silver key was not collected on its tile');
  }

  // Leg 3: the silver-locked door at (42,31), opened with the key it named.
  if (await walk([[30.5, 31.5], [41.5, 31.5]], 'the locked door')) return errors;
  await press(page);
  await settle(page, () => window.__diag.interaction.lastReason === 'opened');
  const reason = await page.evaluate(() => window.__diag.interaction.lastReason);
  if (reason !== 'opened') return stop(`the locked door did not open with its key (lastReason=${reason})`);
  await spend(page, { ms: DOOR_OPEN_WAIT_MS });

  // Leg 4: east, south through the opening at (52,42), onto the health pickup at (50,50).
  // Frames are spent standing on it, since a pickup is collected by the pickups system's
  // `update()` reading the player's position and a leg passes no frames.
  if (await walk([[43.5, 31.5], [52.5, 31.5], [52.5, 43.5], [50.5, 50.5]], 'the south-east room')) return errors;
  await spend(page, { count: 4 });

  // The treasure beside the lift: the score printed needs a source that moved.
  const before = await page.evaluate(() => window.__diag.combat.treasureFound);
  if (await walk([[54.5, 54.5]], 'the treasure at (54,54)')) return errors;
  await settle(page, (had) => window.__diag.combat.treasureFound > had, 4000, before);
  const after = await page.evaluate(() => window.__diag.combat.treasureFound);
  if (after <= before) return stop(`the treasure at (54,54) was not collected (treasureFound=${after})`);

  if (await walk([[EXIT_TILE.x + 0.5, EXIT_TILE.z + 0.5]], `the exit at (${EXIT_TILE.x},${EXIT_TILE.z})`)) {
    return errors;
  }
  if (await page.evaluate(() => window.__diag.combat.dead)) {
    return stop('the guards ended the run before it reached the lift');
  }

  // The press, the travel, the arrival. `exiting` on the way through: a run that reached
  // `complete` without it never rode the lift.
  await press(page);
  await settle(page, () => window.__diag.run.state !== 'playing', 4000);
  const riding = await page.evaluate(() => window.__diag.run.state);
  if (riding !== 'exiting' && riding !== 'complete') {
    return stop(`the interact command at the exit left the run '${riding}', not 'exiting'`);
  }
  await settle(page, () => window.__diag.run.state === 'complete', 15000);
  const arrived = await page.evaluate(() => window.__diag.run.state);
  if (arrived !== 'complete') stop(`__diag.run.state is '${arrived}', it never reached 'complete'`);
  return errors;
}

/** The row labels, read from the module that declares them, so the page is checked against
 *  `src/run/stats.ts` and not against this file. */
function readLabels(root) {
  const block = readFileSync(resolve(root, 'src/run/stats.ts'), 'utf8')
    .match(/STATS_LABELS\s*=\s*\{([\s\S]*?)\}\s*as const;/);
  if (block == null) return null;
  const labels = {};
  for (const [, key, value] of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) labels[key] = value;
  return labels;
}

/** FR-008's field set, restated so a missing field names itself. */
const RUN_FIELDS = ['state', 'elapsedMs', 'kills', 'guardsTotal', 'secretsFound',
  'secretsTotal', 'treasureFound', 'treasureTotal', 'score', 'rating', 'completions'];

/** FR-006's pairings: the reported field, and the `__diag` object that owns the counter
 *  it is copied from — the names are the counters' own. */
const SOURCED = [['kills', 'combat'], ['secretsFound', 'interaction'], ['secretsTotal', 'interaction'],
  ['treasureFound', 'combat'], ['treasureTotal', 'combat'], ['score', 'combat']];

export default async function check({ page, root }) {
  const errors = [];
  const claim = (ok, message) => {
    if (!ok) errors.push(message);
  };

  const LABEL = readLabels(root);
  if (LABEL == null) return ['could not read STATS_LABELS from src/run/stats.ts'];

  const ready = await page.evaluate(() =>
    window.__diag?.run != null && window.__diag.combat != null && window.__diag.interaction != null &&
    typeof window.__playerDrive === 'function' && typeof window.__run === 'object');
  if (!ready) return ['window.__diag.run / window.__run did not appear: US2 published no run slice'];

  await spend(page, { count: 3 });

  // US2-S7: the contract, before anything is driven.
  const spawn = await readAll(page);
  for (const field of RUN_FIELDS) {
    claim(Object.prototype.hasOwnProperty.call(spawn.run, field), `__diag.run is missing FR-008's '${field}'`);
  }
  claim(spawn.run.state === 'playing', `__diag.run.state is '${spawn.run.state}' at spawn, not 'playing'`);
  claim(spawn.run.completions === 0, `__diag.run.completions is ${spawn.run.completions} at spawn, not 0`);
  claim(!spawn.screenVisible, 'the stats screen is drawn on a run that has not completed');
  claim(spawn.lines === null, 'the stats screen composited lines before the run completed');

  errors.push(...(await driveToExit(page, 'first run')));
  if (errors.length > 0) return errors;

  // --- US2-S1, US2-S2: what the screen shows against what the counters say. ---
  const done = await readAll(page);
  claim(done.screenVisible, 'the run is complete but the stats screen is not drawn');
  claim(Array.isArray(done.lines) && done.lines.length === 6,
    `the stats screen composited ${done.lines?.length} lines, expected 6`);

  const shown = new Map((done.lines ?? []).map((line) => [line.label, line.value]));
  const displays = (label, expected, exact = false) =>
    claim(exact ? shown.get(label) === expected : shown.get(label)?.startsWith(expected),
      `the stats screen shows ${label} as '${shown.get(label)}', not '${expected}'`);

  // FR-006: every displayed value equals the counter that owns it. The screen prints
  // "found/total  pct%", so the ratio is compared here, the percentage in the unit test.
  claim(/^\d+:\d\d$/.test(shown.get(LABEL.time) ?? ''),
    `the stats screen shows ${LABEL.time} as '${shown.get(LABEL.time)}', not minutes and seconds`);
  displays(LABEL.kills, `${done.combat.kills}/${done.guardsTotal}`);
  displays(LABEL.secrets, `${done.interaction.secretsFound}/${done.interaction.secretsTotal}`);
  displays(LABEL.treasure, `${done.combat.treasureFound}/${done.combat.treasureTotal}`);
  displays(LABEL.score, `${done.combat.score}`, true);
  displays(LABEL.rating, done.run.rating, true);

  // FR-006 again, on the reported half: `__diag.run` is the same read as the screen.
  for (const [field, owner] of SOURCED) {
    claim(done.run[field] === done[owner][field],
      `__diag.run.${field} ${done.run[field]} != __diag.${owner}.${field} ${done[owner][field]}`);
  }
  claim(done.run.guardsTotal === done.guardsTotal,
    `__diag.run.guardsTotal ${done.run.guardsTotal} != the ${done.guardsTotal} guards on the roster`);

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
  await spend(page, { count: 4 });
  claim((await page.evaluate(() => window.__runSentinel)) === 'kept',
    'the page reloaded on restart from the stats screen: the sentinel did not survive');

  // 007's own judgement of its own reset, through the seam that exports it, so "exactly
  // 007's reset" is not restated here in other words (FR-007).
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
  claim(offending == null || offending.length === 0,
    `the restart left the run differing from spawn at: ${(offending ?? []).join(', ')}`);

  const restarted = await readAll(page);
  claim(restarted.run.state === 'playing', `__diag.run.state is '${restarted.run.state}' after a restart`);
  claim(restarted.run.elapsedMs < firstElapsed,
    `the run timer did not restart: ${firstElapsed} -> ${restarted.run.elapsedMs}`);
  claim(restarted.run.completions === 1,
    `__diag.run.completions is ${restarted.run.completions} after the restart, expected 1 to survive`);
  claim(!restarted.screenVisible, 'the stats screen is still drawn after a restart');
  claim(restarted.run.score === 0, `the restart left __diag.run.score at ${restarted.run.score}`);
  claim(restarted.run.treasureFound === 0,
    `the restart left __diag.run.treasureFound at ${restarted.run.treasureFound}`);
  if (errors.length > 0) return errors;

  // --- US2-S8: a second completion reads 2, every other field the second run's. ---
  errors.push(...(await driveToExit(page, 'second run')));
  if (errors.length > 0) return errors;

  const second = await readAll(page);
  claim(second.run.completions === 2,
    `__diag.run.completions is ${second.run.completions} after a second completed run, not 2`);
  for (const [field, owner] of SOURCED) {
    claim(second.run[field] === second[owner][field],
      `__diag.run.${field} ${second.run[field]} != __diag.${owner}.${field} on the second run`);
    // Accumulating is what US2-S8 forbids: the route collects the same treasure each time,
    // so a counter that added the two runs would read double.
    claim(second.run[field] === done.run[field],
      `__diag.run.${field} accumulated across runs: ${done.run[field]} -> ${second.run[field]}`);
  }

  const finalErrors = await page.evaluate(() => window.__diag.errors);
  claim(finalErrors.length === 0, `__diag.errors: ${finalErrors.join(' | ')}`);
  return errors;
}
