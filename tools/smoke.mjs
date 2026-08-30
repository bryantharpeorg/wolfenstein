import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { walkAndReport } from './check-no-binaries.mjs';
import { SMOKE_FPS_FLOOR } from './smoke-floor.mjs';

const root = resolve(import.meta.dirname, '..');
const distDir = resolve(root, 'dist');
const indexHtml = resolve(distDir, 'index.html');

const READY_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 10_000;
const FALLBACK_PORT = 4173;

/**
 * @typedef {object} RunOptions
 * @property {string} [executablePath]
 * @property {boolean} [deleteGpu]
 * @property {boolean} [injectError]
 * @property {number} [port]
 */

/**
 * @param {string} label
 * @param {RunOptions} options
 */
async function runSmokePass(label, options) {
  const server = await startPreviewServer(options.port ?? FALLBACK_PORT);
  const url = new URL(`http://127.0.0.1:${server.port}/index.html`);
  if (options.injectError) {
    url.searchParams.set('smoke-inject-error', '1');
  }

  let browser;
  let context;
  let page;

  try {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (options.executablePath) {
      launchOptions.executablePath = options.executablePath;
    }

    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();

    if (options.deleteGpu) {
      await context.addInitScript(() => {
        // @ts-ignore
        delete navigator.gpu;
        // @ts-ignore
        window.__expectedBackend = 'webgl';
      });
    } else {
      await context.addInitScript(() => {
        // @ts-ignore
        if (navigator.gpu != null) {
          // Playwright contexts that report navigator.gpu may still fail to
          // requestAdapter in headless Chromium, so the app may fall back to
          // webgl. Record the real answer by probing, and let the assertion
          // compare against whatever the app actually selected.
          if (typeof navigator.gpu.requestAdapter === 'function') {
            navigator.gpu
              .requestAdapter()
              .then((adapter) => {
                window.__expectedBackend = adapter != null ? 'webgpu' : 'webgl';
              })
              .catch(() => {
                window.__expectedBackend = 'webgl';
              });
          } else {
            window.__expectedBackend = 'webgl';
          }
        } else {
          window.__expectedBackend = 'webgl';
        }
      });
    }

    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(READY_TIMEOUT_MS);

    // Browsers ask for /favicon.ico automatically; the preview server returns
    // 404 and Playwright reports it as a page error. Ignore it during the run.
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));

    const consoleMessages = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });

    // For the self-test, we do not wait for ready; we wait a moment and read errors.
    if (options.injectError) {
      await sleep(1_000);
      const diag = await page.evaluate(() => window.__diag).catch(() => null);
      const captured = [
        ...(diag?.errors ?? []),
        ...consoleMessages,
        ...pageErrors,
      ];
      if (!captured.some((m) => m.includes('deliberate smoke error'))) {
        throw new Error(
          `self-test: expected injected startup error in captured output, got: ${JSON.stringify(captured)}`,
        );
      }
      throw new Error(`self-test: captured injected error: ${captured.join('; ')}`);
    }

    const start = performance.now();
    let diag;
    while (true) {
      diag = await page.evaluate(() => window.__diag);
      if (diag?.ready) break;
      if (performance.now() - start > READY_TIMEOUT_MS) {
        throw new Error(`${label}: window.__diag.ready stayed false for ${READY_TIMEOUT_MS}ms`);
      }
      await sleep(250);
    }

    // Let a few more frames tick so fps/drawCalls have real samples, and the
    // asynchronous GPU adapter probe from addInitScript has finished.
    await sleep(1_000);
    diag = await page.evaluate(() => window.__diag);

    const expectedBackend = await page.evaluate(() => {
      if (window.__expectedBackend == null) return 'webgl';
      return window.__expectedBackend;
    });
    assertDiag(label, diag, expectedBackend, consoleMessages, pageErrors);

    // Scenario 6: viewport resize updates the drawing buffer within one frame.
    await page.setViewportSize({ width: 640, height: 480 });
    await sleep(100);
    const canvasSize = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    if (canvasSize && (canvasSize.width !== 640 || canvasSize.height !== 480)) {
      throw new Error(
        `${label}: drawing buffer did not match resized viewport: ${JSON.stringify(canvasSize)}`,
      );
    }
    const postResizeDiag = await page.evaluate(() => window.__diag);
    if (postResizeDiag.errors.length > 0) {
      throw new Error(`${label}: errors recorded after resize: ${postResizeDiag.errors.join('; ')}`);
    }

    // Scenario 7: overlay toggle key hides/shows and __diag keeps updating.
    const initialDisplay = await page.evaluate(() => {
      const el = document.getElementById('perf-overlay');
      return el ? el.style.display : null;
    });
    await page.keyboard.press('F1');
    await sleep(50);
    const hiddenDisplay = await page.evaluate(() => {
      const el = document.getElementById('perf-overlay');
      return el ? el.style.display : null;
    });
    await page.keyboard.press('F1');
    await sleep(50);
    const shownDisplay = await page.evaluate(() => {
      const el = document.getElementById('perf-overlay');
      return el ? el.style.display : null;
    });

    if (initialDisplay === 'none') {
      // Production builds start hidden; the key should still toggle it.
      if (hiddenDisplay !== 'block' || shownDisplay !== 'none') {
        throw new Error(`${label}: overlay did not toggle from hidden (got ${hiddenDisplay}, ${shownDisplay})`);
      }
    } else {
      if (hiddenDisplay !== 'none' || shownDisplay !== 'block') {
        throw new Error(`${label}: overlay did not toggle (got ${hiddenDisplay}, ${shownDisplay})`);
      }
    }

    const postToggleDiag = await page.evaluate(() => window.__diag);
    if (postToggleDiag.errors.length > 0) {
      throw new Error(`${label}: errors recorded after overlay toggle: ${postToggleDiag.errors.join('; ')}`);
    }
    if (!postToggleDiag.ready) {
      throw new Error(`${label}: __diag stopped updating after overlay toggle`);
    }

    return diag;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    server.process.kill('SIGTERM');
    await new Promise((resolve) => server.process.once('exit', resolve));
    await sleep(100);
  }
}

function assertDiag(label, diag, expectedBackend, consoleMessages, pageErrors) {
  if (diag == null) {
    throw new Error(`${label}: window.__diag is missing`);
  }

  const captured = [...consoleMessages, ...pageErrors];

  const requiredFields = ['ready', 'renderer', 'fps', 'frameTimeMs', 'drawCalls', 'errors'];
  for (const field of requiredFields) {
    if (!(field in diag)) {
      throw new Error(`${label}: window.__diag missing field ${field}`);
    }
  }

  if (!diag.ready) {
    throw new Error(`${label}: window.__diag.ready is false`);
  }

  if (diag.renderer !== 'webgpu' && diag.renderer !== 'webgl') {
    throw new Error(`${label}: window.__diag.renderer is ${diag.renderer}, expected webgpu or webgl`);
  }

  if (diag.renderer !== expectedBackend) {
    throw new Error(
      `${label}: window.__diag.renderer is ${diag.renderer}, expected ${expectedBackend}`,
    );
  }

  if (diag.fps <= SMOKE_FPS_FLOOR) {
    throw new Error(`${label}: window.__diag.fps (${diag.fps}) did not exceed floor ${SMOKE_FPS_FLOOR}`);
  }

  if (!Number.isInteger(diag.drawCalls)) {
    throw new Error(`${label}: window.__diag.drawCalls (${diag.drawCalls}) is not an integer`);
  }

  if (diag.errors.length > 0 || captured.length > 0) {
    throw new Error(
      `${label}: errors recorded: ${[...diag.errors, ...captured].join('; ')}`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPreviewServer(port) {
  // Use node directly to run the local vite binary. Spawning via npx leaves the
  // npx process in front; SIGTERM reaches npx, which may not forward it to the
  // child promptly and leaves the vite server holding the port.
  const proc = spawn('node', [
    resolve(root, 'node_modules/.bin/vite'),
    'preview',
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none' },
  });

  let output = '';
  proc.stdout.on('data', (data) => {
    output += data.toString();
  });
  proc.stderr.on('data', (data) => {
    output += data.toString();
  });

  let exitHandler = null;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`preview server did not start in time\n${output}`));
    }, 15_000);
    exitHandler = (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`preview server exited ${code}\n${output}`));
      }
    };
    proc.on('exit', exitHandler);

    const check = () => {
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        proc.off('exit', exitHandler);
        resolve({ process: proc, port: Number(match[1]) });
        return;
      }
      setTimeout(check, 100);
    };
    check();

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function findBrowserExecutable() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH points to a missing browser: ${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }

  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const chromeDir = findChromeDir(base);
    if (chromeDir) {
      const candidate = join(chromeDir, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
    const headlessDir = findHeadlessDir(base);
    if (headlessDir) {
      const candidate = join(headlessDir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(
      `PLAYWRIGHT_BROWSERS_PATH=${base} does not contain a Chromium installation`,
    );
  }

  return undefined;
}

function findChromeDir(base) {
  try {
    const entries = readdirSync(base);
    for (const entry of entries) {
      if (entry.startsWith('chromium-') && !entry.startsWith('chromium_headless_shell-')) {
        const full = join(base, entry);
        if (statSync(full).isDirectory()) return full;
      }
    }
  } catch {}
  return undefined;
}

function findHeadlessDir(base) {
  try {
    const entries = readdirSync(base);
    for (const entry of entries) {
      if (entry.startsWith('chromium_headless_shell-')) {
        const full = join(base, entry);
        if (statSync(full).isDirectory()) return full;
      }
    }
  } catch {}
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const injectError = args.includes('--inject-error') || args.includes('--self-test');

  // Build the page first so the smoke harness always tests the built artifact.
  const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  const buildExit = await new Promise((resolve) => build.on('exit', resolve));
  if (buildExit !== 0) {
    process.exit(buildExit ?? 1);
  }

  const findings = walkAndReport(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    process.exit(1);
  }

  if (!existsSync(indexHtml)) {
    console.error(`missing:${indexHtml}`);
    process.exit(1);
  }

  let executablePath;
  try {
    executablePath = findBrowserExecutable();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (injectError) {
    console.log('Smoke self-test: injecting startup exception...');
    try {
      await runSmokePass('self-test', { executablePath, injectError: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('deliberate smoke error')) {
        console.error(`Smoke self-test FAILED with unexpected error: ${message}`);
        process.exit(1);
      }
      console.error(`Smoke self-test: captured expected error: ${message}`);
      process.exit(1);
    }
    console.error('Smoke self-test FAILED: expected the injected error to fail the run');
    process.exit(1);
  }

  try {
    const normal = await runSmokePass('normal', { executablePath });
    console.log(
      `Normal smoke passed: renderer=${normal.renderer}, fps=${normal.fps.toFixed(1)}, drawCalls=${normal.drawCalls}`,
    );

    const noGpu = await runSmokePass('no-gpu', { executablePath, deleteGpu: true });
    console.log(
      `No-GPU smoke passed: renderer=${noGpu.renderer}, fps=${noGpu.fps.toFixed(1)}, drawCalls=${noGpu.drawCalls}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Smoke failed: ${message}`);
    process.exit(1);
  }

  console.log('All smoke checks passed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
