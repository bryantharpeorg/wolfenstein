import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { walkAndReport } from './check-no-binaries.mjs';
import { SMOKE_FPS_FLOOR } from './smoke-floor.mjs';

const root = resolve(import.meta.dirname, '..');
const distDir = join(root, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const args = process.argv.slice(2);
const injectStartupError = args.includes('--inject-startup-error');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function buildProject() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: root,
      stdio: 'pipe',
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`npm run build failed with exit code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

function startStaticServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      let filePath = '/';
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        filePath = decodeURIComponent(url.pathname);
        if (filePath.includes('..')) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        let resolved = join(root, filePath);
        if (filePath.endsWith('/')) {
          resolved = join(resolved, 'index.html');
        }
        // If the path is a directory without a trailing slash, serve index.html.
        try {
          const stat = await import('node:fs/promises').then((m) => m.stat(resolved));
          if (stat.isDirectory()) {
            resolved = join(resolved, 'index.html');
          }
        } catch {
          // Not a directory; continue.
        }
        const content = await readFile(resolved);
        const contentType = MIME_TYPES[extname(resolved).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (err) {
        const isFavicon = filePath === '/favicon.ico';
        if (isFavicon) {
          res.writeHead(204);
          res.end();
          return;
        }
        if (err != null && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(500);
          res.end('Internal server error');
        }
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function findPort(preferred = 4173, max = 4183) {
  for (let port = preferred; port <= max; port++) {
    try {
      const server = await startStaticServer(distDir, port);
      return server;
    } catch (err) {
      if (err != null && /** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE') {
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not find an open port between ${preferred} and ${max}`);
}

function findSystemBrowser() {
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chrome',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function getBrowserExecutablePath() {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    if (!existsSync(chromePath)) {
      throw new Error(`CHROME_PATH points to a missing browser: ${chromePath}`);
    }
    return chromePath;
  }

  const systemBrowser = findSystemBrowser();
  if (systemBrowser != null) {
    return systemBrowser;
  }

  const defaultPath = chromium.executablePath();
  if (!existsSync(defaultPath)) {
    throw new Error(
      `Missing Chromium browser at ${defaultPath}. Set CHROME_PATH to a Chromium executable or PLAYWRIGHT_BROWSERS_PATH to a browser cache.`,
    );
  }
  return undefined;
}

async function launchBrowser() {
  const executablePath = getBrowserExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,UseSkiaRenderer',
    ],
  });
  return browser;
}

async function waitForDiagnostics(page) {
  await page.waitForFunction(() => window.__diag != null, { timeout: 5000 });
  await page.waitForFunction(() => window.__diag.ready === true, { timeout: 15000 });
  await page.waitForFunction(
    (floor) => window.__diag.fps > floor,
    SMOKE_FPS_FLOOR,
    { timeout: 10000 },
  );
}

/**
 * @param {object} options
 * @param {string} options.serverUrl
 * @param {boolean} [options.deleteGpu]
 */
async function runSmokePass({ serverUrl, deleteGpu = false }) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const capturedErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      capturedErrors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    capturedErrors.push(`pageerror: ${err.message}`);
  });

  if (deleteGpu) {
    await page.addInitScript(() => {
      // Deleting the property directly does not always remove it because some Chromium
      // builds expose navigator.gpu as a non-configurable getter. Redefining it as
      // undefined forces selectBackend to see a WebGL-only environment.
      try {
        // @ts-ignore
        Object.defineProperty(navigator, 'gpu', {
          value: undefined,
          configurable: false,
          writable: false,
        });
      } catch {
        // If defineProperty also fails, fall back to delete as a last resort.
        try {
          // @ts-ignore
          delete navigator.gpu;
        } catch {
          // Nothing left to do; the pass will report whichever backend the browser chose.
        }
      }
    });
  }

  if (injectStartupError) {
    await page.addInitScript(() => {
      // @ts-ignore
      window.__smokeInjectStartupError = true;
    });
  }

  await page.goto(serverUrl, { waitUntil: 'networkidle', timeout: 15000 });

  // Give the page enough time to either fail or become ready.
  await waitForDiagnostics(page);

  const expectedBackend = await page.evaluate(() => {
    // @ts-ignore
    const hasGpu = 'gpu' in navigator && navigator.gpu != null;
    return hasGpu ? 'webgpu' : 'webgl';
  });

  const diag = await page.evaluate(() => window.__diag);

  await browser.close();

  return { diag, expectedBackend, capturedErrors };
}

async function runSelfTest(serverUrl) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const capturedErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      capturedErrors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    capturedErrors.push(`pageerror: ${err.message}`);
  });

  await page.addInitScript(() => {
    // @ts-ignore
    window.__smokeInjectStartupError = true;
  });

  await page.goto(serverUrl, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const diag = await page.evaluate(() => window.__diag).catch(() => undefined);
  await browser.close();

  const injectedMessage = 'Injected smoke self-test error';
  const allErrors = [
    ...(diag?.errors ?? []),
    ...capturedErrors,
  ];
  if (!allErrors.some((e) => e.includes(injectedMessage))) {
    throw new Error(
      `Self-test did not capture the injected startup error.\nCaptured:\n${allErrors.join('\n') || '(none)'}`,
    );
  }

  console.error(`Self-test captured expected error: ${injectedMessage}`);
  console.error(`Full captured output:\n${allErrors.join('\n')}`);
  process.exit(1);
}

async function main() {
  // FR-002 / SC-004: enforce zero binary assets before doing anything else.
  const findings = walkAndReport(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    fail('Smoke failed: binary asset check failed.');
  }

  await buildProject();

  const indexHtml = join(distDir, 'index.html');
  if (!existsSync(indexHtml)) {
    fail(`Smoke failed: dist/index.html missing after build.`);
  }

  const server = await findPort();
  try {
    if (injectStartupError) {
      await runSelfTest(server.url);
      // runSelfTest always exits, but keep the compiler happy.
      return;
    }

    const normal = await runSmokePass({ serverUrl: server.url, deleteGpu: false });
    const fallback = await runSmokePass({ serverUrl: server.url, deleteGpu: true });

    const errors = [];
    for (const [pass, label] of [
      [normal, 'normal pass'],
      [fallback, 'gpu-deleted pass'],
    ]) {
      const { diag, expectedBackend, capturedErrors } = pass;
      if (diag.renderer !== expectedBackend) {
        errors.push(
          `${label}: expected renderer "${expectedBackend}", got "${diag.renderer}"`,
        );
      }
      if (!['webgpu', 'webgl'].includes(diag.renderer)) {
        errors.push(`${label}: renderer "${diag.renderer}" is not an allowed value`);
      }
      if (diag.fps <= SMOKE_FPS_FLOOR) {
        errors.push(`${label}: fps ${diag.fps} did not exceed floor ${SMOKE_FPS_FLOOR}`);
      }
      if (diag.drawCalls <= 0) {
        errors.push(`${label}: drawCalls ${diag.drawCalls} is not positive`);
      }
      if (diag.errors.length > 0) {
        errors.push(`${label}: __diag.errors not empty:\n${diag.errors.join('\n')}`);
      }
      if (capturedErrors.length > 0) {
        errors.push(`${label}: captured page/console errors:\n${capturedErrors.join('\n')}`);
      }
    }

    if (errors.length > 0) {
      fail(`Smoke failed:\n${errors.join('\n\n')}`);
    }

    console.log(
      `Smoke passed: normal=${normal.diag.renderer} fps=${normal.diag.fps.toFixed(1)} draws=${normal.diag.drawCalls}, fallback=${fallback.diag.renderer} fps=${fallback.diag.fps.toFixed(1)} draws=${fallback.diag.drawCalls}.`,
    );
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`Smoke failed: ${err.message}`);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
