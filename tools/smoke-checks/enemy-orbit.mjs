// The orbit smoke check (T036, FR-010, US4-S4, US4-S7, US4-S8, SC-005): the
// billboard half of US4, asserted in a real browser because none of it exists
// outside one.
//
// Three claims, in the order they are made. The camera is stood at eight evenly
// spaced bearings around one guard and `__diag.enemies[i].viewAngle` is read at
// each: eight readings, pairwise distinct, no two consecutive alike. The draw
// calls the billboards cost are measured by hiding them from one fixed camera
// pose and differencing, so the level's own geometry cancels out and what is
// left is the guards. And the same difference is taken with the camera turned to
// face away, where it must be nothing at all.
//
// The eight readings are taken inside one `page.evaluate` with no frame between
// them. That is not a convenience: no frame means no tick, so the guard really
// is stationary for the whole orbit, which is the premise US4-S4 states. The
// orbit itself moves only the camera -- an alerted guard turns to face the
// player every tick, so orbiting by teleporting the *player* would circle a
// guard that pivots to keep its front to the viewer and could never show eight
// columns.

export const name = 'enemy-orbit';

/** The declared column count, mirrored from `src/enemy/view-angle.ts`: the gate
 *  asserts the requirement, not whatever constant the code happens to hold. */
const VIEW_ANGLES = 8;

export default async function check({ page }) {
  const errors = [];

  const ready = await page.evaluate(() => ({
    harness: typeof window.__enemySprites?.orbit === 'function',
    guards: Array.isArray(window.__diag.enemies) ? window.__diag.enemies.length : -1,
    sprites: window.__diag.enemySprites ?? null,
  }));

  if (!ready.harness) {
    errors.push('window.__enemySprites.orbit is missing: the billboard system published no camera seam');
    return errors;
  }
  if (ready.guards < 1) {
    errors.push(`__diag.enemies holds ${ready.guards} guards, so there is nothing to orbit`);
    return errors;
  }

  // US4-S7: one sheet per guard *type*, and it is 8 columns of square cells.
  const sprites = ready.sprites;
  if (sprites == null) {
    errors.push('__diag.enemySprites was never published');
  } else {
    if (sprites.textures !== 1) {
      errors.push(`__diag.enemySprites.textures is ${sprites.textures}, not the single sheet ${ready.guards} guards share`);
    }
    if (sprites.billboards !== ready.guards) {
      errors.push(`${sprites.billboards} billboards were built for ${ready.guards} guards`);
    }
    const cell = sprites.sheetWidth / VIEW_ANGLES;
    if (!Number.isInteger(cell) || cell <= 0) {
      errors.push(`sheet width ${sprites.sheetWidth} is not ${VIEW_ANGLES} whole cells wide`);
    } else if (!Number.isInteger(sprites.sheetHeight / cell) || sprites.sheetHeight < cell * 2) {
      errors.push(
        `sheet height ${sprites.sheetHeight} is not a whole number of ${cell}px frames`,
      );
    }
  }

  // US4-S4: eight bearings, eight columns, taken with no frame between them so
  // the guard cannot have moved during the orbit.
  const orbit = await page.evaluate((steps) => {
    const readings = [];
    for (let step = 0; step < steps; step += 1) {
      const returned = window.__enemySprites.orbit(0, step, { steps });
      readings.push({ returned, reported: window.__diag.enemies[0].viewAngle });
    }
    return readings;
  }, VIEW_ANGLES);

  const reported = orbit.map((reading) => reading.reported);
  orbit.forEach((reading, step) => {
    if (reading.returned !== reading.reported) {
      errors.push(
        `orbit step ${step}: the billboard chose column ${reading.returned} but __diag.enemies[0].viewAngle says ${reading.reported}`,
      );
    }
    if (!Number.isInteger(reading.reported) || reading.reported < 0 || reading.reported >= VIEW_ANGLES) {
      errors.push(`orbit step ${step}: viewAngle ${reading.reported} is not an integer in 0..${VIEW_ANGLES - 1}`);
    }
  });

  if (new Set(reported).size !== VIEW_ANGLES) {
    errors.push(`the eight orbit readings are not pairwise distinct: ${JSON.stringify(reported)}`);
  }
  for (let step = 1; step < reported.length; step += 1) {
    if (reported[step] === reported[step - 1]) {
      errors.push(`orbit steps ${step - 1} and ${step} both reported column ${reported[step]}`);
    }
  }
  // The orbit closes: the last bearing is a step away from the first, not on it.
  if (reported.length === VIEW_ANGLES && reported[VIEW_ANGLES - 1] === reported[0]) {
    errors.push('the orbit returned to its first column before it completed');
  }

  // US4-S7's draw-call clause, measured rather than asserted from the code: the
  // same camera pose is rendered with the billboards shown and hidden, so every
  // wall in the frame cancels and the difference is the guards alone.
  const draws = await page.evaluate(async () => {
    // Two frames: the first may already have been in flight when the camera
    // moved, the second is drawn with it.
    const settleFrames = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__enemySprites.orbit(0, 0);
    await settleFrames();
    const shown = window.__diag.drawCalls;
    const visibleShown = window.__diag.enemySprites.visible;
    const flags = window.__enemySprites.visibleFlags();

    window.__enemySprites.setHidden(true);
    await settleFrames();
    const withoutBillboards = window.__diag.drawCalls;
    const visibleHidden = window.__diag.enemySprites.visible;
    window.__enemySprites.setHidden(false);

    // US4-S8: turned to face away, the orbited guard is culled outright.
    window.__enemySprites.orbit(0, 0, { lookAway: true });
    await settleFrames();
    const awayFlags = window.__enemySprites.visibleFlags();
    const awayShown = window.__diag.drawCalls;
    const awayVisible = window.__diag.enemySprites.visible;
    window.__enemySprites.setHidden(true);
    await settleFrames();
    const awayHidden = window.__diag.drawCalls;
    window.__enemySprites.setHidden(false);
    window.__enemySprites.release();

    return {
      shown,
      withoutBillboards,
      visibleShown,
      visibleHidden,
      facingCount: flags.filter(Boolean).length,
      awayShown,
      awayHidden,
      awayVisible,
      awayFacesGuard: awayFlags[0],
    };
  });

  const cost = draws.shown - draws.withoutBillboards;
  // The guards tick on while this is measured, so a guard may cross the camera's
  // plane between the two readings; the larger count is the fair bound.
  const budget = Math.max(draws.visibleShown, draws.visibleHidden);
  if (cost > budget) {
    errors.push(
      `the billboards cost ${cost} draw calls for ${budget} visible guards, more than one each`,
    );
  }
  if (draws.visibleShown < 1 || cost < 1) {
    errors.push(
      `no guard was drawn from the orbit pose: ${draws.visibleShown} visible, ${cost} draw calls`,
    );
  }

  if (draws.awayFacesGuard !== false) {
    errors.push('the orbited guard was still counted visible with the camera turned away from it');
  }
  const awayCost = draws.awayShown - draws.awayHidden;
  if (awayCost > draws.awayVisible) {
    errors.push(
      `with the camera turned away the billboards still cost ${awayCost} draw calls for ${draws.awayVisible} visible guards`,
    );
  }

  return errors;
}
