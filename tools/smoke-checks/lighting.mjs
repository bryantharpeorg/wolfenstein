/**
 * 005 US4's render-loop half, asserted on the built page (FR-012, FR-013,
 * FR-016, US4-S1..S8). None of it is reachable from a vitest run: whether the
 * shadow map is really on, whether an occluded floor sample is really darker
 * than the same sample unoccluded, whether an unlit corner is really not black,
 * and what the frame rate is once all of it is switched on.
 *
 * Every number compared here is parsed out of `src/lighting/constants.ts`
 * rather than restated, so tuning the rig moves the page and this check
 * together and a constant renamed away fails the gate loudly instead of quietly
 * disabling an assertion. Discovered by tools/smoke.mjs; returns its failures,
 * which the harness prints before exiting non-zero.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** FR-010's ceiling, restated so this check fails on it independently. */
const DRAW_CALL_CEILING = 20;
const FPS_SETTLE_FRAMES = 120;

/** FR-015's whole field list, so US4 cannot complete `__diag.materials` by
 * dropping one of the fields 001-004 put there. */
const MATERIALS_FIELDS = ['generatedMs', 'textureCount', 'bytes', 'untexturedMeshes',
  'lights', 'shadowsEnabled', 'fallbacks', 'materials'];
/** 001's contract plus what 002, 003 and 004 added: additive means additive. */
const DIAG_FIELDS = ['ready', 'renderer', 'fps', 'frameTimeMs', 'drawCalls', 'errors',
  'fallbackReason', 'level', 'player', 'interaction'];
const NAMES = ['POINT_LIGHT_COUNT', 'SHADOW_CASTING_LIGHTS', 'SHADOW_MAP_SIZE', 'SHADOW_BIAS',
  'SHADOW_NORMAL_BIAS', 'AMBIENT_COLOR', 'AMBIENT_INTENSITY', 'FOG_COLOR', 'FOG_NEAR', 'FOG_FAR',
  'MAX_FOG_FACTOR_AT_SIGHT_LINE', 'SHADOW_CONTRAST_MARGIN', 'MIN_CORNER_LUMINANCE'];

/** The declared constants, read from the one file US4 declares them in. */
function readDeclared() {
  const source = readFileSync(resolve(root, 'src/lighting/constants.ts'), 'utf8');
  const declared = {};
  for (const m of source.matchAll(/^export const ([A-Z0-9_]+) = (-?[\d.]+|0x[\da-fA-F]+);$/gm)) {
    declared[m[1]] = Number(m[2]);
  }
  return declared;
}

const read = (page, key) =>
  page.evaluate((k) => (window.__diag[k] == null ? null : JSON.parse(JSON.stringify(window.__diag[k]))), key);

const probeOf = (page) =>
  page.evaluate(async () => (typeof window.__lightingProbe === 'function' ? await window.__lightingProbe() : null));

const settle = (page, frames) =>
  page.evaluate((n) => new Promise((done) => {
    let seen = 0;
    const tick = () => (seen >= n ? done() : (seen += 1, requestAnimationFrame(tick)));
    requestAnimationFrame(tick);
  }), frames);

/** FR-014's degraded build, driven on its own page: shadows refused, ambient
 * and fog still shipped, every surface still textured, the reason carried in
 * `__diag.materials.fallbacks`. A degradation with no trigger is one nothing
 * ever proves works (US4-S6). */
async function checkDegraded(page, url, d, bad) {
  const degraded = await page.context().newPage();
  degraded.on('pageerror', (e) => bad(true, `degraded build: pageerror: ${e.message}`));
  try {
    await degraded.goto(`${url}?noshadows=1`, { waitUntil: 'load' });
    await degraded.waitForFunction(() => window.__diag?.ready === true, { timeout: 15000 });
    const lighting = await read(degraded, 'lighting');
    const materials = await read(degraded, 'materials');
    if (lighting == null || materials == null) {
      bad(true, 'degraded build: __diag.lighting or __diag.materials is missing');
      return;
    }
    bad(lighting.shadowsEnabled !== false || materials.shadowsEnabled !== false,
      `degraded build: shadowsEnabled is ${lighting.shadowsEnabled}/${materials.shadowsEnabled}, not false (FR-014, US4-S6)`);
    const shadow = (materials.fallbacks ?? []).find((f) => f?.map === 'shadow' && f?.name === 'lighting');
    bad(shadow == null || !/shadow/i.test(shadow.reason ?? ''),
      `degraded build: no shadow fallback in __diag.materials.fallbacks: ${JSON.stringify(materials.fallbacks)} (FR-014, US4-S6)`);
    bad(materials.untexturedMeshes !== 0,
      `degraded build: untexturedMeshes is ${materials.untexturedMeshes}, not 0 — FR-014 keeps every surface textured (US4-S6)`);
    bad(lighting.fog?.far !== d.FOG_FAR || lighting.ambient?.intensity !== d.AMBIENT_INTENSITY,
      `degraded build: ambient/fog is ${lighting.ambient?.intensity}/${JSON.stringify(lighting.fog)}, not the declared ${d.AMBIENT_INTENSITY}/${d.FOG_FAR} — FR-014 still ships both (US4-S6)`);
    const probe = await probeOf(degraded);
    bad(probe?.supported === true && !(probe.corner >= d.MIN_CORNER_LUMINANCE),
      `degraded build: unlit corner reads ${probe?.corner?.toFixed(2)}, below the declared ${d.MIN_CORNER_LUMINANCE} (US4-S3, US4-S6)`);
  } finally {
    await degraded.close();
  }
}

export async function check({ page, url }) {
  const errors = [];
  const bad = (failed, message) => { if (failed) errors.push(message); };
  const d = readDeclared();
  const missing = NAMES.filter((n) => !Number.isFinite(d[n]));
  if (missing.length > 0) return [`src/lighting/constants.ts declares no ${missing.join(', ')} — FR-012/FR-013 require it`];

  const lighting = await read(page, 'lighting');
  if (lighting == null) return ['window.__diag.lighting is missing (FR-012, FR-013, US4-S1)'];
  const materials = (await read(page, 'materials')) ?? {};

  // FR-015, US4-S7: additive over 001-004, nothing renamed or dropped.
  for (const field of MATERIALS_FIELDS) {
    bad(!Object.prototype.hasOwnProperty.call(materials, field),
      `__diag.materials is missing the FR-015 field '${field}' (US4-S7)`);
  }
  const lost = await page.evaluate((f) => f.filter((k) => !(k in window.__diag)), DIAG_FIELDS);
  bad(lost.length > 0, `__diag lost the pre-existing field(s) ${lost.join(', ')} (FR-015, US4-S7)`);
  bad(!Array.isArray(materials.materials) || materials.materials.some((m) =>
    typeof m?.name !== 'string' || typeof m?.hasNormal !== 'boolean' || typeof m?.hasRoughness !== 'boolean'),
  `__diag.materials.materials is not a list of {name, hasNormal, hasRoughness}: ${JSON.stringify(materials.materials)} (FR-015, US4-S7)`);

  // FR-012, US4-S1: count and shadow map, both against declared constants.
  bad(lighting.pointLights !== d.POINT_LIGHT_COUNT,
    `the scene carries ${lighting.pointLights} point lights, not the declared ${d.POINT_LIGHT_COUNT} (FR-012, US4-S1)`);
  bad(lighting.shadowCastingLights !== d.SHADOW_CASTING_LIGHTS,
    `${lighting.shadowCastingLights} lamps carry a shadow map, not the declared ${d.SHADOW_CASTING_LIGHTS} (FR-012, US4-S1)`);
  bad(!(lighting.pointLights >= 2) || !(lighting.shadowCastingLights >= 2),
    `FR-012 requires at least two shadow-mapped point lights; the scene has ${lighting.pointLights}, ${lighting.shadowCastingLights} shadowed`);
  bad(materials.lights !== lighting.pointLights,
    `__diag.materials.lights is ${materials.lights} but the scene has ${lighting.pointLights} point lights (FR-015, US4-S7)`);
  bad(materials.shadowsEnabled !== lighting.shadowsEnabled,
    `__diag.materials.shadowsEnabled ${materials.shadowsEnabled} disagrees with __diag.lighting ${lighting.shadowsEnabled} (US4-S7)`);
  for (const [field, name] of [['shadowMapSize', 'SHADOW_MAP_SIZE'], ['shadowBias', 'SHADOW_BIAS'],
    ['shadowNormalBias', 'SHADOW_NORMAL_BIAS']]) {
    bad(lighting[field] !== d[name],
      `__diag.lighting.${field} is ${lighting[field]}, not the declared ${name} ${d[name]} (US4-S1)`);
  }
  bad(lighting.ambient?.intensity !== d.AMBIENT_INTENSITY || lighting.ambient?.color !== d.AMBIENT_COLOR,
    `the ambient term is ${JSON.stringify(lighting.ambient)}, not the declared ${d.AMBIENT_COLOR}/${d.AMBIENT_INTENSITY} (FR-013, US4-S3)`);

  // FR-013, US4-S4: the fog is declared, and it does not swallow the exit.
  const fog = lighting.fog;
  bad(fog == null || fog.color !== d.FOG_COLOR || fog.near !== d.FOG_NEAR || fog.far !== d.FOG_FAR,
    `the scene's fog is ${JSON.stringify(fog)}, not the declared ${d.FOG_COLOR}/${d.FOG_NEAR}/${d.FOG_FAR} (FR-013, US4-S4)`);
  bad(!(fog?.far > lighting.longestSightLine),
    `fog far ${fog?.far} does not clear the level's longest sight-line ${lighting.longestSightLine} — its far end is fogged out (FR-013, US4-S4)`);
  bad(!(lighting.fogFactorAtSightLine <= d.MAX_FOG_FACTOR_AT_SIGHT_LINE),
    `fog reaches ${lighting.fogFactorAtSightLine?.toFixed(3)} at the far end of the longest sight-line, past the declared ${d.MAX_FOG_FACTOR_AT_SIGHT_LINE} (US4-S4)`);
  bad(lighting.exitSightLine == null,
    'the shipped level reports no exit sight-line, so US4-S4 cannot be decided');
  bad(lighting.exitSightLine != null && !(lighting.fogFactorAtExit < d.MAX_FOG_FACTOR_AT_SIGHT_LINE),
    `the exit tile is ${lighting.fogFactorAtExit?.toFixed(3)} fogged from the far end of its own ${lighting.exitSightLine}-unit sight-line, past the declared ${d.MAX_FOG_FACTOR_AT_SIGHT_LINE} (FR-013, US4-S4)`);

  // FR-016, US4-S5, US4-S8: the budget this story is most likely to spend.
  // Read before the probe runs, so the numbers are the render loop's own.
  await settle(page, FPS_SETTLE_FRAMES);
  const frame = await page.evaluate(() => ({ fps: window.__diag.fps, drawCalls: window.__diag.drawCalls }));
  bad(!(frame.fps >= SMOKE_FPS_FLOOR),
    `fps is ${frame.fps?.toFixed(1)} after ${FPS_SETTLE_FRAMES} frames, below 001's declared floor ${SMOKE_FPS_FLOOR} (FR-016, US4-S5)`);
  bad(!Number.isInteger(frame.drawCalls) || frame.drawCalls >= DRAW_CALL_CEILING,
    `drawCalls is ${frame.drawCalls}, not an integer below ${DRAW_CALL_CEILING} (FR-016, US4-S8)`);
  bad(materials.untexturedMeshes !== 0,
    `untexturedMeshes is ${materials.untexturedMeshes}, not 0 — a mesh reached the lit frame with no albedo map (FR-016, US4-S8)`);

  // US4-S2, US4-S3: the evidence that shadows are cast, not merely enabled.
  const probe = await probeOf(page);
  if (probe == null) {
    bad(true, 'window.__lightingProbe is missing, so no shadow evidence could be read (US4-S2)');
  } else if (probe.supported !== true) {
    // Unreadable evidence is only acceptable where the story already degraded.
    bad(lighting.shadowsEnabled !== false,
      `the shadow probe is unsupported (${probe.reason}) while shadowsEnabled is true — US4-S2 cannot be decided from a flag alone`);
  } else {
    bad(lighting.shadowsEnabled && !(probe.occluded < probe.unoccluded * (1 - d.SHADOW_CONTRAST_MARGIN)),
      `the occluded floor sample at (${probe.occludedTile?.x}, ${probe.occludedTile?.z}) reads ${probe.occluded?.toFixed(2)} against ${probe.unoccluded?.toFixed(2)} with its wall hidden — not the declared ${d.SHADOW_CONTRAST_MARGIN * 100}% darker, so shadows are enabled but not cast (FR-012, US4-S2)`);
    bad(!(probe.corner >= d.MIN_CORNER_LUMINANCE),
      `the unlit tile at (${probe.cornerTile?.x}, ${probe.cornerTile?.z}) reads ${probe.corner?.toFixed(2)}, below the declared floor ${d.MIN_CORNER_LUMINANCE} — the ambient term does not keep it readable (FR-013, US4-S3)`);
  }

  await checkDegraded(page, url, d, bad);
  return errors;
}
