// The billboard itself, under `npm run test` (FR-009, FR-010, US4-S1, US4-S5,
// US4-S6, US4-S7, US4-S8).
//
// `billboard.ts` imports three.js and so is not one of this spec's DOM-free
// modules, but almost none of it needs a page: a `Mesh` and a `PlaneGeometry`
// are plain objects in node, and the one thing that does need a browser -- the
// canvas the sheet is drawn on -- is injected here as a bare `Texture`. What is
// left in the smoke gate is that pixels actually appear, which is where that
// question belongs.

import { describe, it, expect, beforeEach } from 'vitest';
import { Texture, type BufferAttribute } from 'three';
import {
  BILLBOARD_SIZE,
  billboardMaterial,
  billboardYaw,
  createBillboard,
  isInFrontOfCamera,
  resetBillboardMaterialsForTest,
  updateBillboard,
  type BillboardGuard,
  type CameraPose,
} from '../../src/enemy/billboard';
import { DEATH_ANIMATION_MS, DEATH_FRAME_MS, WALK_FRAME_MS, buildSheetPlan } from '../../src/enemy/sprite-shape';
import type { GuardSheet } from '../../src/enemy/sprite-sheet';
import { VIEW_ANGLE_COUNT, viewAngleFor } from '../../src/enemy/view-angle';

const plan = buildSheetPlan();

/** The sheet with its canvas left out: nothing below draws a pixel. */
function testSheet(type = 'test-guard'): GuardSheet {
  return { type, plan, canvas: null as unknown as HTMLCanvasElement, texture: new Texture() };
}

function guardAt(x: number, z: number, facing = 0, state: BillboardGuard['state'] = 'idle'): BillboardGuard {
  return { x, z, facing, state };
}

/** A camera at `(x, z)` looking at `(atX, atZ)`, in world units. */
function cameraLookingAt(x: number, z: number, atX: number, atZ: number): CameraPose {
  const dx = atX - x;
  const dz = atZ - z;
  const length = Math.hypot(dx, dz) || 1;
  return { x, z, forwardX: dx / length, forwardZ: dz / length };
}

/** The world-space normal of a quad whose only rotation is about Y. */
function meshNormal(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

beforeEach(() => {
  resetBillboardMaterialsForTest();
});

describe('the quad faces the camera (US4-S1)', () => {
  it('points its normal at the camera from every bearing, not along an axis', () => {
    const guard = guardAt(10, 10);
    const yaws = new Set<number>();
    for (let step = 0; step < 16; step += 1) {
      const bearing = (step * Math.PI * 2) / 16;
      const camera = cameraLookingAt(10 + 4 * Math.sin(bearing), 10 + 4 * Math.cos(bearing), 10, 10);
      const yaw = billboardYaw(camera, guard);
      const normal = meshNormal(yaw);
      // The normal and the line to the camera are the same direction: their
      // cross product on the plane vanishes and their dot is positive.
      const toCameraX = camera.x - guard.x;
      const toCameraZ = camera.z - guard.z;
      const length = Math.hypot(toCameraX, toCameraZ);
      expect(normal.x * toCameraZ - normal.z * toCameraX).toBeCloseTo(0, 10);
      expect(normal.x * (toCameraX / length) + normal.z * (toCameraZ / length)).toBeCloseTo(1, 10);
      yaws.add(Math.round(yaw * 1000));
    }
    // An axis-aligned card would answer the same handful of yaws all the way
    // round; this one answers a different one at every bearing.
    expect(yaws.size).toBe(16);
  });

  it('stands the quad on the floor and turns it about Y alone', () => {
    const sheet = testSheet();
    const guard = guardAt(3, 7);
    const billboard = createBillboard(guard, sheet);
    updateBillboard(billboard, guard, cameraLookingAt(3, 11, 3, 7), plan, 16);
    expect(billboard.mesh.position.y).toBeCloseTo(BILLBOARD_SIZE / 2, 10);
    expect(billboard.mesh.position.x).toBeCloseTo(3, 10);
    expect(billboard.mesh.position.z).toBeCloseTo(7, 10);
    expect(billboard.mesh.rotation.x).toBe(0);
    expect(billboard.mesh.rotation.z).toBe(0);
  });

  it('keeps a coincident camera from producing a NaN yaw', () => {
    expect(billboardYaw({ x: 5, z: 5, forwardX: 0, forwardZ: -1 }, guardAt(5, 5))).toBe(0);
  });
});

describe('the frame comes from the bearing (FR-010, US4-S3)', () => {
  it('writes the column the pure bearing function chose into the quad UVs', () => {
    const sheet = testSheet();
    const guard = guardAt(20, 20, 0.7);
    const billboard = createBillboard(guard, sheet);
    const seen = new Set<number>();

    for (let step = 0; step < VIEW_ANGLE_COUNT; step += 1) {
      const bearing = (step * Math.PI * 2) / VIEW_ANGLE_COUNT;
      const camera = cameraLookingAt(20 - 3 * Math.sin(bearing), 20 - 3 * Math.cos(bearing), 20, 20);
      const chosen = updateBillboard(billboard, guard, camera, plan, 0);
      expect(chosen).toBe(viewAngleFor(guard, guard.facing, { x: camera.x, z: camera.z }));
      seen.add(chosen);

      const uv = billboard.mesh.geometry.getAttribute('uv') as BufferAttribute;
      expect(uv.getX(0)).toBeCloseTo(chosen / plan.angles, 10);
      expect(uv.getX(1)).toBeCloseTo((chosen + 1) / plan.angles, 10);
    }
    // Eight bearings, eight columns: the orbit the smoke gate drives, without a
    // browser (US4-S4's arithmetic half).
    expect(seen.size).toBe(VIEW_ANGLE_COUNT);
  });

  it('advances the walk cycle only while the guard is actually moving', () => {
    const sheet = testSheet();
    let guard = guardAt(2, 2);
    const billboard = createBillboard(guard, sheet);
    const camera = cameraLookingAt(2, 6, 2, 2);

    for (let i = 0; i < 10; i += 1) updateBillboard(billboard, guard, camera, plan, WALK_FRAME_MS);
    expect(billboard.walkElapsedMs).toBe(0);
    expect(billboard.frame).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      guard = guardAt(2 + (i + 1) * 0.2, 2);
      updateBillboard(billboard, guard, camera, plan, WALK_FRAME_MS);
    }
    expect(billboard.walkElapsedMs).toBe(WALK_FRAME_MS * 3);
    expect(billboard.frame).toBe(3 % plan.walkFrames);
    expect(billboard.frame).toBeLessThan(plan.walkFrames);
  });
});

describe('death animation (US4-S5, US4-S6)', () => {
  it('advances the death frames over the declared duration and then holds', () => {
    const sheet = testSheet();
    const chasing = guardAt(8, 8, 0, 'chase');
    const billboard = createBillboard(chasing, sheet);
    const camera = cameraLookingAt(8, 12, 8, 8);
    updateBillboard(billboard, chasing, camera, plan, 16);
    expect(billboard.frame).toBeLessThan(plan.walkFrames);

    const dead = guardAt(8, 8, 0, 'death');
    const frames: number[] = [];
    for (let elapsed = 0; elapsed < DEATH_ANIMATION_MS; elapsed += DEATH_FRAME_MS) {
      updateBillboard(billboard, dead, camera, plan, DEATH_FRAME_MS);
      frames.push(billboard.frame);
    }
    // Every declared death row, in order, none of them a walk row.
    expect(frames).toEqual(
      Array.from({ length: plan.deathFrames }, (_, i) => plan.walkFrames + i),
    );

    // And held afterwards, for as long as the corpse lies there.
    for (let i = 0; i < 20; i += 1) updateBillboard(billboard, dead, camera, plan, 100);
    expect(billboard.frame).toBe(plan.frames - 1);
  });

  it('never rewinds the death clock once it has started', () => {
    const sheet = testSheet();
    const dead = guardAt(1, 1, 0, 'death');
    const billboard = createBillboard(dead, sheet);
    const camera = cameraLookingAt(1, 5, 1, 1);
    let previous = -1;
    for (let i = 0; i < 40; i += 1) {
      updateBillboard(billboard, dead, camera, plan, 40);
      expect(billboard.frame).toBeGreaterThanOrEqual(previous);
      previous = billboard.frame;
    }
  });
});

describe('culling and sharing (US4-S7, US4-S8)', () => {
  it('draws nothing for a guard behind the camera', () => {
    const sheet = testSheet();
    const guard = guardAt(5, 5);
    const billboard = createBillboard(guard, sheet);

    const facing = cameraLookingAt(5, 9, 5, 5);
    updateBillboard(billboard, guard, facing, plan, 16);
    expect(billboard.visible).toBe(true);
    expect(billboard.mesh.visible).toBe(true);

    // Same place, turned around: the guard is behind the camera's own plane.
    const away = { ...facing, forwardX: -facing.forwardX, forwardZ: -facing.forwardZ };
    updateBillboard(billboard, guard, away, plan, 16);
    expect(billboard.visible).toBe(false);
    expect(billboard.mesh.visible).toBe(false);
    expect(isInFrontOfCamera(away, guard)).toBe(false);
  });

  it('still reports the bearing of a guard it did not draw', () => {
    const sheet = testSheet();
    const guard = guardAt(5, 5, Math.PI);
    const billboard = createBillboard(guard, sheet);
    const away = { x: 5, z: 9, forwardX: 0, forwardZ: 1 };
    const chosen = updateBillboard(billboard, guard, away, plan, 16);
    expect(billboard.visible).toBe(false);
    expect(chosen).toBe(viewAngleFor(guard, guard.facing, { x: away.x, z: away.z }));
  });

  it('shares one material, and so one texture, across every guard of a type', () => {
    const sheet = testSheet();
    const first = createBillboard(guardAt(1, 1), sheet);
    const second = createBillboard(guardAt(2, 2), sheet);
    expect(first.mesh.material).toBe(second.mesh.material);
    expect(billboardMaterial(sheet)).toBe(first.mesh.material);
    // The UVs are per guard, which is how they show different frames at once.
    expect(first.mesh.geometry).not.toBe(second.mesh.geometry);
  });

  it('cuts the sprite out rather than blending it, so one guard is one draw', () => {
    const material = billboardMaterial(testSheet());
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBeGreaterThan(0);
  });
});
