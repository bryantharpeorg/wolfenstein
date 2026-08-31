/**
 * 005 US3's render-loop half, asserted on the built page because none of it is
 * reachable from a vitest run: whether a mesh reached the frame with no albedo
 * map, the draw-call count from a camera, how many textures were really
 * uploaded and with what sampler state, and whether a resize regenerated any
 * (FR-008, FR-010, FR-011, US3-S2, US3-S7..S11). Discovered by
 * tools/smoke-check-runner.mjs, which hands each module its own freshly loaded
 * page and collects the failures it returns for the harness to print before
 * exiting non-zero.
 */
import { SMOKE_FPS_FLOOR } from '../smoke-floor.mjs';

/** FR-010's ceiling, restated so the harness fails on it independently. */
const DRAW_CALL_CEILING = 20;
/** Five materials (FR-002), three maps each: albedo, normal, roughness. */
const MATERIAL_COUNT = 5;
const MAPS_PER_MATERIAL = 3;
/** The anisotropy FR-011 declares; the renderer may clamp no lower. */
const ANISOTROPY = 4;
/** Reached through no door, so this does not depend on 004's door state. */
const CAMERA_POSITIONS = [
  [18.5, 3.5],
  [3.5, 18.5],
  [18.5, 18.5],
];

const EXPECTED_TEXTURES = MATERIAL_COUNT * MAPS_PER_MATERIAL;

/** Waits `frames` animation frames, so a draw-call count read after a camera
 * move is the count for the view the camera is in now. */
const settle = (page, frames) =>
  page.evaluate(
    (count) =>
      new Promise((done) => {
        let seen = 0;
        const tick = () => (seen++ >= count ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );

const readMaterials = (page) =>
  page.evaluate(() =>
    window.__diag.materials == null ? null : JSON.parse(JSON.stringify(window.__diag.materials)),
  );

const readProbe = (page) =>
  page.evaluate(() =>
    typeof window.__materialsProbe === 'function' ? window.__materialsProbe() : null,
  );

export default async function check({ page }) {
  const errors = [];
  const materials = await readMaterials(page);
  if (materials == null) return ['window.__diag.materials is missing (FR-015)'];

  // US3-S2 / FR-008: the milestone's DONE condition, as one integer.
  if (materials.untexturedMeshes !== 0) {
    errors.push(`untexturedMeshes is ${materials.untexturedMeshes}, not 0 (FR-008, US3-S2)`);
  }

  // US3-S8 / FR-010: one set of maps per material, shared, not one per mesh.
  if (materials.materials?.length !== MATERIAL_COUNT) {
    errors.push(`materials lists ${materials.materials?.length} entries, not ${MATERIAL_COUNT}`);
  }
  if (materials.textureCount !== EXPECTED_TEXTURES) {
    errors.push(
      `textureCount is ${materials.textureCount}, not ${EXPECTED_TEXTURES} — not one set of` +
        ` ${MAPS_PER_MATERIAL} maps per material (FR-010, US3-S8)`,
    );
  }
  if (!(materials.bytes > 0) || !(materials.generatedMs >= 0)) {
    errors.push(`bytes ${materials.bytes} / generatedMs ${materials.generatedMs} unreadable`);
  }

  // US3-S10 / FR-011: mipmaps and the declared anisotropy really in effect,
  // read off the textures the renderer holds rather than off the source.
  const probe = await readProbe(page);
  if (probe == null) {
    errors.push('window.__materialsProbe is missing, so no sampler state could be read');
  } else {
    if (probe.length !== EXPECTED_TEXTURES) {
      errors.push(
        `the scene binds ${probe.length} distinct textures, not ${EXPECTED_TEXTURES} — a map` +
          ' set is not shared by every mesh using it (FR-010, US3-S8)',
      );
    }
    const bad = probe.find((t) => !t.mipmapped || t.anisotropy < ANISOTROPY || !t.repeats);
    if (bad != null) {
      errors.push(
        `${bad.channel} map: mipmapped=${bad.mipmapped} anisotropy=${bad.anisotropy}` +
          ` repeatWrapped=${bad.repeats} — FR-011 declares all three (US3-S10)`,
      );
    }
    const albedo = probe.filter((t) => t.channel === 'albedo');
    if (albedo.length !== MATERIAL_COUNT || !albedo.every((t) => t.srgb)) {
      errors.push(`${albedo.length} albedo maps, sRGB on ${albedo.filter((t) => t.srgb).length}`);
    }
  }

  // US3-S7 / FR-010: the ceiling 002 won survives being skinned, read at the
  // spawn tile and three further camera positions rather than wherever the page
  // happened to start.
  if (await page.evaluate(() => typeof window.__playerDrive !== 'function')) {
    errors.push('window.__playerDrive is unavailable, so no camera position could be sampled');
  } else {
    const sample = () =>
      page.evaluate(() => ({
        x: window.__diag.player.x,
        z: window.__diag.player.z,
        drawCalls: window.__diag.drawCalls,
      }));
    const walkTo = ([tx, tz]) =>
      page.evaluate(([targetX, targetZ]) => {
        for (let step = 0; step < 400; step += 1) {
          const { x, z } = window.__diag.player;
          const away = Math.hypot(targetX - x, targetZ - z);
          if (away < 0.05) break;
          window.__playerDrive((4 * (targetX - x)) / away, (4 * (targetZ - z)) / away, 50);
          if (Math.hypot(window.__diag.player.x - x, window.__diag.player.z - z) < 1e-4) break;
        }
      }, [tx, tz]);

    await settle(page, 3);
    const sampled = [{ at: 'spawn', ...(await sample()) }];
    for (const target of CAMERA_POSITIONS) {
      await walkTo(target);
      await settle(page, 3);
      sampled.push({ at: `(${target[0]}, ${target[1]})`, ...(await sample()) });
    }
    for (const seen of sampled) {
      if (!Number.isInteger(seen.drawCalls) || seen.drawCalls >= DRAW_CALL_CEILING) {
        errors.push(
          `drawCalls is ${seen.drawCalls} at ${seen.at} (camera ${seen.x.toFixed(2)},` +
            ` ${seen.z.toFixed(2)}), not an integer below ${DRAW_CALL_CEILING} (US3-S7)`,
        );
      }
    }
  }

  // US3-S11: "without breaking the budget" is a frame-rate claim as well as a
  // draw-call one. Read after the loop has settled rather than off the first
  // frame, because a frame rate averaged over a single load-time frame measures
  // the load and not the loop — the one-time driver cost is paid at setup for
  // exactly this reason. The floor is the harness's own, imported rather than
  // restated so it cannot drift below it here.
  await settle(page, 60);
  const settledFps = await page.evaluate(() => window.__diag.fps);
  if (!(settledFps > SMOKE_FPS_FLOOR)) {
    errors.push(
      `settled fps ${settledFps.toFixed(1)} does not clear the floor ${SMOKE_FPS_FLOOR} with` +
        ' materials applied (US3-S11)',
    );
  }

  // US3-S9 / FR-011: a viewport change regenerates nothing. Unchanged timings
  // alone would not prove it — a rebuild reusing the memoised buffers moves no
  // number — so texture identity is compared too: a rebuilt map is a new uuid.
  const ids = (list) => (list ?? []).map((t) => t.id).join(',');
  const before = { materials: await readMaterials(page), probe: await readProbe(page) };
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  for (const size of [
    { width: viewport.width - 240, height: viewport.height - 160 },
    { width: viewport.width + 160, height: viewport.height + 120 },
  ]) {
    await page.setViewportSize(size);
    await settle(page, 5);
    const after = { materials: await readMaterials(page), probe: await readProbe(page) };
    if (ids(after.probe) !== ids(before.probe)) {
      errors.push(
        `textures changed identity after a resize to ${size.width}x${size.height} —` +
          ' one was regenerated (FR-011, US3-S9)',
      );
      break;
    }
    for (const field of ['generatedMs', 'textureCount', 'bytes', 'untexturedMeshes']) {
      if (after.materials?.[field] !== before.materials?.[field]) {
        errors.push(
          `${field} changed across a resize: ${before.materials?.[field]} ->` +
            ` ${after.materials?.[field]} (FR-011, US3-S9)`,
        );
      }
    }
  }
  await page.setViewportSize(viewport);

  return errors;
}
