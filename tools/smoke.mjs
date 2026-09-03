#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
// The loopback server and the browser-discovery rules, shared with tools/play.mjs
// so the two harnesses cannot resolve a browser differently (009 T001).
import { startServer, resolveBrowser, BrowserResolutionError } from './serve.mjs';
import { walkAndReport } from './check-no-binaries.mjs';
import { SMOKE_FPS_FLOOR } from './smoke-floor.mjs';
// One line per story, forever: every tools/smoke-checks/*.mjs runs, discovered.
import { runSmokeChecks } from './smoke-check-runner.mjs';
// US4's full loop: fire -> hit -> take damage -> die -> restart, driven and asserted beside
// this file, which is already past the 400-line ceiling (T040).
import { runCombatLoopPass } from './smoke-loop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function build() {
  const result = await run('npm', ['run', 'build']);
  if (result.code !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail('Build failed');
  }
}

// Reads the shipped grid straight from src/level.ts so the harness recomputes
// tile counts independently of src/level-stats.ts (T030, US3-S4).
function readLevelGrid() {
  const source = readFileSync(resolve(root, 'src/level.ts'), 'utf8');
  const match = source.match(/LEVEL_GRID[^=]*=\s*\[([\s\S]*?)\];/);
  if (match == null) {
    fail('Could not find LEVEL_GRID in src/level.ts');
  }
  const rows = [];
  const rowPattern = /'([^']*)'/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(match[1])) !== null) {
    rows.push(rowMatch[1]);
  }
  return rows;
}

function isSolidCell(cell) {
  return (cell >= '1' && cell <= '9') || cell === 'D' || cell === 'S';
}

function isOpenCell(cell) {
  return cell === '0' || cell === 'E';
}

function cellAt(grid, x, z) {
  const row = grid[z];
  if (row === undefined) return ' ';
  return row[x] ?? ' ';
}

// The collider footprint and boundary epsilon, mirroring src/player/tiles.ts so
// the harness recomputes walkability independently of the shipped module.
const COLLIDER_RADIUS = 0.3;
const BOUNDARY_EPSILON = 1e-6;

// A cell that blocks the player: every non-empty cell (walls, closed doors and
// secrets) plus out-of-bounds. Floor and the exit are walkable (FR-007).
function isBlockingCell(cell) {
  if (cell === '0' || cell === 'E') return false;
  return true;
}

// Whether a circle of radius 0.3 at (x, z) lies entirely within walkable tiles,
// treating a sub-epsilon overlap as flush rather than penetration.
function isPlayerWalkable(grid, x, z) {
  const minTx = Math.floor(x - COLLIDER_RADIUS);
  const maxTx = Math.floor(x + COLLIDER_RADIUS);
  const minTz = Math.floor(z - COLLIDER_RADIUS);
  const maxTz = Math.floor(z + COLLIDER_RADIUS);
  for (let tz = minTz; tz <= maxTz; tz += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!isBlockingCell(cellAt(grid, tx, tz))) continue;
      if (
        tx < x + COLLIDER_RADIUS - BOUNDARY_EPSILON &&
        tx + 1 > x - COLLIDER_RADIUS + BOUNDARY_EPSILON &&
        tz < z + COLLIDER_RADIUS - BOUNDARY_EPSILON &&
        tz + 1 > z - COLLIDER_RADIUS + BOUNDARY_EPSILON
      ) {
        return false;
      }
    }
  }
  return true;
}

// Recomputes the tile counts and wall-face count from the grid, mirroring the
// validator's and face emitter's definitions without importing either.
function recomputeCounts(grid) {
  const counts = {
    floorTiles: 0,
    wallTilesByType: {},
    doorTiles: 0,
    secretTiles: 0,
    exitTiles: 0,
    wallFaces: 0,
  };
  for (let z = 0; z < grid.length; z += 1) {
    for (let x = 0; x < grid[z].length; x += 1) {
      const cell = grid[z][x];
      if (cell === '0') counts.floorTiles += 1;
      else if (cell >= '1' && cell <= '9') counts.wallTilesByType[cell] = (counts.wallTilesByType[cell] ?? 0) + 1;
      else if (cell === 'D') counts.doorTiles += 1;
      else if (cell === 'S') counts.secretTiles += 1;
      else if (cell === 'E') counts.exitTiles += 1;
      if (isSolidCell(cell)) {
        if (isOpenCell(cellAt(grid, x, z - 1))) counts.wallFaces += 1;
        if (isOpenCell(cellAt(grid, x, z + 1))) counts.wallFaces += 1;
        if (isOpenCell(cellAt(grid, x - 1, z))) counts.wallFaces += 1;
        if (isOpenCell(cellAt(grid, x + 1, z))) counts.wallFaces += 1;
      }
    }
  }
  return counts;
}

// Asserts __diag.level carries every FR-011 field with the right type and that
// each count equals the independently recomputed value (T028, T030).
function assertLevel(level, expected) {
  const errors = [];
  if (level == null) {
    errors.push('window.__diag.level is null or undefined');
    return errors;
  }
  if (!Number.isInteger(level.floorTiles)) errors.push(`level.floorTiles is not an integer: ${JSON.stringify(level.floorTiles)}`);
  if (typeof level.wallTilesByType !== 'object' || level.wallTilesByType == null) errors.push('level.wallTilesByType is not an object');
  if (!Number.isInteger(level.doorTiles)) errors.push(`level.doorTiles is not an integer: ${JSON.stringify(level.doorTiles)}`);
  if (!Number.isInteger(level.secretTiles)) errors.push(`level.secretTiles is not an integer: ${JSON.stringify(level.secretTiles)}`);
  if (!Number.isInteger(level.exitTiles)) errors.push(`level.exitTiles is not an integer: ${JSON.stringify(level.exitTiles)}`);
  if (!Number.isInteger(level.wallFaces)) errors.push(`level.wallFaces is not an integer: ${JSON.stringify(level.wallFaces)}`);
  if (typeof level.bounds !== 'object' || level.bounds == null) {
    errors.push('level.bounds is not an object');
  } else {
    for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) {
      if (!Number.isInteger(level.bounds[key])) errors.push(`level.bounds.${key} is not an integer: ${JSON.stringify(level.bounds[key])}`);
    }
  }
  if (typeof level.valid !== 'boolean') errors.push(`level.valid is not a boolean: ${JSON.stringify(level.valid)}`);
  if (!Array.isArray(level.errors)) errors.push('level.errors is not an array');
  else if (level.errors.some((entry) => typeof entry !== 'string')) errors.push('level.errors contains a non-string entry');

  if (level.floorTiles !== expected.floorTiles) errors.push(`level.floorTiles ${level.floorTiles} != recomputed ${expected.floorTiles}`);
  if (JSON.stringify(level.wallTilesByType) !== JSON.stringify(expected.wallTilesByType)) errors.push(`level.wallTilesByType ${JSON.stringify(level.wallTilesByType)} != recomputed ${JSON.stringify(expected.wallTilesByType)}`);
  if (level.doorTiles !== expected.doorTiles) errors.push(`level.doorTiles ${level.doorTiles} != recomputed ${expected.doorTiles}`);
  if (level.secretTiles !== expected.secretTiles) errors.push(`level.secretTiles ${level.secretTiles} != recomputed ${expected.secretTiles}`);
  if (level.exitTiles !== expected.exitTiles) errors.push(`level.exitTiles ${level.exitTiles} != recomputed ${expected.exitTiles}`);
  if (level.wallFaces !== expected.wallFaces) errors.push(`level.wallFaces ${level.wallFaces} != recomputed ${expected.wallFaces}`);

  // FR-012: fail with the level error text cited when valid is false or any
  // entry appears in errors, on the normal pass.
  if (level.valid === false) {
    const text = Array.isArray(level.errors) ? level.errors.join('; ') : String(level.errors);
    errors.push(`__diag.level.valid is false: ${text}`);
  } else if (Array.isArray(level.errors) && level.errors.length > 0) {
    errors.push(`__diag.level.errors is non-empty: ${level.errors.join('; ')}`);
  }

  return errors;
}

// Samples __diag.level twice, at least 120 frames apart, so the harness can
// prove the level object is published once rather than rebuilt per frame (T031).
async function sampleLevelTwice(page) {
  const first = await page.evaluate(() => ({
    level: JSON.stringify(window.__diag.level),
    fps: window.__diag.fps,
    frameTimeMs: window.__diag.frameTimeMs,
  }));
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        function tick() {
          frames += 1;
          if (frames >= 120) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  const second = await page.evaluate(() => ({
    level: JSON.stringify(window.__diag.level),
    fps: window.__diag.fps,
    frameTimeMs: window.__diag.frameTimeMs,
  }));
  return { first, second };
}

// FR-018's interaction contract. `secretsFound` may never exceed `secretsTotal`,
// `doorsOpen` must be an integer, and every FR-017 field must be present and of
// the type the harness reads. Returns the messages; the caller decides how to
// exit. `__diag.errors` is asserted empty by `assertDiag` on every pass already.
const INTERACTION_FIELDS = [
  'doorsTotal',
  'doorsOpen',
  'secretsFound',
  'secretsTotal',
  'keys',
  'lastReason',
  'lastRefusalKeyKind',
];

function assertInteraction(interaction) {
  if (interaction == null) return ['window.__diag.interaction is null or undefined'];
  const errors = [];

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
    errors.push(`__diag.interaction.doorsOpen ${interaction.doorsOpen} exceeds doorsTotal ${interaction.doorsTotal}`);
  }
  if (interaction.keys == null || typeof interaction.keys !== 'object') {
    errors.push(`__diag.interaction.keys is not an object: ${JSON.stringify(interaction.keys)}`);
  }
  return errors;
}

async function assertDiag(page, url, { expectRenderer, expectReady = true }) {
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  await page.goto(url, { waitUntil: 'load' });

  try {
    await page.waitForFunction(
      () => {
        const diag = window.__diag;
        return diag != null && diag.ready === true;
      },
      { timeout: 15000 },
    );
  } catch (timeoutError) {
    errors.push(`window.__diag.ready did not become true within 15 seconds (${timeoutError instanceof Error ? timeoutError.message : String(timeoutError)})`);
  }

  const diag = await page.evaluate(() => {
    const d = window.__diag;
    if (d == null) {
      return { ready: false, renderer: null, fps: 0, frameTimeMs: 0, drawCalls: 0, errors: ['window.__diag is undefined'], level: null, interaction: null };
    }
    return {
      ready: d.ready,
      renderer: d.renderer,
      fps: d.fps,
      frameTimeMs: d.frameTimeMs,
      drawCalls: d.drawCalls,
      errors: d.errors,
      level: d.level,
      interaction: d.interaction == null ? null : { ...d.interaction },
    };
  });

  if (expectReady && !diag.ready) {
    errors.push('window.__diag.ready is false');
  }
  if (diag.renderer !== 'webgpu' && diag.renderer !== 'webgl') {
    errors.push(`renderer is not one of the allowed values: ${JSON.stringify(diag.renderer)}`);
  }
  if (expectRenderer != null && diag.renderer !== expectRenderer) {
    errors.push(`expected renderer ${expectRenderer}, got ${diag.renderer}`);
  }
  if (diag.fps <= SMOKE_FPS_FLOOR) {
    errors.push(`fps ${diag.fps.toFixed(1)} did not exceed floor ${SMOKE_FPS_FLOOR}`);
  }
  if (diag.errors.length > 0) {
    errors.push(...diag.errors.map((e) => String(e)));
  }

  return { diag, errors };
}

async function runSmokePass(browser, url, initScript, options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  if (initScript != null) {
    await page.addInitScript(initScript);
  }
  const result = await assertDiag(page, url, options);
  await context.close();
  return result;
}

// The normal pass: reads __diag, then asserts the level fields, the independent
// tile counts, the draw-call budget and the 120-frame stability of __diag.level.
async function runNormalPass(browser, url, expectedCounts) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const result = await assertDiag(page, url, { expectRenderer: null });
  const errors = [...result.errors];

  errors.push(...assertLevel(result.diag.level, expectedCounts));

  // FR-018: the interaction contract is read on the ordinary pass too, so a
  // malformed counter fails the gate even when no secret is ever pushed.
  errors.push(...assertInteraction(result.diag.interaction));

  if (result.diag.drawCalls >= 20) {
    errors.push(`drawCalls ${result.diag.drawCalls} is not below 20`);
  }

  const stability = await sampleLevelTwice(page);
  if (stability.first.level !== stability.second.level) {
    errors.push('__diag.level changed between two reads 120 frames apart');
  }
  // US3-S6 wants "__diag.level is stable while the renderer keeps moving". The
  // level half is asserted above. The moving half used to be asserted as
  // `first.fps !== second.fps` -- inequality of two sampled floats -- which a
  // legitimately steady frame rate fails, so it went red at random on CI and
  // twice stalled a story whose code was correct.
  //
  // Liveness is already proven structurally: sampleLevelTwice() only resolves
  // after 120 requestAnimationFrame callbacks fire, so a frozen renderer hangs
  // there and times out rather than reaching this line. Asserting the floats
  // differ adds no coverage and subtracts determinism.

  await context.close();
  return { diag: result.diag, errors };
}

// Scripts a walk of at least 200 tiles across the shipped level through
// `window.__playerDrive`, sampling `__diag.player` throughout, and fails with the
// offending tile cited if `stuck` is ever true or a sampled position lies on a
// non-walkable tile (FR-015, SC-001, SC-006).
async function runPlayerWalkPass(browser, url, grid) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  await page.goto(url, { waitUntil: 'load' });

  try {
    await page.waitForFunction(
      () =>
        window.__diag != null &&
        window.__diag.ready === true &&
        window.__diag.player != null &&
        typeof window.__playerDrive === 'function',
      { timeout: 15000 },
    );
  } catch (timeoutError) {
    errors.push(
      `__diag.player / __playerDrive did not become available within 15 seconds (${
        timeoutError instanceof Error ? timeoutError.message : String(timeoutError)
      })`,
    );
    await context.close();
    return errors;
  }

  const samples = await page.evaluate(() => {
    const SPRINT = 5.4;
    const directions = [
      [SPRINT, 0],
      [0, -SPRINT],
      [-SPRINT, 0],
      [0, SPRINT],
    ];
    const samples = [];
    let totalDist = 0;
    let prevX = window.__diag.player.x;
    let prevZ = window.__diag.player.z;
    let dirIndex = 0;
    let stepsInDir = 0;
    const STEPS_PER_DIR = 20;
    const MAX_STEPS = 2000;
    let stepCount = 0;
    while (totalDist < 200 && stepCount < MAX_STEPS) {
      const [vx, vz] = directions[dirIndex];
      window.__playerDrive(vx, vz, 250);
      const p = window.__diag.player;
      const dx = p.x - prevX;
      const dz = p.z - prevZ;
      totalDist += Math.hypot(dx, dz);
      prevX = p.x;
      prevZ = p.z;
      samples.push({ x: p.x, z: p.z, stuck: p.stuck });
      stepCount += 1;
      stepsInDir += 1;
      if (stepsInDir >= STEPS_PER_DIR) {
        stepsInDir = 0;
        dirIndex = (dirIndex + 1) % 4;
      }
    }
    return { samples, totalDist };
  });

  if (samples.totalDist < 200) {
    errors.push(
      `scripted walk covered only ${samples.totalDist.toFixed(1)} tiles, fewer than 200`,
    );
  }

  for (const sample of samples.samples) {
    if (sample.stuck) {
      errors.push(
        `__diag.player.stuck became true at (${sample.x.toFixed(4)}, ${sample.z.toFixed(4)})`,
      );
      break;
    }
  }

  for (const sample of samples.samples) {
    if (!isPlayerWalkable(grid, sample.x, sample.z)) {
      const tx = Math.floor(sample.x);
      const tz = Math.floor(sample.z);
      errors.push(
        `player position (${sample.x.toFixed(4)}, ${sample.z.toFixed(4)}) lies on non-walkable tile (${tx}, ${tz})`,
      );
      break;
    }
  }

  await context.close();
  return errors;
}

// Walks the shipped level to a locked door and presses interact, so US2's refusal
// is observed on the running page rather than only in vitest: the reason and the
// *named* key reach `__diag.interaction`, the key is then collected on its own
// tile, the same door opens, and the key is still in the inventory (US2-S8).
async function runLockedDoorPass(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  const finish = async () => {
    await context.close();
    return errors;
  };

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
    return finish();
  }

  // The scripted drive, installed in the page because it is run there, not here.
  await page.evaluate(() => {
    window.__smokeWalkTo = (targetX, targetZ) => {
      for (let step = 0; step < 400; step += 1) {
        // `__diag.player` is a live object, so the previous position has to be read
        // out as numbers or the no-progress check compares a value to itself.
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
    window.__smokeInteract = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  });

  // Waits for the expected reading, but never fails on the wait: the assertions
  // below report what was actually read, which is the more useful message.
  const settle = async (predicate) => {
    try {
      await page.waitForFunction(predicate, { timeout: 8000 });
    } catch {
      /* reported by the assertion that follows */
    }
  };
  const interaction = () => page.evaluate(() => ({ ...window.__diag.interaction }));

  // Leg 1: south to the unlocked door at (10,21), open it, walk through.
  await page.evaluate(() => {
    window.__smokeWalkTo(10.5, 20.5);
    window.__smokeInteract();
  });
  await settle(() => window.__diag.interaction.doorsOpen >= 1);
  const opening = await interaction();
  if (!(opening.doorsOpen >= 1)) {
    errors.push(`no door opened after the interact command (lastReason=${opening.lastReason})`);
    return finish();
  }

  // Leg 2: through the doorway, east along row 31, up to the silver-locked door.
  const atDoor = await page.evaluate(() => {
    window.__smokeWalkTo(10.5, 31.5);
    return window.__smokeWalkTo(41.5, 31.5);
  });
  if (Math.abs(atDoor.x - 41.5) > 0.75 || Math.abs(atDoor.z - 31.5) > 0.75) {
    errors.push(
      `walk to the locked door ended at (${atDoor.x.toFixed(2)}, ${atDoor.z.toFixed(2)}), not beside it`,
    );
    return finish();
  }

  // The refusal: named reason, named key, and no key spent to learn it.
  await page.evaluate(() => window.__smokeInteract());
  await settle(() => window.__diag.interaction.lastRefusalKeyKind != null);
  const refused = await interaction();
  if (refused.lastReason !== 'locked-missing-key') {
    errors.push(`__diag.interaction.lastReason is ${refused.lastReason}, not locked-missing-key`);
  }
  if (refused.lastRefusalKeyKind !== 'silver') {
    errors.push(`__diag.interaction.lastRefusalKeyKind is ${refused.lastRefusalKeyKind}, not silver`);
  }
  if (refused.keys?.silver !== 0) {
    errors.push(`__diag.interaction.keys.silver is ${refused.keys?.silver}, not 0 before pickup`);
  }

  // The silver key lies one room west, on the spawn side of its own door.
  await page.evaluate(() => {
    window.__smokeWalkTo(30.5, 31.5);
    window.__smokeWalkTo(30.5, 30.5);
  });
  await settle(() => window.__diag.interaction.keys.silver === 1);
  if ((await interaction()).keys?.silver !== 1) {
    errors.push('the silver key was not collected on its tile');
    return finish();
  }

  // The same door, the same press, the other outcome - and the key stays.
  await page.evaluate(() => {
    window.__smokeWalkTo(30.5, 31.5);
    window.__smokeWalkTo(41.5, 31.5);
    window.__smokeInteract();
  });
  await settle(() => window.__diag.interaction.lastReason === 'opened');
  const opened = await interaction();
  if (opened.lastReason !== 'opened') {
    errors.push(`the locked door did not open with its key: lastReason=${opened.lastReason}`);
  }
  if (opened.keys?.silver !== 1) {
    errors.push(`the silver key did not survive the unlock: keys.silver=${opened.keys?.silver}`);
  }
  if (opened.keyConsumed !== false) {
    errors.push(`__diag.interaction.keyConsumed is ${opened.keyConsumed}, not false`);
  }
  if (opened.lastRefusalKeyKind !== null) {
    errors.push(
      `__diag.interaction.lastRefusalKeyKind is ${opened.lastRefusalKeyKind} after a success, not null`,
    );
  }

  return finish();
}

async function main() {
  const args = process.argv.slice(2);
  const injectError = args.includes('--inject-error');
  const corrupt = args.includes('--corrupt');

  const findings = walkAndReport(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    fail('Binary asset check failed');
  }

  if (!injectError) {
    await build();
  } else if (!existsSync(resolve(dist, 'index.html'))) {
    await build();
  }

  const levelGrid = readLevelGrid();
  const expectedCounts = recomputeCounts(levelGrid);

  const { server, url } = await startServer();
  let browserPath;
  try {
    browserPath = resolveBrowser();
  } catch (error) {
    if (!(error instanceof BrowserResolutionError)) throw error;
    fail(error.message);
  }
  const browser = await chromium.launch({ executablePath: browserPath });

  try {
    if (injectError) {
      const message = 'Smoke-injected startup error';
      const result = await runSmokePass(
        browser,
        url,
        `window.__injectSmokeError = ${JSON.stringify(message)};`,
        { expectRenderer: null },
      );
      for (const error of result.errors) {
        console.error(error);
      }
      if (result.errors.length === 0) {
        fail('Injected startup error was not captured');
      }
      if (!result.errors.some((e) => e.includes(message))) {
        fail('Captured errors did not include the injected message');
      }
      fail(`Smoke self-test: startup error was captured and reported: ${message}`);
    }

    if (corrupt) {
      const result = await runSmokePass(browser, `${url}?corrupt=1`, null, { expectRenderer: null });
      const level = result.diag.level;
      if (level == null) {
        fail('Corrupted pass: __diag.level is null');
      }
      if (level.valid !== false) {
        fail('Corrupted pass: expected __diag.level.valid to be false');
      }
      if (!Array.isArray(level.errors) || level.errors.length === 0) {
        fail('Corrupted pass: expected __diag.level.errors to be non-empty');
      }
      const entry = level.errors[0];
      fail(`Smoke self-test: corrupted level was detected and reported: ${entry}`);
    }

    const normal = await runNormalPass(browser, url, expectedCounts);
    if (normal.errors.length > 0) {
      for (const error of normal.errors) {
        console.error(error);
      }
      fail('Normal smoke pass failed');
    }
    console.log(`Normal smoke pass: renderer=${normal.diag.renderer} fps=${normal.diag.fps.toFixed(1)}`);

    const walkErrors = await runPlayerWalkPass(browser, url, levelGrid);
    if (walkErrors.length > 0) {
      for (const error of walkErrors) {
        console.error(error);
      }
      fail('Player walk smoke pass failed');
    }
    console.log('Player walk smoke pass: 200 tiles walked, all positions walkable, not stuck');

    const lockedDoor = await runLockedDoorPass(browser, url);
    if (lockedDoor.length > 0) {
      for (const error of lockedDoor) {
        console.error(error);
      }
      fail('Locked door smoke pass failed');
    }
    console.log('Locked door smoke pass: refused by name, then opened with the key it named');

    const combatLoop = await runCombatLoopPass(browser, url, root);
    if (combatLoop.length > 0) {
      for (const error of combatLoop) console.error(error);
      fail('Combat loop smoke pass failed');
    }
    console.log('Combat loop smoke pass: every weapon fired, a guard killed, the portrait bands ' +
      'walked to zero, restarted clean');

    const checkFailures = await runSmokeChecks(browser, url, root);
    if (checkFailures.length > 0) {
      for (const failure of checkFailures) {
        console.error(failure);
      }
      fail('Smoke check modules failed');
    }

    const noGpu = await runSmokePass(
      browser,
      url,
      () => {
        // @ts-ignore
        delete navigator.gpu;
      },
      { expectRenderer: 'webgl' },
    );
    if (noGpu.errors.length > 0) {
      for (const error of noGpu.errors) {
        console.error(error);
      }
      fail('No-GPU smoke pass failed');
    }
    console.log(`No-GPU smoke pass: renderer=${noGpu.diag.renderer} fps=${noGpu.diag.fps.toFixed(1)}`);

    console.log('Smoke passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
