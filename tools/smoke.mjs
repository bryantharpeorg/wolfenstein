#!/usr/bin/env node
import { existsSync } from 'node:fs';
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
      return { ready: false, renderer: null, fps: 0, frameTimeMs: 0, drawCalls: 0, errors: ['window.__diag is undefined'] };
    }
    return {
      ready: d.ready,
      renderer: d.renderer,
      fps: d.fps,
      frameTimeMs: d.frameTimeMs,
      drawCalls: d.drawCalls,
      errors: d.errors,
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

async function main() {
  const args = process.argv.slice(2);
  const injectError = args.includes('--inject-error');

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

    const normal = await runSmokePass(browser, url, null, { expectRenderer: null });
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
