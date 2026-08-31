// The smoke-check loop (T027). A story that needs a runtime assertion adds
// `tools/smoke-checks/<name>.mjs` and edits nothing else -- the same trick
// `src/boot/discover.ts` plays on `src/main.ts`, for the same reason: two stories
// appending to one harness file conflict on adjacent lines.
//
// It lives here rather than inside `tools/smoke.mjs` because that file is already
// past the 400-line ceiling (Article IV) and this story is not the one that gets
// to split it; adding a self-contained module leaves the shared harness eight
// lines longer instead of seventy.
//
// A check module default-exports `async ({ page, url, root }) => string[]`, an
// empty array meaning it passed. Each one gets its own browser context and its
// own freshly loaded page, so a check that drives the camera or the player cannot
// leave the next one reading a moved world.

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'smoke-checks');

/** Every check module, in a stable order — discovery must not depend on the
 *  filesystem's iteration order any more than system registration does. */
export function discoverSmokeChecks() {
  if (!existsSync(CHECKS_DIR)) return [];
  return readdirSync(CHECKS_DIR)
    .filter((entry) => entry.endsWith('.mjs'))
    .sort();
}

async function runSmokeCheck(browser, url, root, file) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__diag != null && window.__diag.ready === true, {
      timeout: 15000,
    });
    const module = await import(pathToFileURL(resolve(CHECKS_DIR, file)).href);
    if (typeof module.default !== 'function') {
      errors.push('module has no default-exported check function');
    } else {
      const found = await module.default({ page, url, root });
      if (!Array.isArray(found)) {
        errors.push(`check returned ${typeof found}, not an array of messages`);
      } else {
        errors.push(...found);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return errors;
}

/** Runs every discovered check and returns the failures, each prefixed with the
 *  module that raised it. An empty array means the whole set passed. */
export async function runSmokeChecks(browser, url, root) {
  const failures = [];
  for (const file of discoverSmokeChecks()) {
    const errors = await runSmokeCheck(browser, url, root, file);
    if (errors.length === 0) {
      console.log(`Smoke check ${file}: passed`);
    } else {
      failures.push(...errors.map((message) => `${file}: ${message}`));
    }
  }
  return failures;
}
