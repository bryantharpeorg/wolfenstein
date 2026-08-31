// The check-module loop, mirroring `src/boot/discover.ts`.
//
// Every `tools/smoke-checks/*.mjs` is loaded and run against a freshly loaded
// page, so a story adds a runtime assertion by adding a file rather than by
// editing the harness. An index, or a call site in `smoke.mjs`, would put every
// story's one line on adjacent lines of one shared file — which is the conflict
// the glob removes.
//
// A check module exports `run({ page, url })` and returns an array of failure
// messages, empty when it passes. It may also export a one-line `description`.
// It lives here rather than inside `smoke.mjs` so the harness grows by an import
// instead of by a function, and so `smoke-checks/` holds checks and nothing else.

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'smoke-checks');

/** Runs every discovered check module. Returns the failure messages, prefixed
 *  with the file that produced them; empty means every check passed. */
export async function runCheckModules(browser, url, { log = console.log } = {}) {
  if (!existsSync(CHECKS_DIR)) return [];

  const files = readdirSync(CHECKS_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const errors = [];

  for (const file of files) {
    const module = await import(pathToFileURL(resolve(CHECKS_DIR, file)).href);
    const check = module.run ?? module.default;
    if (typeof check !== 'function') {
      errors.push(`${file}: exports no run() function`);
      continue;
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(`${file}: pageerror: ${error.message}`));

    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__diag != null && window.__diag.ready === true, {
        timeout: 15000,
      });
      const found = (await check({ page, url })) ?? [];
      errors.push(...found.map((message) => `${file}: ${message}`));
    } catch (error) {
      errors.push(`${file}: threw ${error instanceof Error ? error.message : String(error)}`);
    }

    errors.push(...pageErrors);
    await context.close();
    log(`Smoke check ${file}: ${module.description ?? 'ran'}`);
  }

  return errors;
}
