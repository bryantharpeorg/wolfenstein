// The FR-018 interaction assertions, in their own module so `smoke.mjs` does not
// grow past the point where it can be read. Same contract as the rest of the
// harness: everything here recomputes from the shipped grid rather than importing
// a shipped module, so a bug in `src/interaction/` cannot hide behind the check
// that is supposed to catch it.

// FR-017's whole field set. A missing field names itself in the failure.
const INTERACTION_FIELDS = [
  'doorsTotal',
  'doorsOpen',
  'secretsFound',
  'secretsTotal',
  'keys',
  'lastReason',
  'lastRefusalKeyKind',
];

const cellAt = (grid, x, z) => (grid[z] === undefined ? ' ' : (grid[z][x] ?? ' '));

/** Open floor and the exit: what a player may stand on and a push-wall may
 * travel into. Everything else — walls, doors, secrets, out of bounds — blocks. */
const isClear = (cell) => cell === '0' || cell === 'E';

/**
 * FR-018, in full: fails when `secretsFound` exceeds `secretsTotal`, when
 * `doorsOpen` is not an integer, and when any FR-017 field is missing or the
 * wrong shape. Returns the messages; the caller decides how to exit.
 */
export function interactionErrors(interaction) {
  const errors = [];
  if (interaction == null) {
    errors.push('window.__diag.interaction is null or undefined');
    return errors;
  }

  for (const field of INTERACTION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(interaction, field)) {
      errors.push(`__diag.interaction is missing the FR-017 field '${field}'`);
    }
  }

  for (const field of ['doorsTotal', 'doorsOpen', 'secretsFound', 'secretsTotal']) {
    if (!Number.isInteger(interaction[field])) {
      errors.push(`__diag.interaction.${field} is not an integer: ${JSON.stringify(interaction[field])}`);
    }
  }

  if (interaction.secretsFound > interaction.secretsTotal) {
    errors.push(
      `__diag.interaction.secretsFound ${interaction.secretsFound} exceeds secretsTotal ` +
        `${interaction.secretsTotal} (lastReason=${interaction.lastReason})`,
    );
  }
  if (interaction.secretsFound < 0) {
    errors.push(`__diag.interaction.secretsFound is negative: ${interaction.secretsFound}`);
  }
  if (interaction.doorsOpen > interaction.doorsTotal) {
    errors.push(
      `__diag.interaction.doorsOpen ${interaction.doorsOpen} exceeds doorsTotal ${interaction.doorsTotal}`,
    );
  }
  if (typeof interaction.keys !== 'object' || interaction.keys == null) {
    errors.push('__diag.interaction.keys is not an object');
  } else {
    for (const kind of ['silver', 'gold']) {
      if (!Number.isInteger(interaction.keys[kind])) {
        errors.push(`__diag.interaction.keys.${kind} is not an integer: ${JSON.stringify(interaction.keys[kind])}`);
      }
    }
  }
  if (interaction.lastReason !== null && typeof interaction.lastReason !== 'string') {
    errors.push(`__diag.interaction.lastReason is neither null nor a string: ${JSON.stringify(interaction.lastReason)}`);
  }

  return errors;
}

/** The push axis, recomputed the way the shipped field does: a secret sits in a
 * one-tile-thick wall, so it retreats along the axis its solid neighbours are
 * *not* on. */
function pushAxis(grid, x, z) {
  const solidAlongZ = (isClear(cellAt(grid, x, z - 1)) ? 0 : 1) + (isClear(cellAt(grid, x, z + 1)) ? 0 : 1);
  const solidAlongX = (isClear(cellAt(grid, x - 1, z)) ? 0 : 1) + (isClear(cellAt(grid, x + 1, z)) ? 0 : 1);
  if (solidAlongZ > solidAlongX) return 'x';
  if (solidAlongX > solidAlongZ) return 'z';
  return 'x';
}

/**
 * Every `S` tile of the shipped grid with a tile the player can push it from: the
 * neighbour on the near side of a direction whose two travel tiles are both clear.
 * A secret with no such side would be flagged by `validateLevel()` long before
 * this, and is reported here as having no approach.
 */
export function findSecrets(grid) {
  const secrets = [];
  for (let z = 0; z < grid.length; z += 1) {
    for (let x = 0; x < grid[z].length; x += 1) {
      if (cellAt(grid, x, z) !== 'S') continue;
      const axis = pushAxis(grid, x, z);
      let approach = null;
      for (const direction of [1, -1]) {
        const stand = axis === 'x' ? { x: x - direction, z } : { x, z: z - direction };
        const first = axis === 'x' ? { x: x + direction, z } : { x, z: z + direction };
        const second = axis === 'x' ? { x: x + 2 * direction, z } : { x, z: z + 2 * direction };
        if (!isClear(cellAt(grid, stand.x, stand.z))) continue;
        if (!isClear(cellAt(grid, first.x, first.z)) || !isClear(cellAt(grid, second.x, second.z))) continue;
        approach = stand;
        break;
      }
      secrets.push({ x, z, axis, approach });
    }
  }
  return secrets;
}

/** A 4-neighbour route across floor, exit and door tiles — doors included because
 * the walker opens them — plus any secret tile already opened. Null when no route
 * exists, which is a failure the caller reports rather than swallows. */
export function routeTo(grid, from, to, opened = new Set()) {
  const key = (x, z) => `${x},${z}`;
  const passable = (x, z) => {
    const cell = cellAt(grid, x, z);
    return cell === '0' || cell === 'E' || cell === 'D' || opened.has(key(x, z));
  };
  if (!passable(to.x, to.z)) return null;

  const previous = new Map([[key(from.x, from.z), null]]);
  const queue = [from];
  while (queue.length > 0) {
    const tile = queue.shift();
    if (tile.x === to.x && tile.z === to.z) break;
    for (const next of [
      { x: tile.x + 1, z: tile.z },
      { x: tile.x - 1, z: tile.z },
      { x: tile.x, z: tile.z + 1 },
      { x: tile.x, z: tile.z - 1 },
    ]) {
      const id = key(next.x, next.z);
      if (previous.has(id) || !passable(next.x, next.z)) continue;
      previous.set(id, tile);
      queue.push(next);
    }
  }

  if (!previous.has(key(to.x, to.z))) return null;
  const path = [];
  for (let tile = to; tile != null; tile = previous.get(key(tile.x, tile.z))) {
    path.unshift({ x: tile.x, z: tile.z, door: cellAt(grid, tile.x, tile.z) === 'D' });
  }
  return path.slice(1);
}

/** The scripted walker, installed in the page because it runs there. Mirrors the
 * locked-door pass's helpers; a fresh page needs its own copy. */
export const INSTALL_WALKER = () => {
  window.__smokeWalkTo = (targetX, targetZ) => {
    for (let step = 0; step < 400; step += 1) {
      const fromX = window.__diag.player.x;
      const fromZ = window.__diag.player.z;
      const distance = Math.hypot(targetX - fromX, targetZ - fromZ);
      if (distance < 0.05) break;
      window.__playerDrive((4 * (targetX - fromX)) / distance, (4 * (targetZ - fromZ)) / distance, 50);
      if (Math.hypot(window.__diag.player.x - fromX, window.__diag.player.z - fromZ) < 1e-4) break;
    }
    return { x: window.__diag.player.x, z: window.__diag.player.z };
  };
  window.__smokeFollow = (waypoints) => {
    for (const waypoint of waypoints) window.__smokeWalkTo(waypoint.x + 0.5, waypoint.z + 0.5);
    return { x: window.__diag.player.x, z: window.__diag.player.z };
  };
  window.__smokeInteract = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
};

const sleep = (page, ms) => page.evaluate((delay) => new Promise((done) => setTimeout(done, delay)), ms);

const position = (page) =>
  page.evaluate(() => ({ x: window.__diag.player.x, z: window.__diag.player.z }));

const near = (a, b, tolerance) => Math.hypot(a.x - b.x, a.z - b.z) <= tolerance;

const centre = (tile) => ({ x: tile.x + 0.5, z: tile.z + 0.5 });

/**
 * Walks a route, opening each door it crosses. `__playerDrive` integrates
 * synchronously but does not advance a frame, so a door's travel has to be waited
 * out in real time here rather than in the page.
 */
async function follow(page, path, errors) {
  let run = [];
  const flush = async () => {
    if (run.length === 0) return;
    const waypoints = run;
    run = [];
    await page.evaluate((w) => window.__smokeFollow(w), waypoints);
  };

  for (const waypoint of path) {
    if (!waypoint.door) {
      run.push(waypoint);
      continue;
    }
    await flush();
    let arrived = false;
    for (let attempt = 0; attempt < 3 && !arrived; attempt += 1) {
      await page.evaluate(() => window.__smokeInteract());
      await sleep(page, 1000);
      await page.evaluate((t) => window.__smokeWalkTo(t.x, t.z), centre(waypoint));
      arrived = near(await position(page), centre(waypoint), 0.35);
    }
    if (!arrived) {
      errors.push(`could not open and cross the door at (${waypoint.x},${waypoint.z})`);
      return false;
    }
  }
  await flush();
  return true;
}

/**
 * Pushes every secret the shipped layout declares and reads the counters back
 * (FR-018, US3-S4, US3-S5, US3-S7): each push must move `secretsFound` by exactly
 * one, the total must be reached, the opened tile must be walkable, and a further
 * push must answer `already-open` without moving the counter.
 */
async function secretPass(page, grid) {
  const errors = [];
  const read = () => page.evaluate(() => ({ ...window.__diag.interaction }));
  const settle = async (predicate) => {
    try {
      await page.waitForFunction(predicate, { timeout: 8000 });
    } catch {
      /* reported by the assertion that follows */
    }
  };

  await page.evaluate(INSTALL_WALKER);

  const secrets = findSecrets(grid);
  const start = await read();
  errors.push(...interactionErrors(start));
  if (secrets.length === 0) {
    errors.push('the shipped layout declares no secret tiles, so secretsTotal can never be met');
    return errors;
  }
  if (start.secretsTotal !== secrets.length) {
    errors.push(`__diag.interaction.secretsTotal ${start.secretsTotal} != ${secrets.length} recomputed from the grid`);
  }
  if (start.secretsFound !== 0) {
    errors.push(`__diag.interaction.secretsFound is ${start.secretsFound} before any push, not 0`);
  }

  const opened = new Set();
  for (const secret of secrets) {
    const where = `(${secret.x},${secret.z})`;
    if (secret.approach == null) {
      errors.push(`the secret at ${where} has no side its 2-tile path can be pushed from`);
      continue;
    }

    const player = await position(page);
    const path = routeTo(
      grid,
      { x: Math.floor(player.x), z: Math.floor(player.z) },
      secret.approach,
      opened,
    );
    if (path == null) {
      errors.push(`no route from (${Math.floor(player.x)},${Math.floor(player.z)}) to the secret at ${where}`);
      break;
    }
    if (!(await follow(page, path, errors))) break;

    const approach = centre(secret.approach);
    if (!near(await position(page), approach, 0.6)) {
      const stopped = await position(page);
      errors.push(`walk to the secret at ${where} ended at (${stopped.x.toFixed(2)},${stopped.z.toFixed(2)}), not beside it`);
      break;
    }

    const before = await read();
    await page.evaluate(() => window.__smokeInteract());
    await settle(() => window.__diag.interaction.lastReason === 'opened');
    const after = await read();
    errors.push(...interactionErrors(after));
    if (after.lastReason !== 'opened') {
      errors.push(`pushing the secret at ${where} reported ${after.lastReason}, not opened`);
    }
    if (after.secretsFound !== before.secretsFound + 1) {
      errors.push(
        `pushing the secret at ${where} moved secretsFound ${before.secretsFound} -> ${after.secretsFound}, not by exactly 1`,
      );
    }

    // The wall takes its declared travel time to clear; only then is the tile it
    // vacated an opening the player can walk into (US3-S7).
    await sleep(page, 2500);
    opened.add(`${secret.x},${secret.z}`);
    await page.evaluate((t) => window.__smokeWalkTo(t.x, t.z), centre(secret));
    const onTile = await position(page);
    if (!near(onTile, centre(secret), 0.2)) {
      errors.push(
        `the opened secret at ${where} is not walkable: the player stopped at (${onTile.x.toFixed(2)},${onTile.z.toFixed(2)})`,
      );
    }

    await page.evaluate((t) => window.__smokeWalkTo(t.x, t.z), approach);
    const held = await read();
    await page.evaluate(() => window.__smokeInteract());
    await settle(() => window.__diag.interaction.lastReason === 'already-open');
    const again = await read();
    if (again.lastReason !== 'already-open') {
      errors.push(`re-pushing the open secret at ${where} reported ${again.lastReason}, not already-open`);
    }
    if (again.secretsFound !== held.secretsFound) {
      errors.push(
        `re-pushing the open secret at ${where} moved secretsFound ${held.secretsFound} -> ${again.secretsFound}`,
      );
    }
  }

  const final = await read();
  errors.push(...interactionErrors(final));
  if (final.secretsFound !== final.secretsTotal) {
    errors.push(
      `every secret was pushed, but secretsFound ${final.secretsFound} did not reach secretsTotal ${final.secretsTotal} (lastReason=${final.lastReason})`,
    );
  }

  const captured = await page.evaluate(() => window.__diag.errors.slice());
  for (const entry of captured) errors.push(`__diag.errors: ${entry}`);

  return errors;
}

// The page the secret pass runs in. Kept here rather than in `smoke.mjs` so the
// harness's entry file grows by a call rather than by a browser fixture.
export async function runSecretsPass(browser, url, grid) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(
      () =>
        window.__diag != null &&
        window.__diag.ready === true &&
        window.__diag.player != null &&
        window.__diag.interaction != null &&
        typeof window.__playerDrive === 'function',
      { timeout: 15000 },
    );
  } catch (error) {
    errors.push(`__diag.interaction / __playerDrive did not appear within 15 seconds (${error})`);
    await context.close();
    return errors;
  }

  errors.push(...(await secretPass(page, grid)));
  await context.close();
  return errors;
}
