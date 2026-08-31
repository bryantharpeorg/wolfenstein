// The materials smoke check (T031; FR-008, FR-010, FR-011, US3-S2, US3-S7,
// US3-S8, US3-S9), discovered by `tools/smoke-check-runner.mjs`.
//
// Everything asserted here exists only inside the render loop, which is why it is
// asserted here and not under `npm run test`: whether a mesh reached a frame with
// no albedo map, how many draw calls the level costs from where the player is
// standing, how many textures were actually uploaded, and whether dragging the
// window regenerates any of them.
//
// The five material names are re-read out of `src/materials/table.ts` rather than
// taken from the page, so this proves the page agrees with the declaration
// instead of with itself — the same trick `enemies.mjs` plays on `src/level.ts`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'materials';

/** The ceiling 002 FR-010 established and this spec had to survive (US3-S7). */
const MAX_DRAW_CALLS = 20;

/** Albedo, normal, roughness: mirrored from `src/materials/maps.ts` deliberately,
 *  so the harness asserts the requirement rather than the constant the code holds. */
const MAPS_PER_MATERIAL = 3;

/** Open tiles inside the spawn room, so a leg needs no door and no key. The spawn
 *  tile itself is the fourth camera position, and it is where the walk starts. */
const CAMERA_TILES = [
  [5.5, 5.5],
  [18.5, 18.5],
  [18.5, 3.5],
];

/** The declared material names, read from the table US1 wrote. */
function readMaterialNames(root) {
  const source = readFileSync(resolve(root, 'src/materials/table.ts'), 'utf8');
  const table = source.match(/MATERIAL_NAMES:\s*readonly MaterialName\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (table == null) return null;
  return [...table[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

/** Spends `count` animation frames; skinning advances one step per frame. */
const spend = (page, count) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let seen = 0;
        const tick = () => (++seen >= frames ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

/** Waits for a reading without throwing; the assertion that follows reports what
 *  was actually read, which says more than a timeout stack does. */
async function settle(page, predicate, timeout = 10000) {
  try {
    await page.waitForFunction(predicate, undefined, { timeout });
  } catch {
    /* reported by the assertion that follows */
  }
}

/** Drives the player to a tile centre, as the locked-door pass does, then spends
 *  frames so the camera and the renderer's counters catch up with it. */
async function walkTo(page, [targetX, targetZ]) {
  await page.evaluate(
    ([tx, tz]) => {
      for (let step = 0; step < 600; step += 1) {
        const fromX = window.__diag.player.x;
        const fromZ = window.__diag.player.z;
        const distance = Math.hypot(tx - fromX, tz - fromZ);
        if (distance < 0.05) break;
        window.__playerDrive((4 * (tx - fromX)) / distance, (4 * (tz - fromZ)) / distance, 50);
        if (Math.hypot(window.__diag.player.x - fromX, window.__diag.player.z - fromZ) < 1e-4) break;
      }
    },
    [targetX, targetZ],
  );
  await spend(page, 4);
}

const readMaterials = (page) =>
  page.evaluate(() => ({
    diag: window.__diag.materials == null ? null : { ...window.__diag.materials },
    probe: window.__materialsProbe == null ? null : window.__materialsProbe(),
    drawCalls: window.__diag.drawCalls,
    player: window.__diag.player == null ? null : { x: window.__diag.player.x, z: window.__diag.player.z },
  }));

export default async function check({ page, root }) {
  const errors = [];

  const declared = readMaterialNames(root);
  if (declared == null || declared.length === 0) {
    errors.push('could not find MATERIAL_NAMES in src/materials/table.ts');
    return errors;
  }

  // The level skins one step per frame, so the finished state is waited for
  // rather than assumed. A page that never finishes reports the numbers it
  // stalled on, below, instead of a bare timeout.
  await settle(
    page,
    () => window.__diag.materials != null && window.__diag.materials.untexturedMeshes === 0,
  );

  const first = await readMaterials(page);
  if (first.diag == null) {
    errors.push('window.__diag.materials is missing: US2 publishes it and US3 fills it');
    return errors;
  }
  if (first.probe == null) {
    errors.push('window.__materialsProbe is missing: the materials system did not install it');
    return errors;
  }

  // US3-S2 / FR-008: no untextured surface anywhere in the world.
  if (first.diag.untexturedMeshes !== 0) {
    errors.push(
      `__diag.materials.untexturedMeshes is ${first.diag.untexturedMeshes}, not 0` +
        ` (${first.probe.worldMeshes} world meshes walked, ${first.probe.pending} skinning steps left)`,
    );
  }
  if (first.probe.untexturedMeshes !== first.diag.untexturedMeshes) {
    errors.push(
      `the probe counts ${first.probe.untexturedMeshes} untextured meshes but __diag reports ` +
        `${first.diag.untexturedMeshes}: the published number is not the walk`,
    );
  }
  if (first.probe.worldMeshes === 0) {
    errors.push('the scene walk found no world meshes at all, so a zero above proves nothing');
  }

  // US3-S8 / FR-010: exactly one set of maps per material, shared by every mesh.
  const expectedTextures = declared.length * MAPS_PER_MATERIAL;
  if (first.diag.textureCount !== expectedTextures) {
    errors.push(
      `__diag.materials.textureCount is ${first.diag.textureCount}, not ${expectedTextures}` +
        ` (${declared.length} declared materials x ${MAPS_PER_MATERIAL} maps)`,
    );
  }
  if (first.probe.textures !== expectedTextures) {
    errors.push(
      `the adapter holds ${first.probe.textures} textures, not the ${expectedTextures} one set ` +
        'per material allows: a map set is being built per mesh',
    );
  }
  const skinned = declared.reduce((total, material) => total + (first.probe.byMaterial[material] ?? 0), 0);
  for (const material of declared) {
    if ((first.probe.byMaterial[material] ?? 0) === 0) {
      errors.push(`no mesh in the level carries the declared material '${material}'`);
    }
  }
  if (skinned <= declared.length) {
    errors.push(
      `only ${skinned} meshes carry the ${declared.length} declared materials, so nothing proves ` +
        'the materials are shared rather than one per mesh',
    );
  }
  if (!Array.isArray(first.diag.materials) || first.diag.materials.length !== declared.length) {
    errors.push(
      `__diag.materials.materials lists ${JSON.stringify(first.diag.materials)}, not one report ` +
        `per declared material`,
    );
  }

  // US3-S7 / FR-010: the draw-call ceiling holds at the spawn tile and at three
  // further camera positions, not just wherever the camera happened to land.
  const positions = [{ where: 'the spawn tile', drawCalls: first.drawCalls, player: first.player }];
  for (const tile of CAMERA_TILES) {
    await walkTo(page, tile);
    const reading = await readMaterials(page);
    positions.push({ where: `tile ${tile[0]},${tile[1]}`, drawCalls: reading.drawCalls, player: reading.player });
  }
  for (const position of positions) {
    if (!(position.drawCalls < MAX_DRAW_CALLS)) {
      errors.push(
        `drawCalls ${position.drawCalls} is not below ${MAX_DRAW_CALLS} at ${position.where}`,
      );
    }
  }
  const moved = positions.some(
    (position) =>
      position.player != null &&
      first.player != null &&
      Math.hypot(position.player.x - first.player.x, position.player.z - first.player.z) > 1,
  );
  if (!moved) {
    errors.push('the camera never left the spawn tile, so the four readings are one reading');
  }

  // US3-S9 / FR-011: a viewport change regenerates nothing.
  const before = await readMaterials(page);
  await page.setViewportSize({ width: 900, height: 600 });
  await spend(page, 10);
  await page.setViewportSize({ width: 1280, height: 720 });
  await spend(page, 10);
  const after = await readMaterials(page);

  if (after.diag.generatedMs !== before.diag.generatedMs) {
    errors.push(
      `generation time changed across a resize: ${before.diag.generatedMs} -> ${after.diag.generatedMs}`,
    );
  }
  if (after.diag.textureCount !== before.diag.textureCount) {
    errors.push(
      `the uploaded texture count changed across a resize: ${before.diag.textureCount} -> ${after.diag.textureCount}`,
    );
  }
  if (after.probe.textures !== before.probe.textures) {
    errors.push(
      `the adapter's texture cache changed across a resize: ${before.probe.textures} -> ${after.probe.textures}`,
    );
  }
  if (after.diag.untexturedMeshes !== 0) {
    errors.push(`a resize left ${after.diag.untexturedMeshes} meshes untextured`);
  }

  // FR-007's degradations are legitimate outcomes, but a silent one is not: if any
  // were taken, they are named here so the build says so.
  if (Array.isArray(after.diag.fallbacks) && after.diag.fallbacks.length > 0) {
    console.log(
      `Smoke check materials: ${after.diag.fallbacks.length} declared fallback(s): ` +
        after.diag.fallbacks.map((entry) => `${entry.name}/${entry.map}: ${entry.reason}`).join('; '),
    );
  }

  return errors;
}
