// The route (T023). The scripted drive from spawn to the elevator, and the page-side
// helpers it needs, lifted out of `tools/smoke-checks/run.mjs` so neither file passes
// Constitution IV's 400-line ceiling — the same split `tools/smoke-loop.mjs` made out of
// `tools/smoke.mjs`. It lives *beside* `smoke-checks/` rather than in it: the runner
// treats every `.mjs` in that directory as a check and would call this one as if it
// were.
//
// The route is 002's layout. The three-by-three rooms are joined by openings and doors,
// and the only way from the north-west room to the south-east one runs through the
// unlocked door at (10,21), the opening at (21,31), the silver-locked door at (42,31) —
// which is why the silver key at (30,30) is collected first — and the opening at
// (52,42). It is walked in as few page turns as possible: `__playerDrive` integrates
// synchronously, so a leg driven inside one `evaluate` passes no frames and the guards
// take no tick during it. The waits, where there are any, are this check's whole
// exposure to them.

/** The exit tile 002 ships. */
const EXIT_TILE = { x: 55, z: 55 };

/** 004's `DOOR_TRAVEL_MS` with room to spare, and comfortably inside its 3000 ms dwell:
 *  long enough that a door pressed is a door you can walk through, short enough that the
 *  same door has not shut again behind the wait. */
const DOOR_OPEN_WAIT_MS = 1200;

export const frames = (page, count) =>
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
export async function installDriver(page) {
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
export const readAll = (page) =>
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
export async function driveToExit(page, label) {
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
