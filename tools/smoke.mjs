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
      return { ready: false, renderer: null, fps: 0, frameTimeMs: 0, drawCalls: 0, errors: ['window.__diag is undefined'], level: null };
    }
    return {
      ready: d.ready,
      renderer: d.renderer,
      fps: d.fps,
      frameTimeMs: d.frameTimeMs,
      drawCalls: d.drawCalls,
      errors: d.errors,
      level: d.level,
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

  if (result.diag.drawCalls >= 20) {
    errors.push(`drawCalls ${result.diag.drawCalls} is not below 20`);
  }

  const stability = await sampleLevelTwice(page);
  if (stability.first.level !== stability.second.level) {
    errors.push('__diag.level changed between two reads 120 frames apart');
  }
  if (stability.first.fps === stability.second.fps) {
    errors.push('fps did not change between two reads 120 frames apart');
  }
  if (stability.first.frameTimeMs === stability.second.frameTimeMs) {
    errors.push('frameTimeMs did not change between two reads 120 frames apart');
  }

  await context.close();
  return { diag: result.diag, errors };
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

  const expectedCounts = recomputeCounts(readLevelGrid());

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
