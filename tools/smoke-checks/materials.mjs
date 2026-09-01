// US3 runtime assertion: the level is fully textured and 002's draw-call budget
// survived being skinned. Tests __diag.materials.untexturedMeshes, drawCalls at
// multiple camera positions, one map set per material, and no regeneration on
// viewport resize (FR-008, FR-010, FR-011, US3-S2, US3-S5, US3-S8, US3-S9).

export const name = 'materials';

// Four scripted walks from the spawn tile, each a sustained push in one
// direction. US3-S5 asks for the draw-call ceiling "at any camera position", so
// the view has to actually move: `__playerDrive` is 003's input seam and the
// camera follows the player through it, whereas writing to `__diag.player` only
// edits the report.
const WALKS = [
  { label: 'spawn', vx: 0, vz: 0 },
  { label: 'north', vx: 0, vz: -5.4 },
  { label: 'east', vx: 5.4, vz: 0 },
  { label: 'south', vx: 0, vz: 5.4 },
];

const DRIVE_STEPS = 40;
const STEP_MS = 100;

/** Drives the player, then lets a few frames render so drawCalls settles. */
async function walk(page, { vx, vz }) {
  await page.evaluate(
    ({ dx, dz, steps, ms }) => {
      for (let i = 0; i < steps; i += 1) window.__playerDrive(dx, dz, ms);
    },
    { dx: vx, dz: vz, steps: DRIVE_STEPS, ms: STEP_MS },
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        function tick() {
          frames += 1;
          if (frames >= 5) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  return page.evaluate(() => ({ x: window.__diag.player.x, z: window.__diag.player.z }));
}

async function readMaterials(page) {
  return page.evaluate(() => {
    const d = window.__diag;
    return {
      ready: d.ready,
      drawCalls: d.drawCalls,
      materials: d.materials
        ? {
            untexturedMeshes: d.materials.untexturedMeshes,
            textureCount: d.materials.textureCount,
            bytes: d.materials.bytes,
            generatedMs: d.materials.generatedMs,
            fallbacks: d.materials.fallbacks,
          }
        : null,
    };
  });
}

export default async function check({ page }) {
  const failures = [];

  await page.waitForFunction(() => window.__diag != null && window.__diag.ready === true, {
    timeout: 15000,
  });

  const first = await readMaterials(page);
  if (first.materials == null) {
    failures.push('window.__diag.materials is missing');
    return failures;
  }

  if (first.materials.untexturedMeshes !== 0) {
    failures.push(
      `untexturedMeshes is ${first.materials.untexturedMeshes}, expected 0`,
    );
  }

  await page.waitForFunction(() => typeof window.__playerDrive === 'function', {
    timeout: 15000,
  });

  // The walks must genuinely move the player, or this loop samples one position
  // four times and US3-S5 goes unasserted.
  const visited = [];
  for (const step of WALKS) {
    const at = await walk(page, step);
    visited.push(`${step.label} (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`);
    const reading = await readMaterials(page);
    if (reading.drawCalls >= 20) {
      failures.push(
        `drawCalls ${reading.drawCalls} is not under 20 after walking ${step.label} to (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`,
      );
    }
    if (reading.materials != null && reading.materials.untexturedMeshes !== 0) {
      failures.push(
        `untexturedMeshes is ${reading.materials.untexturedMeshes} after walking ${step.label}, expected 0`,
      );
    }
  }

  const distinct = new Set(visited.map((entry) => entry.slice(entry.indexOf('('))));
  if (distinct.size < 2) {
    failures.push(
      `the scripted walks never moved the player: sampled ${[...distinct].join(', ')}`,
    );
  }

  if (first.materials.textureCount !== 15) {
    failures.push(
      `textureCount is ${first.materials.textureCount}, expected 15 (5 materials * 3 maps)`,
    );
  }

  if (first.materials.bytes <= 0) {
    failures.push(`materials.bytes is ${first.materials.bytes}, expected positive`);
  }

  if (first.materials.generatedMs == null || first.materials.generatedMs <= 0) {
    failures.push(`materials.generatedMs is ${first.materials.generatedMs}, expected positive`);
  }

  // FR-011 / US3-S9: a viewport resize must not regenerate textures or change
  // the reported generation time.
  const generatedBefore = first.materials.generatedMs;
  const viewport = page.viewportSize();
  if (viewport != null) {
    await page.setViewportSize({ width: viewport.width + 200, height: viewport.height + 100 });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          function tick() {
            frames += 1;
            if (frames >= 10) resolve();
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }),
    );
    const afterResize = await readMaterials(page);
    if (afterResize.materials != null && afterResize.materials.generatedMs !== generatedBefore) {
      failures.push(
        `generatedMs changed after resize: ${generatedBefore} -> ${afterResize.materials.generatedMs}`,
      );
    }
    await page.setViewportSize(viewport);
  }

  return failures;
}
