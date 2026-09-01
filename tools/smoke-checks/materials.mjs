// The materials smoke check (T041): the four facts about tiling and cost that
// only exist inside the render loop, and which therefore no vitest run can
// reach — how many map sets were actually uploaded, whether a viewport change
// regenerated any of them, what sampling state the textures carry, and whether
// the textured level still holds its frame rate with the enemy system live
// (FR-009, FR-011, US4-S3, US4-S4, US4-S5, US4-S6).
//
// It reads `window.__materialsProbe()`, a harness-only probe of live renderer
// objects rather than a `__diag` field: `__diag` is 001's contract about the
// page's state, and "are these two meshes holding the same Texture object" is a
// question about the scene graph, not about the page.

import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

export const name = 'materials';

// Mirrored from `src/materials/` deliberately, the way enemies.mjs mirrors its
// bounds: the harness asserts the requirement, not the constant the code holds.
const MATERIAL_COUNT = 5;
const MAPS_PER_MATERIAL = 3;
const DECLARED_ANISOTROPY = 8;

const APPLY_TIMEOUT_MS = 30000;
const RESIZE_TIMEOUT_MS = 5000;
/** Long enough for the trailing FPS window to refill after the upload. */
const FPS_SETTLE_MS = 2000;
const RESIZED_VIEWPORT = { width: 960, height: 640 };

function readState(page) {
  return page.evaluate(() => ({
    probe: window.__materialsProbe(),
    materials: window.__diag.materials,
    fps: window.__diag.fps,
    enemiesAlive: window.__diag.enemiesAlive,
  }));
}

export default async function check({ page }) {
  const errors = [];

  try {
    await page.waitForFunction(() => window.__materialsProbe?.().applied === true, {
      timeout: APPLY_TIMEOUT_MS,
    });
  } catch {
    errors.push(
      `no material reached a mesh within ${APPLY_TIMEOUT_MS}ms: __materialsProbe().applied stayed false`,
    );
    return errors;
  }

  const before = await readState(page);
  const { probe, materials } = before;

  // US4-S3: one set of maps per material, shared by every mesh using it. The
  // three counts together are the claim — five names, five material objects
  // across more meshes than that, and fifteen distinct textures between them.
  if (probe.materialNames.length !== MATERIAL_COUNT) {
    errors.push(
      `${probe.materialNames.length} materials were uploaded, not the ${MATERIAL_COUNT} declared: ${probe.materialNames.join(', ')}`,
    );
  }
  if (probe.materialInstances !== probe.materialNames.length) {
    errors.push(
      `${probe.materialInstances} material objects are bound across ${probe.materialNames.length} material names — a mesh is holding its own copy`,
    );
  }
  if (probe.meshes <= probe.materialInstances) {
    errors.push(
      `only ${probe.meshes} meshes are bound to ${probe.materialInstances} materials, so nothing proves sharing`,
    );
  }
  const expectedTextures = probe.materialNames.length * MAPS_PER_MATERIAL;
  if (probe.textures.length !== expectedTextures) {
    errors.push(
      `${probe.textures.length} distinct textures are uploaded, not ${expectedTextures} — one set per material, not one per mesh`,
    );
  }
  for (const [material, maps] of Object.entries(probe.mapsPerMaterial)) {
    if (maps !== MAPS_PER_MATERIAL) {
      errors.push(`material ${material} carries ${maps} maps, not ${MAPS_PER_MATERIAL}`);
    }
  }
  if (materials.textureCount !== MATERIAL_COUNT * MAPS_PER_MATERIAL) {
    errors.push(
      `__diag.materials.textureCount is ${materials.textureCount}, not ${MATERIAL_COUNT * MAPS_PER_MATERIAL}`,
    );
  }
  if (materials.untexturedMeshes !== 0) {
    errors.push(`${materials.untexturedMeshes} bound meshes reached the frame with no material`);
  }

  // US4-S5: mipmaps and the declared anisotropy, so the longest corridor seen
  // end-on stays a surface instead of aliasing into noise.
  if (probe.mipmapped !== true) {
    errors.push('an uploaded texture has generateMipmaps false: a grazing angle will alias');
  }
  if (probe.repeatWrapped !== true) {
    errors.push('an uploaded texture is not RepeatWrapping: tile-space UVs will clamp, not tile');
  }
  const wantedAnisotropy = Math.min(DECLARED_ANISOTROPY, Math.floor(probe.maxAnisotropy));
  if (probe.anisotropy !== wantedAnisotropy || probe.anisotropy < 1) {
    errors.push(
      `anisotropy is ${probe.anisotropy}, not the declared ${DECLARED_ANISOTROPY} clamped to the driver's ${probe.maxAnisotropy}`,
    );
  }

  // US4-S1 in the page rather than in a unit test: the same pure counter the
  // unit test uses, run over the geometry the renderer actually holds.
  if (probe.stretchedFaces !== 0) {
    errors.push(`${probe.stretchedFaces} faces carry a UV span that is not their world extent`);
  }
  if (!(probe.longestRunRepeats > 1)) {
    errors.push(
      `the longest bound surface spans ${probe.longestRunRepeats} texture repeats — the level is wearing one stretched tile`,
    );
  }
  if (probe.builds !== 1) {
    errors.push(`the maps were derived ${probe.builds} times, not once per page load`);
  }

  // US4-S4: a viewport change regenerates nothing. Generation time is unchanged
  // and every uploaded texture is the same object it was.
  const resizesBefore = probe.resizes;
  await page.setViewportSize(RESIZED_VIEWPORT);
  try {
    await page.waitForFunction(
      (seen) => window.__materialsProbe().resizes > seen,
      resizesBefore,
      { timeout: RESIZE_TIMEOUT_MS },
    );
  } catch {
    errors.push('the page never saw the viewport change, so nothing about resize was proved');
  }
  const after = await readState(page);
  if (after.probe.generatedMs !== probe.generatedMs) {
    errors.push(
      `generation time moved from ${probe.generatedMs} to ${after.probe.generatedMs} across a resize: a texture was regenerated`,
    );
  }
  if (after.probe.builds !== probe.builds) {
    errors.push(`the maps were re-derived on resize: ${probe.builds} builds became ${after.probe.builds}`);
  }
  if (after.probe.textures.join(',') !== probe.textures.join(',')) {
    errors.push(
      `the uploaded texture set changed across a resize: ${probe.textures.length} textures became ${after.probe.textures.length}, with different identities`,
    );
  }

  // US4-S6: the textured level holds its frame rate with the enemy system live.
  // The floor is 001's, unlowered; what moved to pass it is where derivation
  // runs, which `offFrame` records.
  await page.waitForTimeout(FPS_SETTLE_MS);
  const settled = await readState(page);
  if (!(settled.enemiesAlive > 0)) {
    errors.push(
      `the enemy system is not live (__diag.enemiesAlive is ${settled.enemiesAlive}), so the frame budget was not tested against it`,
    );
  }
  if (!(settled.fps > SMOKE_FPS_FLOOR)) {
    errors.push(
      `fps ${settled.fps.toFixed(1)} did not exceed floor ${SMOKE_FPS_FLOOR} with materials applied and ${settled.enemiesAlive} guards live`,
    );
  }

  console.log(
    `  materials: ${probe.materialNames.length} materials, ${probe.textures.length} textures across ${probe.meshes} meshes, ` +
      `anisotropy ${probe.anisotropy}/${probe.maxAnisotropy}, longest run ${probe.longestRunRepeats.toFixed(0)} repeats, ` +
      `derived ${probe.offFrame ? 'off-frame' : 'in-frame'} in ${probe.generatedMs.toFixed(1)}ms, fps ${settled.fps.toFixed(1)}`,
  );

  return errors;
}
