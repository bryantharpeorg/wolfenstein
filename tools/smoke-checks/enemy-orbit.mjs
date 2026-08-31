// US4's smoke check: the camera orbits a stationary guard through 360 degrees in
// eight equal steps and `__diag.enemies[i].viewAngle` is read at each one, which must
// give eight pairwise-distinct readings with no consecutive repeat — the assertion
// that a billboard is chosen from the *bearing* rather than spun like a flat card.
// Riding along: one texture per guard type, no draw call for a guard behind the
// camera, the built canvas's dimensions, and a death animation that runs and holds
// (FR-010, FR-011, US4-S2, US4-S4..S8, SC-005). The camera moves through
// `window.__enemyView`, the seam `src/systems/enemy-billboards/register.ts` installs
// for this — 003's `window.__playerDrive` counterpart — so no synthetic mouse input.
//
// Default-exported, returning the failures: the contract `tools/smoke-check-runner.mjs`
// discovers.

export default async function enemyOrbitCheck({ page }) {
  const errors = [];
  const check = (ok, message) => {
    if (!ok) errors.push(message);
  };

  try {
    await page.waitForFunction(() => window.__enemyView != null && window.__diag?.enemies?.length > 0, {
      timeout: 15000,
    });
  } catch (error) {
    return [`__diag.enemies / __enemyView did not appear within 15s (${error.message})`];
  }

  // A draw-call reading means nothing until the renderer has drawn: `drawCalls` is
  // published at the top of a frame.
  await page.evaluate(() => {
    window.__waitFrames = (count) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => (seen++ >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
  });

  // FR-011: the published shape, before anything is asserted about its values.
  const contract = await page.evaluate(() => ({
    enemies: window.__diag.enemies.map((e) => [e.state, e.viewAngle, e.pathable]),
    alive: window.__diag.enemiesAlive,
    boards: { ...window.__diag.enemyBillboards },
  }));

  contract.enemies.forEach(([state, angle, pathable], i) => {
    const ok = typeof state === 'string' && typeof pathable === 'boolean' && Number.isInteger(angle) && angle >= 0 && angle <= 7;
    check(ok, `enemies[${i}] is not {state, viewAngle: 0..7, pathable}: ${JSON.stringify([state, angle, pathable])}`);
  });

  const expected = contract.enemies.filter(([state]) => state !== 'death').length;
  check(contract.alive === expected, `enemiesAlive is ${contract.alive}, not the ${expected} records not dead`);

  // US4-S7: one sheet and one texture per guard type, whatever the guard count.
  const { sheets, textures, total } = contract.boards;
  check(sheets === 1 && textures === 1, `want 1 sheet and 1 texture per type, got ${sheets}/${textures} for ${total} guards`);

  // US4-S4: the orbit itself — eight equal steps around one stationary guard.
  const orbit = await page.evaluate(() => {
    const view = window.__enemyView;
    const target = view.guards()[0];
    return Array.from({ length: 8 }, (_, step) => {
      const bearing = (step / 8) * Math.PI * 2;
      view.orbit(target.x - Math.sin(bearing) * 3, target.z - Math.cos(bearing) * 3, target.x, target.z);
      return [window.__diag.enemies[0].viewAngle, view.visibility()[0]];
    });
  });

  const angles = orbit.map(([angle]) => angle);
  check(new Set(angles).size === 8, `the eight orbit steps read ${new Set(angles).size} distinct angles: [${angles}]`);
  for (let i = 1; i < angles.length; i += 1) {
    if (angles[i] !== angles[i - 1]) continue;
    check(false, `orbit steps ${i - 1} and ${i} read angle ${angles[i]} from different bearings: [${angles}]`);
    break;
  }
  const unseen = orbit.findIndex(([, visible]) => !visible);
  check(unseen < 0, `the orbited guard was not drawn at step ${unseen}, with the camera pointed at it`);

  // US4-S7: drawCalls rises by no more than one per visible guard, measured against
  // the same camera with every billboard hidden so the level's own calls cancel out.
  // US4-S8: standing north of the guard and looking further north puts it squarely
  // behind the camera, where it must not be drawn.
  const cull = await page.evaluate(async () => {
    const view = window.__enemyView;
    const t = view.guards()[0];
    view.orbit(t.x, t.z + 3, t.x, t.z);
    await window.__waitFrames(5);
    view.setBillboardsVisible(false);
    await window.__waitFrames(5);
    const hidden = window.__diag.drawCalls;
    view.setBillboardsVisible(true);
    await window.__waitFrames(5);
    const shown = window.__diag.drawCalls;
    const drawn = window.__diag.enemyBillboards.drawn;

    view.orbit(t.x, t.z - 2, t.x, t.z - 40);
    await window.__waitFrames(3);
    const behind = { visible: view.visibility()[0], drawn: window.__diag.enemyBillboards.drawn };
    behind.count = view.visibility().filter(Boolean).length;
    view.release();
    return { hidden, shown, drawn, behind };
  });

  const cost = cull.shown - cull.hidden;
  check(cost <= cull.drawn, `drawCalls rose by ${cost} for ${cull.drawn} visible guards (${cull.hidden} to ${cull.shown})`);
  check(!cull.behind.visible, 'a guard behind the camera was still drawn');
  check(cull.behind.drawn === cull.behind.count, `drawn is ${cull.behind.drawn} but ${cull.behind.count} quads were`);

  // US4-S2 on the page rather than in the plan: the canvas actually built is
  // `8 * cell` by `frames * cell`.
  const sheet = await page.evaluate(() => window.__enemyView.sheet());
  const declared = `${sheet.width}x${sheet.height}`;
  const want = `${8 * sheet.cell}x${sheet.frames.length * sheet.cell}`;
  const canvas = `${sheet.canvasWidth}x${sheet.canvasHeight}`;
  check(declared === want, `the sheet is ${declared}, not ${want} for 8 angles and ${sheet.frames.length} frames`);
  check(canvas === declared, `the canvas is ${canvas}, not the declared ${declared}`);

  // US4-S5 and US4-S6: a guard put into `death` on the published record — the object
  // the renderer reads — starts on the first death frame, holds the last once the
  // declared duration has passed, and stops counting toward enemiesAlive. That the
  // frames between advance on schedule is vitest's, per plan.md.
  const death = await page.evaluate(async (durationMs) => {
    const view = window.__enemyView;
    const t = view.guards()[0];
    view.orbit(t.x, t.z + 3, t.x, t.z);
    await window.__waitFrames(2);

    const before = window.__diag.enemiesAlive;
    // Through US3's damage seam, the way a shot kills: the world runs the guard into
    // `death` on its own tick, so this asserts the shipped path and not a poked field.
    view.kill(0);
    for (let i = 0; i < 120 && window.__diag.enemies[0].state !== 'death'; i += 1) {
      await window.__waitFrames(1);
    }
    // Read in the same turn the state change is seen, before the first death frame
    // has had its declared slice of the duration to advance.
    const state = window.__diag.enemies[0].state;
    const first = view.frames()[0];
    const after = window.__diag.enemiesAlive;

    const deadline = performance.now() + durationMs + 400;
    while (performance.now() < deadline) await window.__waitFrames(4);
    const held = view.frames()[0];
    view.release();
    return { before, after, first, held, state };
  }, sheet.deathDurationMs);

  const last = sheet.deathFrames[sheet.deathFrames.length - 1];
  check(death.state === 'death', `the damaged guard never reached death (state '${death.state}')`);
  check(death.first === sheet.deathFrames[0], `death opened on '${death.first}', not '${sheet.deathFrames[0]}'`);
  check(death.held === last, `death ended holding '${death.held}', not the final frame '${last}'`);
  check(death.after === death.before - 1, `enemiesAlive is ${death.after} after a death, not ${death.before - 1}`);

  if (errors.length === 0) {
    console.log(
      `  eight bearings read [${angles}]; ${cull.drawn} visible guards cost ${cost} draw calls; ` +
        `death opened on ${death.first} and held ${death.held}`,
    );
  }

  return errors;
}
