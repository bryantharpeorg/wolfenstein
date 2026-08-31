// US3 runtime assertion: the level is fully textured and 002's draw-call budget
// survived being skinned. Tests __diag.materials.untexturedMeshes, drawCalls at
// multiple camera positions, one map set per material, and no regeneration on
// viewport resize (FR-008, FR-010, FR-011, US3-S2, US3-S5, US3-S8, US3-S9).

export const name = 'materials';

const CAMERA_POSITIONS = [
  { x: 10.5, z: 10.5, yaw: 0 },
  { x: 30.5, z: 10.5, yaw: Math.PI / 2 },
  { x: 30.5, z: 30.5, yaw: Math.PI },
  { x: 55.5, z: 55.5, yaw: -Math.PI / 2 },
];

async function moveCamera(page, { x, z, yaw }) {
  await page.evaluate(
    ({ px, pz, pyaw }) => {
      window.__diag.player.x = px;
      window.__diag.player.z = pz;
      window.__diag.player.yaw = pyaw;
      const camera = window.__smokeCamera;
      if (camera != null) {
        camera.position.set(px, 1.5, pz);
        camera.lookAt(px - Math.sin(pyaw), 1.5, pz - Math.cos(pyaw));
      }
    },
    { px: x, pz: z, pyaw: yaw },
  );
  // Let a few frames render at the new camera position so drawCalls settles.
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

  // Expose the camera for scripted moves.
  await page.evaluate(() => {
    // @ts-ignore
    window.__smokeCamera = window.__diag.__camera ?? null;
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

  for (const position of CAMERA_POSITIONS) {
    await moveCamera(page, position);
    const reading = await readMaterials(page);
    if (reading.drawCalls >= 20) {
      failures.push(
        `drawCalls ${reading.drawCalls} is not under 20 at (${position.x}, ${position.z})`,
      );
    }
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
