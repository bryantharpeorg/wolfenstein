#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { walkAndReport } from './check-no-binaries.mjs';
import { SMOKE_FPS_FLOOR } from './smoke-floor.mjs';
// One line per story, forever: every tools/smoke-checks/*.mjs runs, discovered.
import { runSmokeChecks } from './smoke-check-runner.mjs';
// US4's full loop. The driving lives beside this file rather than in it, because
// this harness is already past Constitution IV's ceiling (007 US4 T040).
import {
  combatState,
  declaredPortraitIndex,
  fireOnce,
  frames,
  holdWithoutFiring,
  hudWithinOneFrame,
  installLoopDrive,
  interact,
  interfaceFields,
  killOne,
  readDeclared,
  readHealthBands,
  readMarkers,
  rest,
  select,
  viewModelPose,
  walkBands,
  walkTo,
} from './smoke-loop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

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

function startServer() {
  return new Promise((start, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = url.pathname;
      if (path === '/') path = '/index.html';
      const filePath = resolve(dist, path.slice(1));
      if (!filePath.startsWith(dist)) {
        console.error(`403 for ${path} -> ${filePath} (outside ${dist})`);
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      const ext = extname(filePath);
      readFile(filePath)
        .then((data) => {
          res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
          res.end(data);
        })
        .catch(() => {
          res.statusCode = 404;
          res.end('Not found');
        });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address != null ? address.port : 0;
      start({ server, url: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

function resolveBrowser() {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    if (!existsSync(chromePath)) {
      fail(`Missing browser: CHROME_PATH points to ${chromePath}, which does not exist.`);
    }
    return chromePath;
  }

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    // Try the real Chromium layout used by installed browser caches.
    const candidates = [
      resolve(browsersPath, 'chromium-1234', 'chrome-linux64', 'chrome'),
      resolve(browsersPath, 'chromium', 'chrome-linux', 'chrome'),
      resolve(browsersPath, 'chromium_headless_shell-1234', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      resolve(browsersPath, 'chromium-HEADLESS-shell', 'chrome-linux', 'chrome'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    fail(
      `Missing browser: PLAYWRIGHT_BROWSERS_PATH=${browsersPath} does not contain a Chromium executable.`,
    );
  }

  // Let Playwright resolve from its default cache. If it resolves a path, verify it
  // exists; otherwise fail with a clear message rather than attempting a download.
  try {
    const path = chromium.executablePath();
    if (!existsSync(path)) {
      fail(
        `Missing browser: Playwright resolved ${path} but it does not exist. Set CHROME_PATH or PLAYWRIGHT_BROWSERS_PATH to a valid Chromium.`,
      );
    }
    return path;
  } catch (error) {
    fail(
      `Missing browser: no CHROME_PATH or PLAYWRIGHT_BROWSERS_PATH set, and Playwright cannot find a cached Chromium (${error instanceof Error ? error.message : String(error)}).`,
    );
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

// FR-018's combat contract, stated as the requirement states it. Restated here
// rather than read from the source on purpose, and for the same reason
// INTERACTION_FIELDS above is: this list is the *requirement*, and a harness that
// read it from the module under test would pass whatever that module happened to
// declare. The exported COMBAT_DIAGNOSTIC_FIELDS is then checked against it, so a
// field added to one and not the other is caught rather than averaged (T042).
const COMBAT_FIELDS = [
  'weapon',
  'ammo',
  'health',
  'score',
  'shotsFired',
  'hits',
  'kills',
  'pickupsCollected',
  'pickupsTotal',
  'treasureFound',
  'treasureTotal',
  'dead',
  'deaths',
  'restarts',
  'muzzleFlash',
  'hudReady',
];

/** The 001-006 diagnostics contracts, each read from the interface that declares
 *  it, so "no existing field renamed, removed or repurposed" is checked against
 *  the shapes those specs actually shipped rather than against a list this file
 *  would have to be trusted to keep current (T042, US4-S10). */
function diagnosticsContract(root) {
  const read = (file) => readFileSync(resolve(root, file), 'utf8');
  const groups = [
    { label: '__diag', path: ['__diag'], file: 'src/diag/diag.ts', name: 'Diagnostics' },
    { label: '__diag.player', path: ['__diag', 'player'], file: 'src/player/diag-player.ts', name: 'PlayerDiagnostics' },
    { label: '__diag.interaction', path: ['__diag', 'interaction'], file: 'src/interaction/interaction-diag.ts', name: 'InteractionDiagnostics' },
    { label: '__diag.combat', path: ['__diag', 'combat'], file: 'src/combat/combat-diag.ts', name: 'CombatDiagnostics' },
  ];
  const contract = [];
  for (const group of groups) {
    const fields = interfaceFields(read(group.file), group.name);
    if (fields == null || fields.length === 0) return null;
    contract.push({ label: group.label, path: group.path, fields });
  }
  return contract;
}

/** The declared `COMBAT_DIAGNOSTIC_FIELDS`, so the module's own list and FR-018's
 *  can be held against each other. */
function declaredCombatFields(root) {
  const block = readFileSync(resolve(root, 'src/combat/combat-diag.ts'), 'utf8').match(
    /COMBAT_DIAGNOSTIC_FIELDS[^=]*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  if (block == null) return null;
  return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
}

/** The restart-exempt set US2 exports, read rather than restated (T041, SC-002). */
function declaredExemptFields(root) {
  const block = readFileSync(resolve(root, 'src/combat/restart.ts'), 'utf8').match(
    /RESTART_EXEMPT_FIELDS[^=]*=\s*\[([\s\S]*?)\n\];/,
  );
  if (block == null) return null;
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * The full-loop pass (T040, T041, T042; FR-018, FR-019, SC-001, SC-002, SC-006).
 * One run of the built page, driven through everything 007 added: every weapon
 * fired, a guard killed by a ray from the camera centre, one pickup of each kind
 * collected, health walked down the declared portrait bands to zero, and a restart
 * whose result is compared to the first frame field for field. Every failure names
 * the step it happened in.
 */
async function runCombatLoopPass(browser, url, root) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  let step = 'load';
  page.on('pageerror', (error) => errors.push(`combat loop: pageerror: ${error.message}`));
  const fail = (message) => errors.push(`combat loop step '${step}': ${message}`);
  const claim = (ok, message) => {
    if (!ok) fail(message);
  };
  const finish = async () => {
    await context.close();
    return errors;
  };

  const markers = readMarkers(root);
  const bands = readHealthBands(root);
  const decayText = readDeclared(root, 'src/hud/flash.ts', /MUZZLE_FLASH_DECAY_SECONDS\s*=\s*([\d.]+)/);
  const contract = diagnosticsContract(root);
  const declaredFields = declaredCombatFields(root);
  const declaredExempt = declaredExemptFields(root);
  if (markers == null || bands == null || decayText == null || contract == null || declaredFields == null || declaredExempt == null) {
    fail('a declared table could not be read from its own module: ITEM_SPAWNS, HEALTH_BANDS, MUZZLE_FLASH_DECAY_SECONDS, the diagnostics interfaces, COMBAT_DIAGNOSTIC_FIELDS or RESTART_EXEMPT_FIELDS');
    return finish();
  }
  const decaySeconds = Number(decayText);

  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(
      () =>
        window.__diag != null &&
        window.__diag.combat != null &&
        window.__diag.combat.hudReady === true &&
        window.__diag.player != null &&
        window.__diag.interaction != null &&
        window.__hud != null &&
        window.__combat != null &&
        typeof window.__playerDrive === 'function' &&
        typeof window.__enemySprites?.orbit === 'function',
      { timeout: 20000 },
    );
  } catch (error) {
    fail(`hudReady and the scripted seams did not appear within 20 seconds (${error})`);
    return finish();
  }
  await installLoopDrive(page);

  // --- T042: the contract, before anything is driven through it. -------------
  step = 'the __diag contract';
  const spawn = await combatState(page);
  claim(spawn.hudReady === true, 'hudReady is not true after the first frame (US4-S2)');
  claim(spawn.muzzleFlash === 0, `muzzleFlash is ${spawn.muzzleFlash} before a shot has been fired`);
  claim(spawn.drawCalls < 20, `drawCalls ${spawn.drawCalls} is not below 20 with the HUD and view-model drawn`);

  const missingFromDeclared = COMBAT_FIELDS.filter((field) => !declaredFields.includes(field));
  const extraInDeclared = declaredFields.filter((field) => !COMBAT_FIELDS.includes(field));
  claim(
    missingFromDeclared.length === 0,
    `COMBAT_DIAGNOSTIC_FIELDS is missing FR-018 fields: ${missingFromDeclared.join(', ')}`,
  );
  claim(
    extraInDeclared.length === 0,
    `COMBAT_DIAGNOSTIC_FIELDS declares fields FR-018 does not: ${extraInDeclared.join(', ')}`,
  );

  const contractProblems = await page.evaluate((groups) => {
    const problems = [];
    const kindOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
    const family = (declared) =>
      declared.includes('[]')
        ? 'array'
        : declared === 'number' || declared === 'boolean' || declared === 'string'
          ? declared
          : null;
    for (const group of groups) {
      const target = group.path.reduce((held, key) => (held == null ? held : held[key]), window);
      if (target == null) {
        problems.push(`${group.label} is missing entirely`);
        continue;
      }
      for (const field of group.fields) {
        if (!(field.name in target)) {
          problems.push(`${group.label}.${field.name} is absent: a declared field was renamed or removed`);
          continue;
        }
        const wanted = family(field.type);
        if (wanted == null) continue;
        const got = kindOf(target[field.name]);
        if (got !== wanted) {
          problems.push(
            `${group.label}.${field.name} is a ${got} where its declaration says ${field.type}: the field was repurposed`,
          );
        }
      }
    }
    return problems;
  }, contract);
  errors.push(...contractProblems.map((message) => `combat loop step '${step}': ${message}`));

  for (const field of COMBAT_FIELDS) {
    claim(
      Object.prototype.hasOwnProperty.call(spawn, field),
      `__diag.combat is missing the FR-018 field '${field}'`,
    );
  }
  for (const kind of ['pistol', 'smg', 'chaingun']) {
    claim(
      typeof spawn.ammo?.[kind] === 'number',
      `__diag.combat.ammo.${kind} is ${JSON.stringify(spawn.ammo?.[kind])}, not a number`,
    );
  }
  claim(typeof spawn.weapon === 'string', `__diag.combat.weapon is ${JSON.stringify(spawn.weapon)}`);

  // The view-model's rest pose, which every shot below has to come back to.
  const spawnView = await viewModelPose(page);
  if (spawnView == null) {
    fail('window.__hud.viewModel() is null: the weapon view-model was never built');
    return finish();
  }
  const atRest = (pose) =>
    pose.x === spawnView.rest.x && pose.y === spawnView.rest.y && pose.z === spawnView.rest.z;
  claim(
    atRest(spawnView.pose),
    `the view-model starts at ${JSON.stringify(spawnView.pose)}, not its declared rest ${JSON.stringify(spawnView.rest)}`,
  );
  claim(spawnView.pose.flashVisible === false, 'the muzzle flash is drawn before a shot has been fired');

  // --- T040: fire every weapon. ---------------------------------------------
  step = 'fire every weapon';
  for (const kind of ['pistol', 'smg', 'chaingun']) {
    const active = await select(page, kind);
    claim(active === kind, `selecting ${kind} left the active weapon at ${active}`);

    const shot = await fireOnce(page);
    claim(shot.fired, `holding fire with the ${kind} resolved no shot`);
    claim(
      shot.after.shots > shot.before.shots,
      `the ${kind} left shotsFired at ${shot.after.shots}`,
    );
    claim(
      shot.after.ammo[kind] < shot.before.ammo[kind],
      `firing the ${kind} spent no ammo: ${shot.before.ammo[kind]} -> ${shot.after.ammo[kind]}`,
    );
    // US4-S6 and SC-006 together: the flash is lit on a firing frame, and the
    // budget holds with the HUD, the view-model and the flash all rendering.
    claim(shot.peakFlash > 0, `no muzzle flash on the frame the ${kind}'s shot resolved`);
    claim(
      shot.peakDrawCalls > 0 && shot.peakDrawCalls < 20,
      `drawCalls peaked at ${shot.peakDrawCalls} while firing the ${kind}, with the HUD and the view-model drawn`,
    );
    claim(
      shot.peakFlash === 0 || shot.drawCallsWhenLit < 20,
      `drawCalls ${shot.drawCallsWhenLit} on the frame the ${kind}'s muzzle flash was brightest, with the HUD, the view-model and the flash all rendering`,
    );

    // US4-S6's other half: the view-model plays its fire motion on that frame.
    claim(
      shot.poseWhenLit != null && shot.poseWhenLit.pose.z > spawnView.rest.z,
      `the ${kind}'s view-model did not kick back on the firing frame: ${JSON.stringify(shot.poseWhenLit?.pose)}`,
    );
    claim(
      shot.poseWhenLit != null && shot.poseWhenLit.pose.y < spawnView.rest.y,
      `the ${kind}'s view-model did not drop on the firing frame: ${JSON.stringify(shot.poseWhenLit?.pose)}`,
    );
    claim(
      shot.poseWhenLit?.pose.flashVisible === true,
      `the muzzle flash was not drawn on the frame the ${kind}'s shot resolved`,
    );

    // US4-S7: no shot for longer than the declared decay, and the flash is out.
    const rested = await rest(page, decaySeconds * 3);
    claim(
      rested.muzzleFlash === 0,
      `muzzleFlash is ${rested.muzzleFlash} after ${(decaySeconds * 3).toFixed(2)}s with no shot, not exactly zero`,
    );
    // ...and so is the view-model, at exactly the pose it started from.
    claim(
      rested.viewModel != null && atRest(rested.viewModel.pose),
      `the ${kind}'s view-model settled at ${JSON.stringify(rested.viewModel?.pose)}, not its declared rest ${JSON.stringify(spawnView.rest)}`,
    );
    claim(
      rested.viewModel?.pose.pitch === spawnView.pose.pitch,
      `the ${kind}'s view-model settled at pitch ${rested.viewModel?.pose.pitch}, not the ${spawnView.pose.pitch} it started at`,
    );
    claim(
      rested.viewModel?.pose.flashVisible === false,
      `the muzzle flash is still drawn ${(decaySeconds * 3).toFixed(2)}s after the ${kind}'s last shot`,
    );
  }

  // --- US4-S2 / US4-S3: the HUD shows the state, within one frame. -----------
  step = 'the HUD reads live state';
  const shown = await hudWithinOneFrame(page, 7);
  if (shown.drawn == null) {
    fail('window.__hud.drawn() is null after the HUD has composited');
    return finish();
  }
  claim(
    shown.drawn.health === shown.live.health,
    `the HUD composited health ${shown.drawn.health} while the state says ${shown.live.health}`,
  );
  claim(
    shown.drawn.weapon === shown.live.weapon,
    `the HUD composited weapon ${shown.drawn.weapon} while the state says ${shown.live.weapon}`,
  );
  claim(
    shown.drawn.ammo === shown.live.ammo,
    `the HUD composited ammo ${shown.drawn.ammo} while the state says ${shown.live.ammo}`,
  );
  claim(
    shown.drawn.score === shown.live.score,
    `the HUD composited score ${shown.drawn.score} while the state says ${shown.live.score}`,
  );
  claim(
    shown.drawn.keys.silver === shown.live.keys.silver && shown.drawn.keys.gold === shown.live.keys.gold,
    `the HUD composited keys ${JSON.stringify(shown.drawn.keys)} while the state says ${JSON.stringify(shown.live.keys)}`,
  );
  claim(
    shown.composites.after > shown.composites.before,
    'the HUD canvas was not recomposited on the frame after health changed',
  );

  // --- T040: hit a guard, with the ray leaving the camera centre. ------------
  step = 'hit and kill a guard';
  const guardCount = await page.evaluate(() => window.__diag.enemies.length);
  claim(guardCount > 0, 'the level published no guards to shoot at');
  await select(page, 'smg');
  const fight = await killOne(page, guardCount);
  claim(fight.hits > 0, 'no shot reached a guard, though the camera was stood in front of one');
  claim(fight.kills > 0, `${fight.hits} shots reached a guard and none of them killed it`);

  // --- T040: one pickup of each declared kind. -------------------------------
  step = 'collect one pickup of each kind';
  const nearestTo = (kind, x, z) =>
    markers
      .filter((marker) => marker.kind === kind)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];

  const collectAt = async (marker) => {
    await walkTo(page, marker.x + 0.5, marker.z + 0.5);
    await frames(page, 2);
    return combatState(page);
  };

  const beforePickups = await combatState(page);
  const treasure = nearestTo('treasure', beforePickups.x, beforePickups.z);
  const gotTreasure = await collectAt(treasure);
  claim(
    gotTreasure.treasureFound > beforePickups.treasureFound,
    `walking onto the treasure at (${treasure.x}, ${treasure.z}) collected nothing`,
  );

  const ammoMarker = nearestTo('ammo', gotTreasure.x, gotTreasure.z);
  const gotAmmo = await collectAt(ammoMarker);
  claim(
    gotAmmo.pickupsCollected > gotTreasure.pickupsCollected,
    `walking onto the ammo at (${ammoMarker.x}, ${ammoMarker.z}) collected nothing`,
  );

  // Wounded first: a health pickup is refused at full health by design (US3-S6).
  await page.evaluate(() => window.__combat.damage(Math.max(1, window.__diag.combat.health / 2)));
  const wounded = await combatState(page);
  const healthMarker = nearestTo('health', wounded.x, wounded.z);
  const gotHealth = await collectAt(healthMarker);
  claim(
    gotHealth.pickupsCollected > gotAmmo.pickupsCollected,
    `walking onto the health at (${healthMarker.x}, ${healthMarker.z}) collected nothing`,
  );
  claim(gotHealth.health > wounded.health, 'the health pickup restored nothing');

  // The keys are both in the centre room, reached through the unlocked door at
  // (10, 21) and then east along row 31 -- the route the locked-door pass walks.
  await walkTo(page, 10.5, 20.5);
  await interact(page);
  try {
    await page.waitForFunction(() => window.__diag.interaction.doorsOpen >= 1, { timeout: 8000 });
  } catch {
    /* reported by the key claims below */
  }
  await walkTo(page, 10.5, 31.5);
  await walkTo(page, 21.5, 31.5);
  const silver = markers.find((marker) => marker.kind === 'silver-key');
  const gold = markers.find((marker) => marker.kind === 'gold-key');
  claim(silver != null && gold != null, 'the level declares no silver or gold key marker');
  const gotSilver = silver == null ? gotHealth : await collectAt(silver);
  claim(gotSilver.keys.silver === 1, `the silver key was not collected: keys.silver=${gotSilver.keys.silver}`);
  const gotGold = gold == null ? gotSilver : await collectAt(gold);
  claim(gotGold.keys.gold === 1, `the gold key was not collected: keys.gold=${gotGold.keys.gold}`);
  claim(
    gotGold.pickupsCollected >= 4,
    `only ${gotGold.pickupsCollected} pickups were collected across all five kinds`,
  );

  // --- FR-011 / SC-001: restart mid-run, so the band walk below starts from a
  // full magazine and full health. The guards fire from the moment the page
  // loads, and a ladder walked from whatever they left would never reach its top
  // rungs -- which would make the healthiest portraits untested on the page.
  step = 'restart in the middle of the run';
  const midRestart = await page.evaluate(() => {
    window.__loopSentinel = 'kept';
    window.__combat.restart();
    return window.__diag.combat.restarts;
  });
  await frames(page, 4);
  const revived = await combatState(page);
  claim(revived.restarts === 1, `restarts is ${revived.restarts} after the mid-run restart`);
  claim(revived.deaths === 0, `deaths is ${revived.deaths} before anything has died`);
  claim(revived.dead === false, 'an alive restart entered the dead state');
  claim(revived.pickupsCollected === 0, `pickupsCollected is ${revived.pickupsCollected} after a restart`);
  claim(revived.keys.silver === 0 && revived.keys.gold === 0, 'the keys survived a restart');
  claim(midRestart === 0, `restarts was already ${midRestart} before the first restart was serviced`);

  // --- US4-S4: the portrait band ladder, walked down to death. ---------------
  step = 'walk the portrait bands down to zero health';
  const rungs = [];
  bands.forEach((band, index) => {
    rungs.push(band.minHealth);
    if (index + 1 < bands.length) rungs.push(band.minHealth - 0.5);
  });
  rungs.push(0);
  const readings = await walkBands(page, rungs);
  for (const reading of readings) {
    const expected = declaredPortraitIndex(bands, reading.health);
    claim(
      reading.index === expected,
      `at health ${reading.health} the HUD reported portrait ${reading.index}, but the declared bands give ${expected}`,
    );
    claim(
      reading.shownHealth === reading.health,
      `the HUD composited health ${reading.shownHealth} while the state said ${reading.health}`,
    );
  }
  claim(readings.length > 0, 'the band walk took no readings');
  // Not a vacuous pass: the ladder was actually descended, and it only ever
  // descended. The exact-threshold claim itself is `portrait.test.ts`'s; what is
  // asserted here is that the running page agrees with the same declared ladder
  // at every reading taken while walking down it.
  const observed = readings.map((reading) => reading.index);
  claim(
    new Set(observed).size >= 3,
    `the band walk only ever reported portraits ${[...new Set(observed)].join(', ')}`,
  );
  claim(
    observed.every((index, position) => position === 0 || index >= observed[position - 1]),
    `the reported portrait index did not fall monotonically with health: ${observed.join(', ')}`,
  );
  const last = readings[readings.length - 1];
  claim(last?.dead === true, 'walking health down to zero did not end the run');
  claim(
    last?.index === bands.length,
    `at zero health the HUD reported portrait ${last?.index}, not the declared death portrait ${bands.length}`,
  );

  step = 'reach zero health';
  const dead = await combatState(page);
  claim(dead.health === 0, `health is ${dead.health} at death, not 0`);
  claim(dead.dead === true, 'health reached zero without entering the dead state');
  claim(dead.deaths === 1, `deaths is ${dead.deaths} after one death`);
  claim(dead.health === 0 && dead.dead, 'the run did not actually reach zero health');
  claim(dead.hudReady === true, 'hudReady went false once the run ended');

  // US4-S7 on the live page: the trigger is held, no shot resolves, nothing lights.
  const held = await holdWithoutFiring(page, 45);
  claim(held.movedTo === held.shots, `firing resolved while dead: ${held.shots} -> ${held.movedTo}`);
  claim(
    held.peakFlash === 0,
    `the fire key lit the muzzle flash to ${held.peakFlash} with no shot resolved`,
  );

  // --- T041: restart, and the snapshot it is judged by. ----------------------
  step = 'restart';
  await page.evaluate(() => window.__combat.restart());
  await frames(page, 4);
  claim(
    (await page.evaluate(() => window.__loopSentinel)) === 'kept',
    'the page reloaded on restart: the sentinel did not survive',
  );
  const restarted = await combatState(page);
  claim(restarted.dead === false, 'the run is still dead after a restart');
  claim(restarted.restarts === 2, `restarts is ${restarted.restarts} after two restarts`);
  claim(restarted.deaths === 1, `deaths is ${restarted.deaths} after a restart, and should survive as 1`);
  claim(restarted.muzzleFlash === 0, `muzzleFlash is ${restarted.muzzleFlash} after a restart`);
  claim(restarted.hudReady === true, 'hudReady went false across a restart');
  claim(restarted.drawCalls < 20, `drawCalls ${restarted.drawCalls} after a restart is not below 20`);

  step = 'the post-restart snapshot';
  const pageExempt = await page.evaluate(() => [...window.__combat.exempt()]);
  claim(
    JSON.stringify([...pageExempt].sort()) === JSON.stringify([...declaredExempt].sort()),
    `the page's exempt set ${JSON.stringify(pageExempt)} is not RESTART_EXEMPT_FIELDS ${JSON.stringify(declaredExempt)}`,
  );
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
    `the post-restart snapshot differs from the first-frame snapshot at: ${(offending ?? []).join(', ')}`,
  );

  step = 'the HUD after the restart';
  const after = await hudWithinOneFrame(page, 0);
  claim(after.drawn != null, 'window.__hud.drawn() is null after a restart');
  claim(
    after.drawn?.health === after.live.health && after.drawn?.score === after.live.score,
    `the HUD composited ${JSON.stringify(after.drawn)} while the state says ${JSON.stringify(after.live)}`,
  );
  claim(
    after.drawn?.keys.silver === 0 && after.drawn?.keys.gold === 0,
    `the HUD still shows keys ${JSON.stringify(after.drawn?.keys)} after a restart`,
  );

  step = 'the page reported no errors';
  const finalErrors = await page.evaluate(() => [...window.__diag.errors]);
  claim(finalErrors.length === 0, `__diag.errors: ${finalErrors.join(' | ')}`);

  if (errors.length === 0) {
    console.log(
      `  combat loop: ${gotGold.shotsFired} shots before the mid-run restart, ${fight.hits} of them on a guard, ` +
        `${fight.kills} killed, ${gotGold.pickupsCollected}/${gotGold.pickupsTotal} pickups ` +
        `(silver+gold keys included), portraits ${[...new Set(observed)].join('>')}, ` +
        `deaths ${restarted.deaths}, restarts ${restarted.restarts}`,
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
  const browserPath = resolveBrowser();
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
      for (const error of combatLoop) {
        console.error(error);
      }
      fail('Combat loop smoke pass failed');
    }
    console.log(
      'Combat loop smoke pass: every weapon fired, a guard killed, one pickup of each kind ' +
        'collected, the portrait bands walked to zero, restarted clean',
    );

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
