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
// The route itself is 002's layout: the three-by-three rooms are joined by openings and
// doors, and the only way from the north-west room to the south-east one runs through
// the unlocked door at (10,21), the opening at (21,31), the silver-locked door at
// (42,31) — which is why the silver key at (30,30) is collected first — and the opening
// at (52,42). It is walked in as few page turns as possible: `__playerDrive` integrates
// synchronously, so a leg driven inside one `evaluate` passes no frames and the guards
// take no tick during it. The waits, where they do, are the exposure this check has.

export const name = 'run';

/** The exit tile 002 ships. */
const EXIT_TILE = { x: 55, z: 55 };

/** 004's `DOOR_TRAVEL_MS` with room to spare, and comfortably inside its 3000 ms dwell:
 *  long enough that a door pressed is a door you can walk through, short enough that the
 *  same door has not shut again behind the wait. */
const DOOR_OPEN_WAIT_MS = 1200;

const frames = (page, count) =>
  page.evaluate((n) => {
    let seen = 0;
    return new Promise((done) => {
      const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }, count);

/** Waits `ms` of *frame* time. A door reaches its open position on 004's elapsed-time
 *  interpolation, so `lastReason === 'opened'` — which lands on the press — is not yet a
 *  doorway you can walk through, and `doorsOpen` cannot be watched either: the door
 *  behind us may still be counted in it. Waiting out the travel is the honest wait. */
const waitMs = (page, ms) =>
  page.evaluate(
    (span) =>
      new Promise((done) => {
        const started = performance.now();
        const tick = () => (performance.now() - started >= span ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    ms,
  );

/** Waits for a reading without failing on the wait: the assertion that follows reports
 *  what was actually read, which is the more useful message. */
async function settle(page, predicate, timeout = 10000, arg = undefined) {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch {
    /* reported by the assertion that follows */
  }
}

/** The scripted drive and the interact command, installed in the page because they run
 *  there — the same seam the locked-door pass in `tools/smoke.mjs` uses. */
async function installDriver(page) {
  await page.evaluate(() => {
    window.__runWalkTo = (targetX, targetZ) => {
      for (let step = 0; step < 600; step += 1) {
        const fromX = window.__diag.player.x;
        const fromZ = window.__diag.player.z;
        const distance = Math.hypot(targetX - fromX, targetZ - fromZ);
        if (distance < 0.05) break;
        window.__playerDrive((4 * (targetX - fromX)) / distance, (4 * (targetZ - fromZ)) / distance, 50);
        const moved = Math.hypot(window.__diag.player.x - fromX, window.__diag.player.z - fromZ);
        if (moved < 1e-4) break;
      }
      return { x: window.__diag.player.x, z: window.__diag.player.z };
    };
    window.__runWalkLegs = (legs) => {
      for (const [x, z] of legs) window.__runWalkTo(x, z);
      return { x: window.__diag.player.x, z: window.__diag.player.z };
    };
    window.__runInteract = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  });
}

const walkLegs = (page, legs) => page.evaluate((list) => window.__runWalkLegs(list), legs);

/** Everything the run's figures are compared against, read in one turn so no frame
 *  lands between the source counters and the object that reports them. */
const readAll = (page) =>
  page.evaluate(() => ({
    run: { ...window.__diag.run },
    combat: {
      kills: window.__diag.combat.kills,
      score: window.__diag.combat.score,
      treasureFound: window.__diag.combat.treasureFound,
      treasureTotal: window.__diag.combat.treasureTotal,
      dead: window.__diag.combat.dead,
      health: window.__diag.combat.health,
    },
    interaction: {
      secretsFound: window.__diag.interaction.secretsFound,
      secretsTotal: window.__diag.interaction.secretsTotal,
    },
    guardsTotal: window.__diag.enemies.length,
    lines: window.__run.lines(),
    screenVisible: window.__run.visible(),
    errors: window.__diag.errors.length,
  }));

/**
 * Drives one run from wherever the player stands to `complete`.
 *
 * Returns the messages that went wrong, empty on a run that finished. Every wait is
 * bounded and every failure names the leg it happened on, so a route the level moved
 * under fails with the tile it could not reach rather than with a timeout.
 */
async function driveToExit(page, label) {
  const errors = [];
  const at = (position, x, z) => Math.abs(position.x - x) < 1.2 && Math.abs(position.z - z) < 1.2;

  // Leg 1: south to the unlocked door in the north wall, and open it.
  await page.evaluate(() => {
    window.__runWalkTo(10.5, 20.5);
    window.__runInteract();
  });
  await settle(page, () => window.__diag.interaction.doorsOpen >= 1);
  if (!(await page.evaluate(() => window.__diag.interaction.doorsOpen >= 1))) {
    errors.push(`${label}: the door at (10,21) did not open`);
    return errors;
  }
  await waitMs(page, DOOR_OPEN_WAIT_MS);

  // Leg 2: through it, east along the opening at (21,31), then to the silver key. The
  // health pickup at (12,50) is not on this route; the one at (50,50) below is.
  const atKey = await walkLegs(page, [
    [10.5, 22.5],
    [10.5, 31.5],
    [30.5, 31.5],
    [30.5, 30.5],
  ]);
  if (!at(atKey, 30.5, 30.5)) {
    errors.push(`${label}: the walk to the silver key ended at (${atKey.x.toFixed(2)}, ${atKey.z.toFixed(2)})`);
    return errors;
  }
  await settle(page, () => window.__diag.interaction.keys.silver === 1, 4000);
  if ((await page.evaluate(() => window.__diag.interaction.keys.silver)) !== 1) {
    errors.push(`${label}: the silver key was not collected on its tile`);
    return errors;
  }

  // Leg 3: the silver-locked door at (42,31), opened with the key it named.
  const atDoor = await walkLegs(page, [
    [30.5, 31.5],
    [41.5, 31.5],
  ]);
  if (!at(atDoor, 41.5, 31.5)) {
    errors.push(`${label}: the walk to the locked door ended at (${atDoor.x.toFixed(2)}, ${atDoor.z.toFixed(2)})`);
    return errors;
  }
  await page.evaluate(() => window.__runInteract());
  await settle(page, () => window.__diag.interaction.lastReason === 'opened');
  const reason = await page.evaluate(() => window.__diag.interaction.lastReason);
  if (reason !== 'opened') {
    errors.push(`${label}: the locked door did not open with its key (lastReason=${reason})`);
    return errors;
  }
  await waitMs(page, DOOR_OPEN_WAIT_MS);

  // Leg 4: east, south through the opening at (52,42), and onto the health pickup at
  // (50,50). Frames are spent standing on it rather than walked over: a leg driven
  // inside one `evaluate` passes no frames at all, and a pickup is collected by the
  // pickups system's `update()` reading the player's position — so a pickup walked over
  // synchronously is a pickup nobody ever saw the player reach.
  const atHealth = await walkLegs(page, [
    [43.5, 31.5],
    [52.5, 31.5],
    [52.5, 43.5],
    [50.5, 50.5],
  ]);
  if (!at(atHealth, 50.5, 50.5)) {
    errors.push(
      `${label}: the walk into the south-east room ended at ` +
        `(${atHealth.x.toFixed(2)}, ${atHealth.z.toFixed(2)})`,
    );
    return errors;
  }
  await frames(page, 4);

  // The treasure beside the lift, which is what gives the score the screen prints a
  // source that moved (US2-S2).
  const before = await page.evaluate(() => window.__diag.combat.treasureFound);
  await walkLegs(page, [[54.5, 54.5]]);
  await settle(page, (had) => window.__diag.combat.treasureFound > had, 4000, before);
  const after = await page.evaluate(() => window.__diag.combat.treasureFound);
  if (after <= before) {
    errors.push(`${label}: the treasure at (54,54) was not collected (treasureFound=${after})`);
    return errors;
  }

  const atExit = await walkLegs(page, [[EXIT_TILE.x + 0.5, EXIT_TILE.z + 0.5]]);
  if (!at(atExit, EXIT_TILE.x + 0.5, EXIT_TILE.z + 0.5)) {
    errors.push(
      `${label}: the walk to the exit ended at (${atExit.x.toFixed(2)}, ${atExit.z.toFixed(2)}), ` +
        `not on (${EXIT_TILE.x}, ${EXIT_TILE.z})`,
    );
    return errors;
  }

  const atLift = await page.evaluate(() => ({
    dead: window.__diag.combat.dead,
    state: window.__diag.run.state,
  }));
  if (atLift.dead) {
    errors.push(`${label}: the guards ended the run before it reached the lift`);
    return errors;
  }

  // The press, the travel, and the arrival. `exiting` is asserted on the way through:
  // a run that reached `complete` without it never rode the lift.
  await page.evaluate(() => window.__runInteract());
  await settle(page, () => window.__diag.run.state !== 'playing', 4000);
  const riding = await page.evaluate(() => window.__diag.run.state);
  if (riding !== 'exiting' && riding !== 'complete') {
    errors.push(`${label}: the interact command at the exit left the run '${riding}', not 'exiting'`);
    return errors;
  }

  await settle(page, () => window.__diag.run.state === 'complete', 15000);
  const arrived = await page.evaluate(() => window.__diag.run.state);
  if (arrived !== 'complete') {
    errors.push(`${label}: __diag.run.state is '${arrived}', it never reached 'complete'`);
  }
  return errors;
}

/** FR-008's field set, restated here so a missing field names itself. */
const RUN_FIELDS = [
  'state', 'elapsedMs', 'kills', 'guardsTotal', 'secretsFound', 'secretsTotal',
  'treasureFound', 'treasureTotal', 'score', 'rating', 'completions',
];

export default async function check({ page }) {
  const errors = [];
  const claim = (ok, message) => {
    if (!ok) errors.push(message);
  };

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
  // missing at completion too, and this reads better than a undefined comparison below.
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
  displays('TIME', '');
  displays('KILLS', `${done.combat.kills}/${done.guardsTotal}`);
  displays('SECRETS', `${done.interaction.secretsFound}/${done.interaction.secretsTotal}`);
  displays('TREASURE', `${done.combat.treasureFound}/${done.combat.treasureTotal}`);
  claim(
    shown.get('SCORE') === `${done.combat.score}`,
    `the stats screen shows SCORE as '${shown.get('SCORE')}', not '${done.combat.score}'`,
  );
  claim(
    shown.get('RATING') === done.run.rating,
    `the stats screen shows RATING as '${shown.get('RATING')}', not '${done.run.rating}'`,
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
