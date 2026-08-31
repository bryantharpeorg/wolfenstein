// The check-module loop, mirroring `src/boot/discover.ts`: every
// `tools/smoke-checks/*.mjs` runs against a freshly loaded page, so a story adds a
// runtime assertion by adding a file rather than by editing the harness. A module
// exports `run({ page, url })` returning failure messages — empty when it passes —
// and may export a one-line `description`.

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'smoke-checks');

export async function runCheckModules(browser, url, { log = console.log } = {}) {
  if (!existsSync(DIR)) return [];
  const errors = [];

  for (const file of readdirSync(DIR).filter((name) => name.endsWith('.mjs')).sort()) {
    const module = await import(pathToFileURL(resolve(DIR, file)).href);
    const check = module.run ?? module.default;
    if (typeof check !== 'function') {
      errors.push(`${file}: exports no run() function`);
      continue;
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${file}: pageerror: ${error.message}`));
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__diag?.ready === true, { timeout: 15000 });
      errors.push(...((await check({ page, url })) ?? []).map((m) => `${file}: ${m}`));
    } catch (error) {
      errors.push(`${file}: threw ${error.message}`);
    }
    await context.close();
    log(`Smoke check ${file}: ${module.description ?? 'ran'}`);
  }

  return errors;
}
