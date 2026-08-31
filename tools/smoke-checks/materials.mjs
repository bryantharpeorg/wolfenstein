// The materials smoke check (T031; FR-008, FR-009, FR-010, FR-011; US3-S2,
// US3-S5, US3-S7, US3-S8, US3-S9, US3-S10, US3-S11), discovered by
// `tools/smoke-check-runner.mjs` so `tools/smoke.mjs` stays untouched.
//
// Everything here is a fact about the page that no vitest run can reach: what is
// bound to the meshes that will actually be drawn, how many draw calls the
// budget is costing from four different places in the level, how many texture
// objects were uploaded and with what sampling, and whether a resize disturbed
// any of it. The tiling arithmetic is decided under `npm run test`; what is
// asserted here is that the shipped geometry carries it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

export const name = 'materials';

/** 002 FR-010's ceiling, restated here rather than imported: the harness asserts
 *  the requirement, not whichever constant the page happens to hold. */
const DRAW_CALL_CEILING = 20;

/** The story's own example: "a merged 20-tile wall run reads as twenty bricks".
 *  002's level has a 62-tile outer run, so this is a floor, not the answer. */
const LONGEST_RUN_MIN_TILES = 20;

/** Maps per material — albedo, normal, roughness (US2, US3-S8). */
const MAPS_PER_MATERIAL = 3;

/** The five US1 declares. */
const MATERIAL_NAMES = ['blood-stone', 'brick', 'steel', 'stone', 'wood'];

/** Read from the source, so "the anisotropy is declared" is asserted against the
 *  place it is declared in rather than against the value the page reports. */
function declaredAnisotropy(root) {
  const source = readFileSync(resolve(root, 'src/materials/texture-adapter.ts'), 'utf8');
  const match = source.match(/export const TEXTURE_ANISOTROPY = (\d+);/);
  return match == null ? null : Number(match[1]);
}

/** Sprints the player a little way and settles, so the next draw-call read is
 *  taken from somewhere the previous one was not (US3-S7). */
async function driveTo(page, vx, vz, steps) {
  await page.evaluate(
    ([x, z, n]) => {
      for (let step = 0; step < n; step += 1) window.__playerDrive(x, z, 200);
    },
    [vx, vz, steps],
  );
  await frames(page, 3);
  return page.evaluate(() => ({
    drawCalls: window.__diag.drawCalls,
    fps: window.__diag.fps,
    x: window.__diag.player.x,
    z: window.__diag.player.z,
  }));
}

const frames = (page, count) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let seen = 0;
        const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

export default async function check({ page, root }) {
  const failures = [];
  const need = (held, message) => {
    if (!held) failures.push(message);
  };

  await page.waitForFunction(
    () => window.__materials != null && window.__diag.materials != null,
    { timeout: 15000 },
  );
  // A frame has to have been drawn before the walk means anything: the system
  // publishes again on its first update, when every other system's setup is done.
  await frames(page, 3);

  const read = () =>
    page.evaluate(() => ({
      diag: JSON.parse(JSON.stringify(window.__diag.materials)),
      survey: window.__materials.survey(),
      bindings: window.__materials.bindings(),
      textures: window.__materials.textures(),
      spans: window.__materials.spans(),
      drawCalls: window.__diag.drawCalls,
      fps: window.__diag.fps,
      errors: [...window.__diag.errors],
    }));

  const first = await read();

  // --- US3-S2 / FR-008: no untextured surface, on the page, after load.
  need(
    first.survey.untexturedMeshes === 0,
    `${first.survey.untexturedMeshes} surface(s) carry no albedo map: ${first.survey.untextured.join(', ')}`,
  );
  need(
    first.diag.untexturedMeshes === 0,
    `__diag.materials.untexturedMeshes is ${first.diag.untexturedMeshes}, not 0`,
  );
  need(
    first.diag.untexturedMeshes === first.survey.untexturedMeshes,
    `__diag.materials.untexturedMeshes ${first.diag.untexturedMeshes} disagrees with the scene walk ` +
      `${first.survey.untexturedMeshes}`,
  );
  need(
    first.survey.surfaces > 10,
    `the walk found only ${first.survey.surfaces} surfaces — a count of zero untextured means ` +
      'nothing if nothing was looked at',
  );

  // --- US3-S1, US3-S3, US3-S4: the binding table, read off the page.
  const bound = new Map(first.bindings.map((entry) => [entry.surface, entry.material]));
  const wallTypes = [...bound.keys()].filter((surface) => surface.startsWith('wall:'));
  need(wallTypes.length >= 5, `only ${wallTypes.length} wall types are bound`);
  for (const [surface, material] of bound) {
    need(
      MATERIAL_NAMES.includes(material),
      `${surface} is bound to '${material}', which is not one of the five materials`,
    );
  }
  for (const surface of ['floor', 'ceiling', 'door']) {
    need(bound.has(surface), `nothing is bound for '${surface}'`);
  }
  const wallMaterials = new Set(wallTypes.map((surface) => bound.get(surface)));
  // US3-S4: neither the floor nor the ceiling samples a wall texture.
  for (const surface of ['floor', 'ceiling']) {
    need(
      !wallMaterials.has(bound.get(surface)),
      `the ${surface} wears '${bound.get(surface)}', which a wall type also wears`,
    );
  }
  need(bound.get('floor') !== bound.get('ceiling'), 'the floor and the ceiling share one material');
  // US3-S3: a door reads as a door before it is touched.
  need(
    !wallMaterials.has(bound.get('door')),
    `a door wears '${bound.get('door')}', which a wall type beside it also wears`,
  );
  // FR-008: no substitution was needed on the shipped level.
  const bindingFallbacks = first.diag.fallbacks.filter((entry) => entry.map === 'binding');
  need(
    bindingFallbacks.length === 0,
    `wall types fell back to the default material: ${bindingFallbacks.map((f) => f.reason).join('; ')}`,
  );

  // --- US3-S5: the shipped geometry carries the tiling, not just the unit test.
  const wallSpans = first.spans.filter((entry) => entry.surface.startsWith('level-wall-'));
  need(wallSpans.length > 0, 'no wall run reported a UV span');
  const longest = wallSpans.reduce((best, entry) => Math.max(best, entry.uSpan), 0);
  need(
    longest >= LONGEST_RUN_MIN_TILES,
    `the longest merged wall run spans ${longest.toFixed(2)} UV units — a run of that many tiles ` +
      'should span one repeat per tile, so this reads as one stretched brick',
  );
  for (const entry of first.spans) {
    need(
      Number.isFinite(entry.uSpan) && entry.uSpan > 0 && entry.vSpan > 0,
      `${entry.surface} carries a degenerate UV span (${entry.uSpan}, ${entry.vSpan})`,
    );
  }

  // --- US3-S8 / FR-010: one set of maps per material, shared by every mesh.
  const textures = first.textures;
  need(
    textures.materials === MATERIAL_NAMES.length,
    `${textures.materials} materials were built, expected ${MATERIAL_NAMES.length}`,
  );
  const expectedTextures = MATERIAL_NAMES.length * MAPS_PER_MATERIAL;
  need(
    textures.textures === expectedTextures,
    `${textures.textures} textures were uploaded, expected ${expectedTextures}`,
  );
  need(
    new Set(textures.names).size === textures.names.length,
    `a texture name is repeated: ${textures.names.join(', ')}`,
  );
  for (const material of MATERIAL_NAMES) {
    const mine = textures.names.filter((entry) => entry.startsWith(`${material}:`));
    need(
      mine.length === MAPS_PER_MATERIAL,
      `${material} has ${mine.length} maps, expected ${MAPS_PER_MATERIAL}: ${mine.join(', ')}`,
    );
  }
  need(
    first.diag.textureCount === expectedTextures,
    `__diag.materials.textureCount is ${first.diag.textureCount}, expected ${expectedTextures}`,
  );
  need(first.diag.bytes > 0, `__diag.materials.bytes is ${first.diag.bytes}`);
  // Shared, not per-mesh: many surfaces, few material objects, and exactly as
  // many distinct albedo maps as there are material objects wearing them.
  need(
    first.survey.distinctMaterials === first.survey.distinctAlbedoMaps,
    `${first.survey.distinctMaterials} materials carry ${first.survey.distinctAlbedoMaps} distinct ` +
      'albedo maps — a map set is not being shared',
  );
  need(
    first.survey.distinctMaterials < first.survey.surfaces,
    `${first.survey.surfaces} surfaces carry ${first.survey.distinctMaterials} materials — that is ` +
      'one material per mesh, which is the thing this budget forbids',
  );

  // --- US3-S10 / FR-011: mipmaps and the declared anisotropy are in effect.
  const anisotropy = declaredAnisotropy(root);
  need(anisotropy != null, 'could not read TEXTURE_ANISOTROPY from src/materials/texture-adapter.ts');
  need(
    anisotropy == null || textures.anisotropy === anisotropy,
    `the page reports anisotropy ${textures.anisotropy}, the source declares ${anisotropy}`,
  );
  need(textures.reports.length === expectedTextures, 'not every texture reported its sampling');
  for (const report of textures.reports) {
    need(report.generateMipmaps, `${report.name} was uploaded without mipmaps`);
    need(
      report.minFilter === textures.mipmapFilter,
      `${report.name} minifies without a mipmap filter (${report.minFilter})`,
    );
    need(
      report.anisotropy === textures.anisotropy && report.anisotropy >= 1,
      `${report.name} carries anisotropy ${report.anisotropy}, not the declared ${textures.anisotropy}`,
    );
    need(
      report.wrapS === textures.repeatWrapping && report.wrapT === textures.repeatWrapping,
      `${report.name} does not repeat-wrap, so a UV span above 1 clamps instead of tiling`,
    );
    const sRgb = report.colorSpace === 'srgb';
    need(
      report.role === 'albedo' ? sRgb : !sRgb,
      `${report.name} is in colour space '${report.colorSpace}', wrong for a ${report.role} map`,
    );
    need(report.width === report.height && report.width > 0, `${report.name} is not square`);
  }

  // --- US3-S7 / FR-010: the budget holds from four places in the level.
  need(
    first.drawCalls < DRAW_CALL_CEILING && first.drawCalls > 0,
    `drawCalls at the spawn tile is ${first.drawCalls}, not below ${DRAW_CALL_CEILING}`,
  );
  const walk = [
    ['north', 0, -5.4, 12],
    ['east', 5.4, 0, 12],
    ['south', 0, 5.4, 12],
  ];
  const seen = [`spawn:${first.drawCalls}`];
  for (const [where, vx, vz, steps] of walk) {
    const at = await driveTo(page, vx, vz, steps);
    seen.push(`${where}:${at.drawCalls}`);
    need(
      at.drawCalls < DRAW_CALL_CEILING && at.drawCalls > 0,
      `drawCalls at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}) is ${at.drawCalls}, not below ${DRAW_CALL_CEILING}`,
    );
  }

  // --- US3-S9 / FR-011: a resize regenerates nothing.
  const beforeResize = await read();
  await page.setViewportSize({ width: 960, height: 600 });
  await frames(page, 5);
  const resized = await read();
  need(
    resized.diag.generatedMs === beforeResize.diag.generatedMs,
    `generation time moved from ${beforeResize.diag.generatedMs} to ${resized.diag.generatedMs} ` +
      'across a resize — a texture was regenerated',
  );
  need(
    resized.diag.textureCount === beforeResize.diag.textureCount &&
      resized.textures.names.join(',') === beforeResize.textures.names.join(','),
    `the uploaded texture set changed across a resize: ${beforeResize.textures.names.length} -> ` +
      `${resized.textures.names.length}`,
  );
  need(
    resized.survey.untexturedMeshes === 0,
    `${resized.survey.untexturedMeshes} surface(s) lost their material across a resize`,
  );
  need(
    resized.drawCalls < DRAW_CALL_CEILING,
    `drawCalls after a resize is ${resized.drawCalls}, not below ${DRAW_CALL_CEILING}`,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await frames(page, 5);

  // --- US3-S11: the textured level still clears the declared floor, with the
  // enemy system live. The floor is 001's and is not lowered here.
  const settled = await read();
  need(
    settled.fps > SMOKE_FPS_FLOOR,
    `fps ${settled.fps.toFixed(1)} does not clear the declared floor ${SMOKE_FPS_FLOOR} with ` +
      'materials applied',
  );
  need(settled.errors.length === 0, `__diag.errors after the materials pass: ${settled.errors}`);

  // Printed, not merely asserted: the draw-call margin and the generation cost
  // are the two numbers this story is judged on, and a pass that squeaked
  // through should read as one.
  console.log(
    `  materials: ${settled.survey.surfaces} surfaces on ${settled.survey.distinctMaterials} ` +
      `materials, ${textures.textures} textures, generated in ${first.diag.generatedMs.toFixed(0)}ms; ` +
      `drawCalls ${seen.join(' ')}; longest run ${longest.toFixed(1)} UV units; ` +
      `fps ${settled.fps.toFixed(1)}`,
  );

  return failures;
}
