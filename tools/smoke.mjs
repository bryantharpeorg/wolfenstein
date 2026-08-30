import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { walkAndReport } from './check-no-binaries.mjs';
import { SMOKE_FPS_FLOOR } from './smoke-floor.mjs';

const root = resolve(import.meta.dirname, '..');
const distDir = resolve(root, 'dist');
const indexHtml = resolve(distDir, 'index.html');

const ALLOWED_BACKENDS = new Set(['webgpu', 'webgl']);
const READY_TIMEOUT_MS = 15000;
const STABLE_FRAMES = 10;
const CHROME_PATH = process.env.CHROME_PATH;
const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;

function fail(message, logs = []) {
  console.error(`smoke failed: ${message}`);
  for (const line of logs) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

function checkDist() {
  if (!existsSync(indexHtml)) {
    fail(`missing:${indexHtml}`);
  }
}

function resolveBrowserExecutable() {
  if (CHROME_PATH != null) {
    return CHROME_PATH;
  }
  return chromium.executablePath();
}

function checkBrowser() {
  const executable = resolveBrowserExecutable();
  if (!existsSync(executable)) {
    fail(
      `Chromium executable not found at ${executable}. ` +
        `Set CHROME_PATH to a chrome binary or PLAYWRIGHT_BROWSERS_PATH to a browsers directory.`,
    );
  }
}

function checkNoBinaries() {
  const findings = walkAndReport(root);
  if (findings.length > 0) {
    fail('binary assets found', findings);
  }
}

function build() {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('npm', ['run', 'build'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`build exited ${code}\n${stdout}\n${stderr}`));
      }
    });
    proc.on('error', reject);
  });
}

function startServer() {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, NODE_ENV: 'production' },
    });
    let stdout = '';
    let stderr = '';
    let url = null;
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && url == null) {
        url = `http://127.0.0.1:${match[1]}`;
        resolvePromise({ proc, url, stdout, stderr });
      }
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`preview server exited ${code}\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function runSmoke(url, logs, options = {}) {
  const { expectedBackend = null, deleteGpu = false } = options;
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
    executablePath: CHROME_PATH,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    if (deleteGpu) {
      await page.addInitScript(() => {
        delete Object.getPrototypeOf(navigator).gpu;
      });
    }

    page.on('console', (msg) => {
      const text = msg.text();
      logs.push(`console:${msg.type()}:${text}`);
    });
    page.on('pageerror', (error) => {
      logs.push(`pageerror:${error.message}`);
    });

    await page.goto(url, { waitUntil: 'networkidle' });

    const start = performance.now();
    let diag = null;
    while (performance.now() - start < READY_TIMEOUT_MS) {
      diag = await page.evaluate(() => window.__diag);
      if (diag != null && diag.ready) {
        break;
      }
      await page.waitForTimeout(100);
    }

    if (diag == null) {
      fail('window.__diag is not exposed', logs);
    }

    if (!diag.ready) {
      fail('window.__diag.ready never became true within 15 seconds', logs);
    }

    // Let the FPS reading stabilise across several frames before asserting.
    for (let i = 0; i < STABLE_FRAMES; i += 1) {
      await page.waitForTimeout(100);
      diag = await page.evaluate(() => window.__diag);
      if (diag == null || !diag.ready) {
        fail('window.__diag became unavailable or unready', logs);
      }
    }

    if (!ALLOWED_BACKENDS.has(diag.renderer)) {
      fail(`renderer ${diag.renderer} is not one of webgpu/webgl`, logs);
    }

    if (diag.fps <= SMOKE_FPS_FLOOR) {
      fail(`fps ${diag.fps} did not exceed floor ${SMOKE_FPS_FLOOR}`, logs);
    }

    if (diag.errors.length > 0) {
      fail('diag.errors is not empty', diag.errors);
    }

    if (expectedBackend != null && diag.renderer !== expectedBackend) {
      fail(`expected renderer ${expectedBackend}, got ${diag.renderer}`, logs);
    }

    // Resize the viewport and assert the drawing buffer catches up within one frame.
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(100);
    const canvasSize = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas');
      return canvas != null ? { width: canvas.width, height: canvas.height } : null;
    });
    if (canvasSize == null) {
      fail('game canvas not found after resize', logs);
    }
    if (canvasSize.width !== 800 || canvasSize.height !== 600) {
      fail(`canvas size ${canvasSize.width}x${canvasSize.height} does not match viewport`, logs);
    }

    // Toggle the overlay off and on, then assert __diag still updates.
    const beforeFps = await page.evaluate(() => window.__diag.fps);
    await page.keyboard.press('F1');
    await page.waitForTimeout(300);
    await page.keyboard.press('F1');
    await page.waitForTimeout(300);
    const afterFps = await page.evaluate(() => window.__diag.fps);
    if (afterFps <= beforeFps) {
      fail('window.__diag did not continue updating after overlay toggle', logs);
    }

    const overlayAfterToggle = await page.evaluate(() => {
      const el = document.getElementById('perf-overlay');
      return el ? { display: el.style.display } : null;
    });
    if (overlayAfterToggle == null || overlayAfterToggle.display !== 'block') {
      fail('overlay did not return to visible state after toggle', logs);
    }
  } finally {
    await browser.close();
  }
}

const SELF_TEST = process.argv.includes('--self-test');

async function runSelfTest(server) {
  // Inject a startup exception, then assert the harness sees it and exits non-zero.
  const selfTestLogs = [];
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
    executablePath: CHROME_PATH,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      (window).__smokeThrow = true;
    });

    page.on('console', (msg) => {
      selfTestLogs.push(`console:${msg.type()}:${msg.text()}`);
    });
    page.on('pageerror', (error) => {
      selfTestLogs.push(`pageerror:${error.message}`);
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const diag = await page.evaluate(() => window.__diag);
    if (diag == null) {
      fail('self-test: window.__diag is not exposed', selfTestLogs);
    }

    const expected = 'deliberate startup exception for smoke self-test';
    if (!diag.errors.some((e) => e.includes(expected))) {
      fail(
        `self-test: expected diag.errors to contain \"${expected}\", got ${JSON.stringify(diag.errors)}`,
        selfTestLogs,
      );
    }

    console.log('smoke self-test passed: startup exception captured');
  } finally {
    await browser.close();
  }
}

async function main() {
  checkDist();
  checkNoBinaries();
  checkBrowser();

  let server = null;
  const logs = [];
  try {
    await build();
    server = await startServer();

    if (SELF_TEST) {
      await runSelfTest(server);
      return;
    }

    // Pass 1: default capabilities. We cannot force WebGPU if the host lacks an
    // adapter, so this pass simply asserts the reported backend is allowed and the
    // page is healthy. The WebGPU-only path is exercised when the host has one.
    await runSmoke(server.url, logs);

    // Pass 2: navigator.gpu removed. The page must fall back to WebGL.
    const webglLogs = [];
    await runSmoke(server.url, webglLogs, { expectedBackend: 'webgl', deleteGpu: true });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), logs);
  } finally {
    if (server != null) {
      server.proc.kill('SIGTERM');
    }
  }

  console.log('smoke passed');
}

main();
