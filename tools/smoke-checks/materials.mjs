// The materials runtime assertions. US3's half: the level is fully textured and
// 002's draw-call budget survived being skinned. US4's half: exactly one set of
// maps exists per material and is shared by every mesh, mipmaps and the declared
// anisotropy are in effect, a viewport resize regenerates nothing, and the
// textured level holds its frame rate with the enemy system live (FR-008,
// FR-009, FR-010, FR-011, US3-S2, US3-S5, US4-S3, US4-S4, US4-S5, US4-S6).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

export const name = 'materials';

/** The five materials 005 declares, times albedo, normal, roughness. */
const MATERIAL_COUNT = 5;
const MAPS_PER_MATERIAL = 3;

/** three.js minification filters that sample a mipmap chain. A texture left on
 * NearestFilter (1003) or LinearFilter (1006) never touches a mipmap and
 * ignores anisotropy outright, which is US4-S5's failure exactly. */
const MIPMAP_MIN_FILTERS = new Set([1004, 1005, 1007, 1008]);

/** The anisotropy level the source declares, read back from the source rather
 * than duplicated here, so this asserts the page agrees with the constant. */
function readDeclaredAnisotropy(root) {
  const source = readFileSync(resolve(root, 'src/materials/texture-adapter.ts'), 'utf8');
  const match = source.match(/MATERIAL_ANISOTROPY\s*=\s*(\d+)/);
  return match == null ? null : Number(match[1]);
}

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
      fps: d.fps,
      enemiesAlive: d.enemiesAlive,
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

/** US4-S3 and US4-S5 are claims about live GPU objects, so they are read off the
 * scene rather than off a count the page wrote about itself. */
function readProbe(page) {
  return page.evaluate(() =>
    typeof window.__materialsProbe === 'function' ? window.__materialsProbe() : null,
  );
}

export default async function check({ page, root }) {
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

  const expectedTextures = MATERIAL_COUNT * MAPS_PER_MATERIAL;
  if (first.materials.textureCount !== expectedTextures) {
    failures.push(
      `textureCount is ${first.materials.textureCount}, expected ${expectedTextures} (${MATERIAL_COUNT} materials * ${MAPS_PER_MATERIAL} maps)`,
    );
  }

  if (first.materials.bytes <= 0) {
    failures.push(`materials.bytes is ${first.materials.bytes}, expected positive`);
  }

  if (first.materials.generatedMs == null || first.materials.generatedMs <= 0) {
    failures.push(`materials.generatedMs is ${first.materials.generatedMs}, expected positive`);
  }

  // Everything below is about a settled page: sampling `generatedMs` while the
  // sharp maps are still arriving compares two points on a rising curve and
  // blames the resize for the difference.
  await page.waitForFunction(() => window.__diag?.materials?.pendingMaterials === 0, {
    timeout: 20000,
  });
  const settled = await readMaterials(page);

  // US4-S3: one set of maps per material, shared by every mesh. `textureCount`
  // alone cannot say this — it is a number this code wrote, and it reads 15
  // whether fifteen textures are shared by ninety meshes or duplicated per mesh.
  const probe = await readProbe(page);
  if (probe == null) {
    failures.push('window.__materialsProbe is missing: one-set-per-material cannot be read');
  } else {
    if (probe.meshes <= MATERIAL_COUNT) {
      failures.push(`only ${probe.meshes} skinned meshes; sharing is unprovable below one per material`);
    }
    if (probe.names.length !== MATERIAL_COUNT) {
      failures.push(`${probe.names.length} material names bound (${probe.names.join(', ')}), expected ${MATERIAL_COUNT}`);
    }
    if (probe.materialInstances !== MATERIAL_COUNT) {
      failures.push(`${probe.materialInstances} distinct materials across ${probe.meshes} meshes, expected ${MATERIAL_COUNT} — one per material, shared`);
    }
    if (probe.textureInstances !== expectedTextures) {
      failures.push(`${probe.textureInstances} distinct textures across ${probe.meshes} meshes, expected ${expectedTextures} — one set per material, not one set per mesh`);
    }
    if (probe.withoutAlbedo !== 0) {
      failures.push(`${probe.withoutAlbedo} skinned meshes carry no albedo map`);
    }

    // US4-S5: mipmaps and a declared anisotropy level actually in effect.
    if (probe.mipmapped !== true) {
      failures.push('not every uploaded map requests a mipmap chain');
    }
    const anisotropy = readDeclaredAnisotropy(root);
    if (anisotropy == null) {
      failures.push('could not read MATERIAL_ANISOTROPY from src/materials/texture-adapter.ts');
    } else if (probe.anisotropy.length !== 1 || probe.anisotropy[0] !== anisotropy) {
      failures.push(`anisotropy across uploaded maps is [${probe.anisotropy.join(', ')}], expected every map at the declared ${anisotropy}`);
    }
    const flat = probe.minFilters.filter((f) => !MIPMAP_MIN_FILTERS.has(f));
    if (flat.length > 0) {
      failures.push(`minification filter ${flat.join(', ')} never samples a mipmap, so the chain and the anisotropy are both dead weight`);
    }
  }

  // FR-011 / US4-S4: a viewport resize must not regenerate textures or change
  // the reported generation time.
  const generatedBefore = settled.materials.generatedMs;
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
    if (afterResize.materials != null && afterResize.materials.textureCount !== expectedTextures) {
      failures.push(`textureCount changed after resize: ${expectedTextures} -> ${afterResize.materials.textureCount}`);
    }
    const after = await readProbe(page);
    if (probe != null && after != null && after.textureInstances !== probe.textureInstances) {
      failures.push(`distinct uploaded textures changed after resize: ${probe.textureInstances} -> ${after.textureInstances}`);
    }
    await page.setViewportSize(viewport);
  }

  // US4-S6 / FR-016: the textured level holds its frame rate with the enemy
  // system live. The floor is 001's and is not lowered here; what moved to make
  // this pass is where the derivation is spent, not the bar.
  const final = await readMaterials(page);
  if (!(final.enemiesAlive > 0)) {
    failures.push(`the enemy system is not live: enemiesAlive is ${final.enemiesAlive}, so the frame budget was measured without it`);
  }
  if (!(final.fps > SMOKE_FPS_FLOOR)) {
    failures.push(`fps ${Number(final.fps).toFixed(1)} did not clear the declared floor ${SMOKE_FPS_FLOOR} with ${final.enemiesAlive} guards live and every surface textured`);
  }
  if (final.materials != null && final.materials.untexturedMeshes !== 0) {
    failures.push(`untexturedMeshes is ${final.materials.untexturedMeshes} on the settled page, expected 0`);
  }

  const p = probe ?? { materialInstances: '?', meshes: '?', textureInstances: '?', anisotropy: ['?'] };
  console.log(
    `  materials: ${p.materialInstances} materials over ${p.meshes} meshes, ${p.textureInstances} textures, ` +
      `anisotropy ${p.anisotropy.join('/')}, generatedMs ${Number(generatedBefore).toFixed(1)} stepped, ` +
      `fps ${Number(final.fps).toFixed(1)} with ${final.enemiesAlive} guards live`,
  );

  return failures;
}
