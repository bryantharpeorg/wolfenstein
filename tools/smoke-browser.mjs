// Browser resolution for the smoke gate (T022). Split out of `tools/smoke.mjs`, which
// is well past Constitution IV's 400-line ceiling, so extending the resolution shrinks
// that file rather than growing it.
//
// The one rule this module exists to keep: it never downloads and it never skips.
// A gate that quietly installed a browser would make the machine it runs on part of the
// build, and one that skipped its assertions when it found none would report a pass it
// never made (plan.md, Complexity Tracking). Every path out of `resolveBrowser` is an
// executable that exists or a message naming what was looked for and where.

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// The executable names a Playwright Chromium build ships under, full browser first.
const CHROMIUM_EXECUTABLES = ['chrome', 'chrome-headless-shell', 'headless_shell'];

// The first Chromium executable under `root`, or null. Bounded to the two levels a
// browser cache actually uses -- `<root>/<build>/<platform-dir>/<exe>` -- so a wrong
// PLAYWRIGHT_BROWSERS_PATH fails fast instead of walking a filesystem.
function findChromiumUnder(root) {
  if (!existsSync(root)) return null;
  const builds = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium'))
    .map((entry) => resolve(root, entry.name))
    .sort();
  for (const build of builds) {
    const platforms = readdirSync(build, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(build, entry.name))
      .sort();
    for (const directory of [build, ...platforms]) {
      for (const name of CHROMIUM_EXECUTABLES) {
        const candidate = resolve(directory, name);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** The Chromium the gate runs, or a process that has already exited with a message
 *  naming what is missing. `fail` is the caller's: this module reports, it does not
 *  decide how a harness dies. */
export function resolveBrowser(fail) {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    if (!existsSync(chromePath)) {
      fail(`Missing browser: CHROME_PATH points to ${chromePath}, which does not exist.`);
    }
    return chromePath;
  }

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    // Discovered rather than guessed (T022). A browser cache is named for the build it
    // holds -- `chromium-1187`, `chromium_headless_shell-1194` -- so a list of literal
    // paths is a list of build numbers this file would have to be reopened to bump, and
    // the failure when one moved would read "no Chromium here" beside a directory that
    // has one. Every `chromium*` entry is walked instead, and only the *message* is
    // hard-coded.
    const found = findChromiumUnder(browsersPath);
    if (found != null) return found;
    fail(
      `Missing browser: PLAYWRIGHT_BROWSERS_PATH=${browsersPath} does not contain a ` +
        `Chromium executable (looked for ${CHROMIUM_EXECUTABLES.join(', ')} under every ` +
        'chromium* directory).',
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
