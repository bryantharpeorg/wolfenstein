// US4's render-loop half, on the built page (FR-016, US4-S1..S8): the facts no
// vitest run can reach, each compared against the constant US4 declares.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CEILING = 20;
const FRAMES = 120;
function readDeclared() {
  const source = readFileSync(resolve(root, 'src/lighting/constants.ts'), 'utf8');
  const declared = {};
  for (const e of source.matchAll(/^export const ([A-Z0-9_]+) = (-?[\d.]+|0x[\da-fA-F]+);$/gm)) declared[e[1]] = Number(e[2]);
  return declared;
}

const read = (page, key) =>
  page.evaluate((k) => (window.__diag[k] == null ? null : JSON.parse(JSON.stringify(window.__diag[k]))), key);

export async function check({ page }) {
  const errors = [];
  const bad = (failed, message) => { if (failed) errors.push(message); };
  const d = readDeclared();
  const g = await read(page, 'lighting');
  if (g == null) return ['window.__diag.lighting is missing (FR-012, FR-013, US4-S1)'];
  const m = (await read(page, 'materials')) ?? {};

  for (const [got, want, what] of [
    [g.pointLights, d.POINT_LIGHT_COUNT, 'point lights (FR-012, US4-S1)'],
    [g.shadowCastingLights, d.SHADOW_CASTING_LIGHTS, 'mapped lamps (FR-012, US4-S1)'],
    [g.shadowMapSize, d.SHADOW_MAP_SIZE, 'shadow-map size (US4-S1)'],
    [g.ambientIntensity, d.AMBIENT_INTENSITY, 'ambient level (FR-013, US4-S3)'],
    [g.fog?.color, d.FOG_COLOR, 'fog colour (FR-013, US4-S4)'],
    [g.fog?.near, d.FOG_NEAR, 'fog near (FR-013, US4-S4)'],
    [g.fog?.far, d.FOG_FAR, 'fog far (FR-013, US4-S4)'],
    [m.lights, g.pointLights, 'materials.lights (FR-015, US4-S7)'],
    [m.shadowsEnabled, g.shadowsEnabled, 'materials.shadowsEnabled (US4-S7)'],
  ]) bad(got !== want || want === undefined, `${what} is ${got}, not ${want}`);
  bad(g.pointLights < 2 || g.shadowCastingLights < 2,
    `FR-012 wants two shadow-mapped lights; ${g.pointLights} lit, ${g.shadowCastingLights} mapped`);
  bad(g.shadowsEnabled === false && !(m.fallbacks ?? []).some((f) => f?.map === 'shadow'),
    'shadows off with no reason in __diag.materials.fallbacks (FR-014, US4-S6)');
  bad(!m.materials?.every?.((e) => e?.name && typeof e.hasNormal === 'boolean'),
    '__diag.materials.materials is not a {name, hasNormal, hasRoughness} list (US4-S7)');
  bad(!(g.fog?.far > g.longestSightLine),
    `fog far ${g.fog?.far} does not clear the longest sight-line ${g.longestSightLine} (US4-S4)`);

  await page.evaluate((n) => new Promise((done) => {
    let seen = 0;
    const tick = () => (seen >= n ? done() : (seen += 1, requestAnimationFrame(tick)));
    requestAnimationFrame(tick);
  }), FRAMES);
  const f = await page.evaluate(() => ({ fps: window.__diag.fps, drawCalls: window.__diag.drawCalls }));
  bad(!(f.fps >= SMOKE_FPS_FLOOR),
    `fps is ${f.fps?.toFixed(1)} after ${FRAMES} frames, below 001's floor ${SMOKE_FPS_FLOOR} (FR-016, US4-S5)`);
  bad(!Number.isInteger(f.drawCalls) || f.drawCalls >= CEILING,
    `drawCalls is ${f.drawCalls}, not an integer below ${CEILING} (FR-016, US4-S8)`);
  bad(m.untexturedMeshes !== 0,
    `untexturedMeshes is ${m.untexturedMeshes}: a mesh is in the lit frame unskinned (FR-016, US4-S8)`);

  // US4-S2, US4-S3: shadows cast, not merely enabled, and a readable corner.
  const p = (await page.evaluate(async () =>
    (typeof window.__lightingProbe === 'function' ? await window.__lightingProbe() : null))) ?? {};
  if (p.supported !== true) {
    bad(g.shadowsEnabled !== false, `no shadow evidence (${p.reason}) while shadowsEnabled is true (US4-S2)`);
  } else {
    bad(g.shadowsEnabled && !(p.occluded < p.unoccluded * (1 - d.SHADOW_CONTRAST_MARGIN)),
      `occluded floor ${p.occluded?.toFixed(2)} against ${p.unoccluded?.toFixed(2)} unshadowed, short of ${d.SHADOW_CONTRAST_MARGIN * 100}% darker: enabled but not cast (FR-012, US4-S2)`);
    bad(!(p.corner >= d.MIN_CORNER_LUMINANCE),
      `unlit corner ${p.corner?.toFixed(2)}, below the declared ${d.MIN_CORNER_LUMINANCE} (FR-013, US4-S3)`);
  }
  return errors;
}
