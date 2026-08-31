// US4's smoke check: the camera orbits a stationary guard through 360 degrees in
// eight equal steps and `window.__diag.enemies[i].viewAngle` is read at each one
// (FR-010, US4-S4, US4-S7, US4-S8, SC-005).
//
// The eight readings must be pairwise distinct with no consecutive repeat, which
// is the assertion that a billboard is chosen from the *bearing* rather than
// spun like a flat card. Two cheaper facts ride along on the same page: one
// texture per guard type however many guards there are, and no draw call at all
// for a guard behind the camera.
//
// The camera is driven through `window.__enemyView`, the seam
// `src/systems/enemy-billboards/register.ts` installs for exactly this — the
// counterpart of 003's `window.__playerDrive`, and the reason this check needs
// no synthetic mouse input.

export const description = 'orbits the camera around a guard and reads eight distinct view angles';

export async function run({ page }) {
  const errors = [];

  try {
    await page.waitForFunction(
      () =>
        window.__diag != null &&
        Array.isArray(window.__diag.enemies) &&
        window.__diag.enemies.length > 0 &&
        window.__enemyView != null,
      { timeout: 15000 },
    );
  } catch (error) {
    errors.push(
      `__diag.enemies / __enemyView did not appear within 15 seconds (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return errors;
  }

  // FR-011: the published shape, before anything is asserted about its values.
  const contract = await page.evaluate(() => ({
    enemies: window.__diag.enemies.map((enemy) => ({
      state: enemy.state,
      viewAngle: enemy.viewAngle,
      pathable: enemy.pathable,
    })),
    enemiesAlive: window.__diag.enemiesAlive,
    billboards: { ...window.__diag.enemyBillboards },
  }));

  contract.enemies.forEach((enemy, index) => {
    if (typeof enemy.state !== 'string') {
      errors.push(`__diag.enemies[${index}].state is not a string: ${JSON.stringify(enemy.state)}`);
    }
    if (!Number.isInteger(enemy.viewAngle) || enemy.viewAngle < 0 || enemy.viewAngle > 7) {
      errors.push(
        `__diag.enemies[${index}].viewAngle is not an integer in 0..7: ${JSON.stringify(enemy.viewAngle)}`,
      );
    }
    if (typeof enemy.pathable !== 'boolean') {
      errors.push(
        `__diag.enemies[${index}].pathable is not a boolean: ${JSON.stringify(enemy.pathable)}`,
      );
    }
  });

  const expectedAlive = contract.enemies.filter((enemy) => enemy.state !== 'death').length;
  if (contract.enemiesAlive !== expectedAlive) {
    errors.push(
      `__diag.enemiesAlive is ${contract.enemiesAlive}, not the ${expectedAlive} records that are not dead`,
    );
  }

  // US4-S7: one sheet and one texture per guard type, whatever the guard count.
  if (contract.billboards.sheets !== 1 || contract.billboards.textures !== 1) {
    errors.push(
      `expected exactly one sprite sheet and one texture per guard type, got ` +
        `${contract.billboards.sheets} sheets and ${contract.billboards.textures} textures for ` +
        `${contract.billboards.total} guards`,
    );
  }

  // US4-S4: the orbit itself.
  const orbit = await page.evaluate(() => {
    const view = window.__enemyView;
    const guards = view.guards();
    const target = guards[0];
    const RADIUS = 3;
    const STEPS = 8;
    const readings = [];
    for (let step = 0; step < STEPS; step += 1) {
      const bearing = (step / STEPS) * Math.PI * 2;
      const x = target.x - Math.sin(bearing) * RADIUS;
      const z = target.z - Math.cos(bearing) * RADIUS;
      view.orbit(x, z, target.x, target.z);
      readings.push({
        step,
        camera: { x, z },
        viewAngle: window.__diag.enemies[0].viewAngle,
        visible: view.visibility()[0],
      });
    }
    return { target, readings };
  });

  const angles = orbit.readings.map((reading) => reading.viewAngle);
  const distinct = new Set(angles);
  if (distinct.size !== 8) {
    errors.push(
      `the eight orbit steps read ${distinct.size} distinct view angles, not 8: [${angles.join(', ')}]`,
    );
  }
  for (let index = 1; index < angles.length; index += 1) {
    if (angles[index] === angles[index - 1]) {
      errors.push(
        `orbit steps ${index - 1} and ${index} both read view angle ${angles[index]} ` +
          `(camera moved to ${orbit.readings[index].camera.x.toFixed(2)}, ${orbit.readings[index].camera.z.toFixed(2)})`,
      );
      break;
    }
  }
  for (const reading of orbit.readings) {
    if (!reading.visible) {
      errors.push(
        `the orbited guard was not drawn at step ${reading.step}, with the camera pointed at it`,
      );
      break;
    }
  }

  // US4-S7: drawCalls rises by no more than one per visible guard. Measured by
  // difference against the same camera with every billboard hidden, so the
  // level's own draw calls cancel out.
  const budget = await page.evaluate(async () => {
    // A draw-call reading is only meaningful after the renderer has drawn: the
    // diagnostics system publishes `drawCalls` at the top of a frame.
    const frames = (count) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => {
          seen += 1;
          if (seen >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const view = window.__enemyView;
    const target = view.guards()[0];
    view.orbit(target.x, target.z + 3, target.x, target.z);
    await frames(5);
    const shown = { drawCalls: window.__diag.drawCalls, drawn: window.__diag.enemyBillboards.drawn };
    view.setBillboardsVisible(false);
    await frames(5);
    const hidden = window.__diag.drawCalls;
    view.setBillboardsVisible(true);
    await frames(5);
    const restored = {
      drawCalls: window.__diag.drawCalls,
      drawn: window.__diag.enemyBillboards.drawn,
    };
    return { shown, hidden, restored };
  });

  const cost = budget.restored.drawCalls - budget.hidden;
  if (cost > budget.restored.drawn) {
    errors.push(
      `drawCalls rose by ${cost} for ${budget.restored.drawn} visible guards ` +
        `(${budget.hidden} hidden, ${budget.restored.drawCalls} shown), more than one per guard`,
    );
  }

  // US4-S8: a guard behind the camera issues no draw call.
  const behind = await page.evaluate(async () => {
    const frames = (count) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => {
          seen += 1;
          if (seen >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const view = window.__enemyView;
    const target = view.guards()[0];
    // Stand just north of the guard and look further north: the guard is now
    // squarely behind the camera.
    view.orbit(target.x, target.z - 2, target.x, target.z - 40);
    await frames(3);
    const result = {
      visible: view.visibility()[0],
      drawn: window.__diag.enemyBillboards.drawn,
      visibleCount: view.visibility().filter(Boolean).length,
      drawCalls: window.__diag.drawCalls,
    };
    view.release();
    return result;
  });

  if (behind.visible) {
    errors.push('a guard behind the camera was still drawn');
  }
  if (behind.drawn !== behind.visibleCount) {
    errors.push(
      `__diag.enemyBillboards.drawn is ${behind.drawn} but ${behind.visibleCount} billboards report as drawn`,
    );
  }

  // US4-S2 on the page rather than in the plan: the canvas that was actually
  // built is `8 * cell` by `frames * cell`.
  const sheet = await page.evaluate(() => window.__enemyView.sheet());
  if (sheet.width !== 8 * sheet.cell || sheet.height !== sheet.frames.length * sheet.cell) {
    errors.push(
      `the sheet is ${sheet.width}x${sheet.height}, not ${8 * sheet.cell}x${
        sheet.frames.length * sheet.cell
      } for 8 angles and ${sheet.frames.length} frames`,
    );
  }
  if (sheet.canvasWidth !== sheet.width || sheet.canvasHeight !== sheet.height) {
    errors.push(
      `the canvas is ${sheet.canvasWidth}x${sheet.canvasHeight}, not the declared ${sheet.width}x${sheet.height}`,
    );
  }

  // US4-S5 and US4-S6: a guard put into `death` animates through the declared
  // death frames over the declared duration, holds the last one, and stops
  // counting toward `enemiesAlive`. The state is set on the published record,
  // which is the same object the renderer reads.
  const death = await page.evaluate(async (durationMs) => {
    const frames = (count) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => {
          seen += 1;
          if (seen >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const view = window.__enemyView;
    const target = view.guards()[0];
    view.orbit(target.x, target.z + 3, target.x, target.z);
    await frames(2);

    const aliveBefore = window.__diag.enemiesAlive;
    window.__diag.enemies[0].state = 'death';
    await frames(2);
    const first = view.frames()[0];
    const aliveAfter = window.__diag.enemiesAlive;

    const seen = new Set([first]);
    const deadline = performance.now() + durationMs + 400;
    while (performance.now() < deadline) {
      await frames(2);
      seen.add(view.frames()[0]);
    }
    const held = view.frames()[0];
    await frames(20);
    const stillHeld = view.frames()[0];
    view.release();
    return { aliveBefore, aliveAfter, first, seen: [...seen], held, stillHeld };
  }, sheet.deathDurationMs);

  if (death.first !== sheet.deathFrames[0]) {
    errors.push(
      `a guard entering death showed '${death.first}', not the first death frame '${sheet.deathFrames[0]}'`,
    );
  }
  for (const frame of sheet.deathFrames) {
    if (!death.seen.includes(frame)) {
      errors.push(
        `the death animation never showed '${frame}' over its declared ${sheet.deathDurationMs}ms ` +
          `(saw ${death.seen.join(', ')})`,
      );
    }
  }
  const finalFrame = sheet.deathFrames[sheet.deathFrames.length - 1];
  if (death.held !== finalFrame || death.stillHeld !== finalFrame) {
    errors.push(
      `the death animation ended on '${death.held}' then '${death.stillHeld}', not holding '${finalFrame}'`,
    );
  }
  if (death.aliveAfter !== death.aliveBefore - 1) {
    errors.push(
      `__diag.enemiesAlive is ${death.aliveAfter} after a guard entered death, not ${
        death.aliveBefore - 1
      }`,
    );
  }

  if (errors.length === 0) {
    console.log(
      `  eight bearings read view angles [${angles.join(', ')}]; ` +
        `${budget.restored.drawn} visible guards cost ${cost} draw calls; ` +
        `death ran ${death.seen.join(' -> ')} and held ${death.stillHeld}`,
    );
  }

  return errors;
}
