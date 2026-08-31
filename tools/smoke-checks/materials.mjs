// The materials smoke check (T031; FR-008 to FR-011; US3-S2, S5, S7 to S11),
// discovered by `tools/smoke-check-runner.mjs`. Every fact here is one no vitest
// run can reach: what is bound to the meshes that will be drawn, the draw calls
// from four places in the level, what was uploaded with what sampling, and
// whether a resize moved any of it. The tiling arithmetic is decided under
// `npm run test`; this asserts the shipped geometry carries it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

export const name = 'materials';

/** 002 FR-010's ceiling, restated rather than imported: the harness asserts the
 *  requirement, not the constant the page holds. */
const DRAW_CALL_CEILING = 20;

/** The story's own "a merged 20-tile run reads as twenty bricks"; 002's level
 *  has a 62-tile outer run, so this is a floor, not the answer. */
const LONGEST_RUN_MIN_TILES = 20;

/** Albedo, normal and roughness, for each of the five US1 declares. */
const MAPS_PER_MATERIAL = 3;
const MATERIAL_NAMES = ['blood-stone', 'brick', 'steel', 'stone', 'wood'];

/** Read from the source, so "declared anisotropy" is asserted against where it
 *  is declared, not against what the page reports. */
function declaredAnisotropy(root) {
  const source = readFileSync(resolve(root, 'src/materials/texture-adapter.ts'), 'utf8');
  const match = source.match(/export const TEXTURE_ANISOTROPY = (\d+);/);
  return match == null ? null : Number(match[1]);
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

/** Walks the player somewhere the last read was not (US3-S7). */
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
    x: window.__diag.player.x,
    z: window.__diag.player.z,
  }));
}

export default async function check({ page, root }) {
  const failures = [];
  const need = (held, message) => {
    if (!held) failures.push(message);
  };

  await page.waitForFunction(
    () => window.__materials != null && window.__diag.materials != null,
    { timeout: 15000 },
  );
  // A frame must have been drawn first: the system publishes again on its first
  // update, when every other system's setup is done.
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

  // --- US3-S2 / FR-008: no untextured surface after load. A count of zero means
  // nothing if nothing was looked at, so the walk's reach is asserted too.
  const walk = first.survey;
  need(walk.untexturedMeshes === 0, `no albedo map on: ${walk.untextured.join(', ')}`);
  need(first.diag.untexturedMeshes === 0, `__diag untexturedMeshes ${first.diag.untexturedMeshes}`);
  const agrees = first.diag.untexturedMeshes === walk.untexturedMeshes;
  need(agrees, `__diag ${first.diag.untexturedMeshes} disagrees with the walk`);
  need(walk.surfaces > 10, `the walk found only ${walk.surfaces} surfaces`);

  // --- US3-S1, S3, S4: the binding table, read off the page. What the table
  // *says* is settled under `npm run test`; this is the page holding it.
  const bound = new Map(first.bindings.map((entry) => [entry.surface, entry.material]));
  const wallTypes = [...bound.keys()].filter((surface) => surface.startsWith('wall:'));
  need(wallTypes.length >= 5, `only ${wallTypes.length} wall types are bound`);
  const wallMaterials = new Set(wallTypes.map((surface) => bound.get(surface)));
  // US3-S4: neither the floor nor the ceiling samples a wall texture.
  // US3-S3: a door reads as a door before it is touched.
  for (const surface of ['floor', 'ceiling', 'door']) {
    const worn = bound.get(surface);
    need(MATERIAL_NAMES.includes(worn), `'${surface}' wears '${worn}', not one of the five`);
    need(!wallMaterials.has(worn), `the ${surface} wears '${worn}', a wall type's material`);
  }
  need(bound.get('floor') !== bound.get('ceiling'), 'the floor and the ceiling share one material');
  // FR-008: no substitution was needed on the shipped level.
  const fell = first.diag.fallbacks.filter((entry) => entry.map === 'binding');
  need(fell.length === 0, `wall types fell back: ${fell.map((f) => f.reason).join('; ')}`);

  // --- US3-S5: the shipped geometry carries the tiling, not just the unit test.
  const wallSpans = first.spans.filter((entry) => entry.surface.startsWith('level-wall-'));
  need(wallSpans.length > 0, 'no wall run reported a UV span');
  const longest = wallSpans.reduce((best, entry) => Math.max(best, entry.uSpan), 0);
  // One repeat per tile, or the run reads as one stretched brick.
  need(longest >= LONGEST_RUN_MIN_TILES, `the longest run spans ${longest.toFixed(2)} UV units`);
  for (const it of first.spans) {
    const spans = Number.isFinite(it.uSpan) && it.uSpan > 0 && it.vSpan > 0;
    need(spans, `${it.surface} spans a degenerate (${it.uSpan}, ${it.vSpan})`);
  }

  // --- US3-S8 / FR-010: one set of maps per material, shared by every mesh.
  const textures = first.textures;
  const expectedTextures = MATERIAL_NAMES.length * MAPS_PER_MATERIAL;
  need(textures.materials === MATERIAL_NAMES.length, `${textures.materials} materials were built`);
  need(textures.textures === expectedTextures, `${textures.textures} textures, not ${expectedTextures}`);
  const unique = new Set(textures.names).size === textures.names.length;
  need(unique, `a texture name is repeated: ${textures.names}`);
  for (const material of MATERIAL_NAMES) {
    const mine = textures.names.filter((entry) => entry.startsWith(`${material}:`));
    need(mine.length === MAPS_PER_MATERIAL, `${material} has ${mine.length} maps: ${mine.join(', ')}`);
  }
  need(first.diag.textureCount === expectedTextures, `__diag ${first.diag.textureCount} textures`);
  need(first.diag.bytes > 0, `__diag.materials.bytes is ${first.diag.bytes}`);
  // Shared, not per-mesh: as many distinct albedo maps as material objects.
  const shared = walk.distinctMaterials === walk.distinctAlbedoMaps;
  need(shared, `${walk.distinctMaterials} materials, ${walk.distinctAlbedoMaps} albedo maps`);
  // One material per mesh is the thing this budget forbids.
  need(walk.distinctMaterials < walk.surfaces, `${walk.surfaces} surfaces, as many materials`);

  // --- US3-S10 / FR-011: mipmaps and the declared anisotropy are in effect.
  const anisotropy = declaredAnisotropy(root);
  need(anisotropy != null, 'no TEXTURE_ANISOTROPY in src/materials/texture-adapter.ts');
  const declared = anisotropy == null || textures.anisotropy === anisotropy;
  need(declared, `the page reports anisotropy ${textures.anisotropy}, the source ${anisotropy}`);
  need(textures.reports.length === expectedTextures, 'not every texture reported its sampling');
  for (const it of textures.reports) {
    need(it.generateMipmaps, `${it.name} was uploaded without mipmaps`);
    need(it.minFilter === textures.mipmapFilter, `${it.name} minifies without a mipmap filter`);
    need(it.anisotropy === textures.anisotropy, `${it.name} carries anisotropy ${it.anisotropy}`);
    // Without repeat wrapping a UV span above 1 clamps instead of tiling.
    const wraps = it.wrapS === textures.repeatWrapping && it.wrapT === textures.repeatWrapping;
    need(wraps, `${it.name} does not repeat-wrap`);
    const sRgb = it.colorSpace === 'srgb';
    need(it.role === 'albedo' ? sRgb : !sRgb, `${it.name} is in colour space '${it.colorSpace}'`);
    need(it.size > 0, `${it.name} was uploaded with no size`);
  }

  // --- US3-S7 / FR-010: the budget holds from four places in the level.
  const atSpawn = first.drawCalls < DRAW_CALL_CEILING && first.drawCalls > 0;
  need(atSpawn, `drawCalls at the spawn tile is ${first.drawCalls}, not below ${DRAW_CALL_CEILING}`);
  const seen = [`spawn:${first.drawCalls}`];
  for (const [where, vx, vz] of [['north', 0, -5.4], ['east', 5.4, 0], ['south', 0, 5.4]]) {
    const at = await driveTo(page, vx, vz, 12);
    seen.push(`${where}:${at.drawCalls}`);
    const held = at.drawCalls < DRAW_CALL_CEILING && at.drawCalls > 0;
    need(held, `drawCalls at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}) is ${at.drawCalls}`);
  }

  // --- US3-S9 / FR-011: a resize regenerates nothing.
  const before = await read();
  await page.setViewportSize({ width: 960, height: 600 });
  await frames(page, 5);
  const resized = await read();
  // A moved generation time means a texture was regenerated.
  need(
    resized.diag.generatedMs === before.diag.generatedMs,
    `generation time moved from ${before.diag.generatedMs} to ${resized.diag.generatedMs}`,
  );
  const sameSet =
    resized.diag.textureCount === before.diag.textureCount &&
    resized.textures.names.join(',') === before.textures.names.join(',');
  need(sameSet, `the uploaded texture set changed across a resize: ${resized.textures.names}`);
  const kept = resized.survey.untexturedMeshes;
  need(kept === 0, `${kept} surface(s) lost their material across a resize`);
  need(resized.drawCalls < DRAW_CALL_CEILING, `drawCalls after a resize is ${resized.drawCalls}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await frames(page, 5);

  // --- US3-S11: the textured level clears the declared floor with the enemy
  // system live. The floor is 001's and is not lowered here.
  const settled = await read();
  const clears = settled.fps > SMOKE_FPS_FLOOR;
  need(clears, `fps ${settled.fps.toFixed(1)} is under the declared floor ${SMOKE_FPS_FLOOR}`);
  need(settled.errors.length === 0, `__diag.errors after the materials pass: ${settled.errors}`);

  // Printed, not merely asserted: a pass that squeaked should read as one.
  console.log(
    `  materials: ${walk.surfaces} surfaces on ${walk.distinctMaterials} materials, ` +
      `${textures.textures} textures in ${first.diag.generatedMs.toFixed(0)}ms; drawCalls ` +
      `${seen.join(' ')}; longest run ${longest.toFixed(1)} UV units; fps ${settled.fps.toFixed(1)}`,
  );

  return failures;
}
