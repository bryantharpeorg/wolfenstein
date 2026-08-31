// The materials smoke check (T031; FR-008, FR-010, FR-011, US3-S2, US3-S7,
// US3-S8, US3-S9, US3-S10). Everything here exists only inside the render loop:
// whether a mesh reached a frame with no albedo map, what the level costs in draw
// calls from where the player stands, what sampling state the uploaded textures
// carry, and whether dragging the window regenerates any of them. The material
// names come from `src/materials/table.ts`, holding the page to the declaration
// rather than to itself.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'materials';

/** The ceiling 002 FR-010 established and this spec had to survive (US3-S7). */
const MAX_DRAW_CALLS = 20;

/** Below this a grazing surface aliases into noise (US3-S10); the page may go
 *  higher where the backend allows, never lower. */
const MIN_ANISOTROPY = 2;

/** Albedo, normal, roughness — mirrored from `src/materials/maps.ts` so this
 *  asserts the requirement, not the constant the code holds. */
const MAPS_PER_MATERIAL = 3;

/** Open tiles needing no door and no key; the spawn tile is the fourth. */
const CAMERA_TILES = [
  [5.5, 5.5],
  [18.5, 18.5],
  [18.5, 3.5],
];

function readMaterialNames(root) {
  const source = readFileSync(resolve(root, 'src/materials/table.ts'), 'utf8');
  const table = source.match(/MATERIAL_NAMES:\s*readonly MaterialName\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (table == null) return null;
  return [...table[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

/** Spends `count` frames; skinning advances one step per frame. */
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

/** Drives the player to a tile centre, then spends frames so counters catch
 *  up. */
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
    player: window.__diag.player == null ? null : { ...window.__diag.player },
  }));

export default async function check({ page, root }) {
  const errors = [];

  const declared = readMaterialNames(root);
  if (declared == null || declared.length === 0) {
    errors.push('could not find MATERIAL_NAMES in src/materials/table.ts');
    return errors;
  }

  // The level skins one step per frame, so the finished state is waited for;
  // a page that never finishes reports the numbers it stalled on, below.
  try {
    await page.waitForFunction(
      () => window.__diag.materials != null && window.__diag.materials.untexturedMeshes === 0,
      undefined,
      { timeout: 10000 },
    );
  } catch {
    /* the assertions below report what was actually read */
  }

  const first = await readMaterials(page);
  if (first.diag == null || first.probe == null) {
    errors.push('window.__diag.materials or window.__materialsProbe is missing');
    return errors;
  }

  // US3-S2 / FR-008: no untextured surface anywhere in the world.
  if (first.diag.untexturedMeshes !== 0) {
    errors.push(
      `__diag.materials.untexturedMeshes is ${first.diag.untexturedMeshes}, not 0 ` +
        `(${first.probe.worldMeshes} meshes walked, ${first.probe.pending} steps left)`,
    );
  }
  if (first.probe.untexturedMeshes !== first.diag.untexturedMeshes) {
    errors.push(
      `the walk counts ${first.probe.untexturedMeshes} untextured meshes and __diag reports ` +
        `${first.diag.untexturedMeshes}: the published number is not the walk`,
    );
  }
  if (first.probe.worldMeshes === 0) {
    errors.push('the walk found no world meshes, so a zero above proves nothing');
  }
  if (first.probe.albedoTextures !== declared.length) {
    errors.push(
      `the meshes carrying the declared materials sample ${first.probe.albedoTextures} ` +
        `distinct albedo maps, not the ${declared.length} US3-S8 allows: one per mesh, ` +
        'not one per material',
    );
  }

  // US3-S8 / FR-010: exactly one set of maps per material, shared by every mesh.
  const expected = declared.length * MAPS_PER_MATERIAL;
  for (const [held, where] of [
    [first.diag.textureCount, '__diag.materials.textureCount'],
    [first.probe.textures, "the adapter's cache"],
  ]) {
    if (held !== expected) {
      errors.push(
        `${where} is ${held}, not the ${expected} that ${declared.length} materials x ` +
          `${MAPS_PER_MATERIAL} maps allows: a map set is being built per mesh`,
      );
    }
  }
  let skinned = 0;
  for (const material of declared) {
    const count = first.probe.byMaterial[material] ?? 0;
    skinned += count;
    if (count === 0) errors.push(`no mesh carries the declared material '${material}'`);
  }
  if (skinned <= declared.length) {
    errors.push(
      `only ${skinned} meshes carry the ${declared.length} declared materials, so nothing ` +
        'proves they are shared rather than one per mesh',
    );
  }
  if (!Array.isArray(first.diag.materials) || first.diag.materials.length !== declared.length) {
    errors.push(
      `__diag.materials.materials lists ${JSON.stringify(first.diag.materials)}, not one ` +
        'report per declared material',
    );
  }

  // US3-S10 / FR-011: mipmaps, repeat wrapping and the declared anisotropy are
  // in effect on the textures the page uploaded, not merely asked for.
  if (!first.probe.allMipmapped) errors.push('an uploaded texture is not mipmapped (US3-S10)');
  if (!first.probe.allRepeatWrapped) {
    errors.push('an uploaded texture does not repeat-wrap: tile-space UVs past 1 clamp');
  }
  if (!(first.probe.minAnisotropy >= MIN_ANISOTROPY)) {
    errors.push(
      `anisotropy ${first.probe.minAnisotropy} is below the declared ${MIN_ANISOTROPY}: a ` +
        'grazing surface will alias into noise',
    );
  }

  // US3-S7 / FR-010: the ceiling holds at the spawn tile and three further
  // camera positions, not just wherever the camera happened to land.
  const positions = [{ where: 'the spawn tile', ...first }];
  for (const tile of CAMERA_TILES) {
    await walkTo(page, tile);
    positions.push({ where: `tile ${tile[0]},${tile[1]}`, ...(await readMaterials(page)) });
  }
  for (const at of positions) {
    if (!(at.drawCalls < MAX_DRAW_CALLS)) {
      errors.push(`drawCalls ${at.drawCalls} is not below ${MAX_DRAW_CALLS} at ${at.where}`);
    }
  }
  const moved = positions.some(
    (at) =>
      at.player != null &&
      first.player != null &&
      Math.hypot(at.player.x - first.player.x, at.player.z - first.player.z) > 1,
  );
  if (!moved) errors.push('the camera never moved, so the four readings are one reading');

  // US3-S9 / FR-011: a viewport change regenerates nothing.
  const before = await readMaterials(page);
  for (const [width, height] of [
    [900, 600],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await spend(page, 10);
  }
  const after = await readMaterials(page);

  for (const [was, now, what] of [
    [before.diag.generatedMs, after.diag.generatedMs, 'generation time'],
    [before.diag.textureCount, after.diag.textureCount, 'the uploaded texture count'],
    [before.probe.textures, after.probe.textures, "the adapter's texture cache"],
  ]) {
    if (was !== now) errors.push(`${what} changed across a resize: ${was} -> ${now}`);
  }
  if (after.diag.untexturedMeshes !== 0) {
    errors.push(`a resize left ${after.diag.untexturedMeshes} meshes untextured`);
  }

  // A degradation is a legitimate outcome; a silent one is not.
  if (Array.isArray(after.diag.fallbacks) && after.diag.fallbacks.length > 0) {
    console.log(
      `Smoke check materials: ${after.diag.fallbacks.length} declared fallback(s): ` +
        after.diag.fallbacks.map((entry) => `${entry.name}/${entry.map}: ${entry.reason}`).join('; '),
    );
  }

  return errors;
}
