// The two billboard facts nothing else asserts (US4-S1, US4-S5, US4-S6): the
// quad's normal points at the camera rather than along an axis, and its death
// clock advances over the declared duration and then holds. The bearing-to-column
// mapping is `enemy-view-angle.test.ts`'s; the texture count and the off-screen
// cull are measured in a real browser by `tools/smoke-checks/enemy-orbit.mjs`.
// `billboard.ts` imports three.js, but a `Mesh` is a plain object here and the
// sheet is injected canvas-less.

import { describe, it, expect, beforeEach } from 'vitest';
import { Texture } from 'three';
import {
  BILLBOARD_SIZE,
  billboardYaw,
  createBillboard,
  resetBillboardMaterialsForTest,
  updateBillboard,
  type BillboardGuard,
  type CameraPose,
} from '../../src/enemy/billboard';
import { DEATH_ANIMATION_MS, DEATH_FRAME_MS, buildSheetPlan } from '../../src/enemy/sprite-shape';
import type { GuardSheet } from '../../src/enemy/sprite-sheet';

const plan = buildSheetPlan();

/** The sheet with its canvas left out: nothing below draws a pixel. */
const testSheet = (): GuardSheet =>
  ({ type: 'test-guard', plan, canvas: null as unknown as HTMLCanvasElement, texture: new Texture() });

const guardAt = (x: number, z: number, state: BillboardGuard['state'] = 'idle'): BillboardGuard =>
  ({ x, z, facing: 0, state });

/** A camera at `(x, z)` looking at `(atX, atZ)`, in world units. */
function cameraLookingAt(x: number, z: number, atX: number, atZ: number): CameraPose {
  const dx = atX - x;
  const dz = atZ - z;
  const length = Math.hypot(dx, dz) || 1;
  return { x, z, forwardX: dx / length, forwardZ: dz / length };
}

beforeEach(resetBillboardMaterialsForTest);

describe('the quad faces the camera (US4-S1)', () => {
  it('points its normal at the camera from every bearing, not along an axis', () => {
    const guard = guardAt(10, 10);
    const yaws = new Set<number>();
    for (let step = 0; step < 16; step += 1) {
      const bearing = (step * Math.PI * 2) / 16;
      const camera = cameraLookingAt(10 + 4 * Math.sin(bearing), 10 + 4 * Math.cos(bearing), 10, 10);
      const yaw = billboardYaw(camera, guard);
      // The quad's only rotation is about Y, so its world normal is this.
      const normal = { x: Math.sin(yaw), z: Math.cos(yaw) };
      const toX = camera.x - guard.x;
      const toZ = camera.z - guard.z;
      const length = Math.hypot(toX, toZ);
      // Normal and line-to-camera are one direction: cross vanishes, dot is 1.
      expect(normal.x * toZ - normal.z * toX).toBeCloseTo(0, 10);
      expect(normal.x * (toX / length) + normal.z * (toZ / length)).toBeCloseTo(1, 10);
      yaws.add(Math.round(yaw * 1000));
    }
    // An axis-aligned card would answer the same handful of yaws all the way
    // round; this one answers a different one at every bearing.
    expect(yaws.size).toBe(16);
  });

  it('stands on the floor, turns about Y alone, and survives a coincident camera', () => {
    const guard = guardAt(3, 7);
    const billboard = createBillboard(guard, testSheet());
    updateBillboard(billboard, guard, cameraLookingAt(3, 11, 3, 7), plan, 16);
    expect(billboard.mesh.position.y).toBeCloseTo(BILLBOARD_SIZE / 2, 10);
    expect(billboard.mesh.position.x).toBeCloseTo(3, 10);
    expect(billboard.mesh.position.z).toBeCloseTo(7, 10);
    expect(billboard.mesh.rotation.x).toBe(0);
    expect(billboard.mesh.rotation.z).toBe(0);
    expect(billboardYaw({ x: 5, z: 5, forwardX: 0, forwardZ: -1 }, guardAt(5, 5))).toBe(0);
  });
});

describe('death animation (US4-S5, US4-S6)', () => {
  it('advances the death frames over the declared duration and then holds', () => {
    const chasing = guardAt(8, 8, 'chase');
    const billboard = createBillboard(chasing, testSheet());
    const camera = cameraLookingAt(8, 12, 8, 8);
    updateBillboard(billboard, chasing, camera, plan, 16);
    expect(billboard.frame).toBeLessThan(plan.walkFrames);

    const dead = guardAt(8, 8, 'death');
    const frames: number[] = [];
    for (let ms = 0; ms < DEATH_ANIMATION_MS; ms += DEATH_FRAME_MS) {
      updateBillboard(billboard, dead, camera, plan, DEATH_FRAME_MS);
      frames.push(billboard.frame);
    }
    // Every declared death row, in order, none of them a walk row.
    expect(frames).toEqual(Array.from({ length: plan.deathFrames }, (_, i) => plan.walkFrames + i));

    // And held, never rewound, for as long as the corpse lies there.
    for (let i = 0; i < 20; i += 1) {
      updateBillboard(billboard, dead, camera, plan, 100);
      expect(billboard.frame).toBe(plan.frames - 1);
    }
  });
});
