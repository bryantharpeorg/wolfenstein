// The two things every harness in this repository needs before it can drive the built
// page: a loopback static server over `dist/`, and a Chromium to point at it.
//
// Extracted from `tools/smoke.mjs` (009 T001) when `tools/play.mjs` became its second
// caller. `resolveBrowser` in particular carries knowledge that was expensive to acquire —
// 008 T022 replaced version-stamped paths with a bounded walk after a cache bump left the
// gate failing beside a browser it had — and a second copy of it would drift from this one
// the first time that cache layout changes again.
//
// Nothing here exits the process. `resolveBrowser` throws `BrowserResolutionError` and the
// caller decides what a missing browser means: the gate fails, and the playtest runner has
// its own message to print first.

import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The repository root, one level above `tools/`. */
export const ROOT = resolve(__dirname, '..');

/** The build output both harnesses serve. */
export const DIST = resolve(ROOT, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Raised when no Chromium can be found. Named so a caller can tell "no browser" from
 *  "the browser failed", which are different failures with different remedies. */
export class BrowserResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowserResolutionError';
  }
}

/**
 * Serves `root` over loopback on an ephemeral port. Resolves to `{ server, url }`; the
 * caller closes the server. A path escaping `root` is refused with 403 rather than served.
 */
export function startServer(root = DIST) {
  return new Promise((start, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = url.pathname;
      if (path === '/') path = '/index.html';
      const filePath = resolve(root, path.slice(1));
      if (!filePath.startsWith(root)) {
        console.error(`403 for ${path} -> ${filePath} (outside ${root})`);
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

// The first Chromium executable under `root`, or null. Bounded to the two levels a browser
// cache uses -- `<root>/<build>/<platform-dir>/<exe>` -- so a wrong PLAYWRIGHT_BROWSERS_PATH
// fails fast instead of walking a filesystem (008 T022).
export function findChromiumUnder(root) {
  const directories = (at) => (existsSync(at)
    ? readdirSync(at, { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => resolve(at, e.name)).sort() : []);
  for (const build of directories(root).filter((path) => /\/chromium/.test(path))) {
    for (const directory of [build, ...directories(build)]) {
      for (const name of ['chrome', 'chrome-headless-shell', 'headless_shell']) {
        if (existsSync(resolve(directory, name))) return resolve(directory, name);
      }
    }
  }
  return null;
}

/**
 * The Chromium to drive: `CHROME_PATH` if set, else a bounded walk of
 * `PLAYWRIGHT_BROWSERS_PATH`, else Playwright's own cache. Never downloads and never
 * skips — a missing browser throws `BrowserResolutionError` rather than degrading to a
 * pass, because a harness that quietly does not run is worse than one that fails.
 */
export function resolveBrowser() {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    if (!existsSync(chromePath)) {
      throw new BrowserResolutionError(
        `Missing browser: CHROME_PATH points to ${chromePath}, which does not exist.`,
      );
    }
    return chromePath;
  }

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    // Discovered rather than guessed (008 T022): a cache is named for the build it holds,
    // so literal paths are build numbers this file has to be reopened to bump, failing
    // with "no Chromium here" beside a directory that has one. Never downloads, never skips.
    const found = findChromiumUnder(browsersPath);
    if (found != null) return found;
    throw new BrowserResolutionError(
      `Missing browser: PLAYWRIGHT_BROWSERS_PATH=${browsersPath} does not contain a Chromium executable.`,
    );
  }

  // Let Playwright resolve from its default cache. If it resolves a path, verify it
  // exists; otherwise fail with a clear message rather than attempting a download.
  try {
    const path = chromium.executablePath();
    if (!existsSync(path)) {
      throw new BrowserResolutionError(
        `Missing browser: Playwright resolved ${path} but it does not exist. Set CHROME_PATH or PLAYWRIGHT_BROWSERS_PATH to a valid Chromium.`,
      );
    }
    return path;
  } catch (error) {
    if (error instanceof BrowserResolutionError) throw error;
    throw new BrowserResolutionError(
      `Missing browser: no CHROME_PATH or PLAYWRIGHT_BROWSERS_PATH set, and Playwright cannot find a cached Chromium (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}
