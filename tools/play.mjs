#!/usr/bin/env node
// `npm run play` (009 US1, FR-001..FR-005): an agent plays the level in a real browser on
// this machine, through the same keyboard and mouse a person uses, and the run is recorded.
//
// This is not a gate and must never become one. It renders headed, which Ergane's bwrap
// runtime and every CI runner cannot do, so it is absent from `ergane.yaml` and asserts
// nothing `npm run smoke` asserts. What it does instead is the thing no gate in this
// repository has ever done: drive `keyboard.ts`, `pointer-lock.ts`, `look.ts` and the
// interact bindings as a player's hardware drives them, and leave behind something a person
// can watch.
//
// Orchestration only. It holds no knowledge of the level: where to walk comes from the
// game's own pathfinder through `tools/play/navigate.mjs`, and how to press a key comes from
// `tools/play/driver.mjs`.
//
// US2 adds the full-completion objective set, US3 the timeline, US4 the verdict and the
// record. What this file writes today is the minimum that proves FR-005's exclusion.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, resolveBrowser, BrowserResolutionError } from './serve.mjs';
import {
  HarnessFault, acquirePointerLock, createLook, frames, interact, readPlayer, until,
} from './play/driver.mjs';
import { loadNav, walkToTile } from './play/navigate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/** The record's home: replaced per invocation, gitignored, and skipped by the binary-asset
 *  walker. A recording is build output in the sense `dist/` is (DECISIONS.md, 2026-09-02). */
export const OUTPUT_DIR = resolve(root, 'playtest');

/** Assembled here and moved into place as the last act, so an interrupted run never leaves a
 *  directory that reads as a result (FR-013, anticipated here because a half-written
 *  `playtest/` is worse than none from the first invocation onward). */
const STAGING_DIR = resolve(root, '.playtest-staging');

/** The recorded viewport. Declared once: the record reports it, so it must not be guessed
 *  at two call sites. */
export const VIEWPORT = { width: 1280, height: 720 };

/** Frames spent after `ready` before the first command, so materials and the first guard
 *  ticks are behind us and the recording does not open on a half-built scene. */
const SETTLE_FRAMES = 45;

/** Frames the elevator travel is given. `ELEVATOR_TRAVEL_MS` is 2000; at 60fps that is 120,
 *  and this is generous enough for a frame rate that dipped. */
const TRAVEL_FRAME_BUDGET = 600;

function say(message) {
  console.log(message);
}

function run(command, args) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

/**
 * Is there somewhere to draw? On a headless host this command refuses rather than falling
 * back to software rendering, because the artifact is a video and a software-rendered video
 * misrepresents the frame rate the artifact exists to show — the smoke gate's FPS floor is 5
 * for exactly that reason (DECISIONS.md, 2026-09-02).
 */
export function displayAvailable(env = process.env, platform = process.platform) {
  if (platform !== 'linux') return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** One attempt: a fresh page, driven from spawn to the elevator. Returns what happened. */
async function playOnce(browser, url, attemptDir) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: attemptDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const outcome = { reached: null, pageErrors, diagErrors: [], fault: null };
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__diag != null && window.__diag.ready === true, {
      timeout: 20000,
    });
    await frames(page, SETTLE_FRAMES);

    await acquirePointerLock(page);
    const look = createLook(page);
    const nav = await loadNav(root);

    const exit = nav.findExitTile(nav.LEVEL_GRID);
    if (exit == null) throw new HarnessFault('the shipped level has no exit tile');
    say(`  walking to the exit at (${exit.x},${exit.z})`);

    const walk = await walkToTile(page, look, nav, exit, {
      onWaypoint: (cell) => say(`    reached (${cell.x},${cell.z})`),
      onKill: (killed) => say(`    answered a guard (${killed} down)`),
    });
    if (!walk.arrived) {
      outcome.reason = walk.reason;
      return outcome;
    }

    await interact(page);
    await until(page, () => window.__diag.run.state !== 'playing', { frameBudget: 120 });
    await until(page, () => window.__diag.run.state === 'complete', {
      frameBudget: TRAVEL_FRAME_BUDGET,
    });

    const final = await page.evaluate(() => ({
      run: { ...window.__diag.run },
      player: { x: window.__diag.player.x, z: window.__diag.player.z },
      fps: window.__diag.fps,
      renderer: window.__diag.renderer,
      // The margin the run finished with: the difference between "completed" and "very
      // nearly did not" is the whole reason US4 keeps attempts and reports them.
      health: window.__diag.combat.health,
      errors: [...window.__diag.errors],
      lines: window.__run?.lines?.() ?? null,
    }));
    outcome.reached = final.run.state;
    outcome.final = final;
    outcome.diagErrors = final.errors;
    if (final.run.state !== 'complete') {
      outcome.reason = `the run ended in '${final.run.state}', not 'complete'`;
    }
    return outcome;
  } catch (error) {
    if (error instanceof HarnessFault) outcome.fault = error.message;
    else outcome.reason = error instanceof Error ? error.message : String(error);
    return outcome;
  } finally {
    const video = page.video();
    await context.close();
    if (video != null) {
      try {
        await rename(await video.path(), join(attemptDir, 'run.webm'));
      } catch {
        /* the recording kept its generated name; the directory still holds it */
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--no-build');

  if (!displayAvailable()) {
    console.error(
      'npm run play needs a display: it records real gameplay and will not pass a '
      + 'software-rendered run off as one. Neither DISPLAY nor WAYLAND_DISPLAY is set.',
    );
    process.exit(1);
  }

  if (!skipBuild) {
    say('Building…');
    const built = await run('npm', ['run', 'build']);
    if (built.code !== 0) {
      console.error(built.stdout);
      console.error(built.stderr);
      console.error('Build failed');
      process.exit(1);
    }
  } else if (!existsSync(resolve(root, 'dist/index.html'))) {
    console.error('--no-build was given but dist/index.html does not exist.');
    process.exit(1);
  }

  await rm(STAGING_DIR, { recursive: true, force: true });
  const attemptDir = join(STAGING_DIR, 'attempt-1');
  await mkdir(attemptDir, { recursive: true });

  const { server, url } = await startServer();
  let browserPath;
  try {
    browserPath = resolveBrowser();
  } catch (error) {
    if (!(error instanceof BrowserResolutionError)) throw error;
    console.error(error.message);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, executablePath: browserPath });
  let outcome;
  try {
    say('Playing…');
    outcome = await playOnce(browser, url, attemptDir);
  } finally {
    await browser.close();
    server.close();
  }

  const passed = outcome.reached === 'complete'
    && outcome.diagErrors.length === 0
    && outcome.pageErrors.length === 0;

  await writeFile(
    join(STAGING_DIR, 'run.json'),
    `${JSON.stringify({ passed, viewport: VIEWPORT, ...outcome }, null, 2)}\n`,
  );
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await rename(STAGING_DIR, OUTPUT_DIR);

  if (passed) {
    const { run: finished, fps, health } = outcome.final;
    say(`PASS — the level was completed in ${(finished.elapsedMs / 1000).toFixed(1)}s at ${fps.toFixed(1)} fps, finishing on ${Math.round(health)} health`);
    say(`  kills ${finished.kills}/${finished.guardsTotal}  secrets ${finished.secretsFound}/${finished.secretsTotal}  treasure ${finished.treasureFound}/${finished.treasureTotal}  rating ${finished.rating}`);
  } else {
    console.error(`FAIL — ${outcome.fault ?? outcome.reason ?? 'the run did not complete'}`);
    if (outcome.diagErrors.length > 0) console.error(`  __diag.errors: ${outcome.diagErrors.join(' | ')}`);
    if (outcome.pageErrors.length > 0) console.error(`  pageerror: ${outcome.pageErrors.join(' | ')}`);
  }
  say(`Record written to ${OUTPUT_DIR}`);
  process.exit(passed ? 0 : 1);
}

main();
