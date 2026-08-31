// T033, T034 (US4): the quad's normal points at the camera from every bearing
// rather than down a fixed axis, the cell it shows is the view angle and the
// state's frame, the death animation advances over its declared duration and then
// holds, and a guard behind the camera is not drawn
// (FR-009, FR-010, US4-S1, US4-S3, US4-S4, US4-S5, US4-S8).

import { describe, it, expect } from 'vitest';
import { Frustum, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import {
  BILLBOARD_HEIGHT,
  DEATH_FRAME_MS,
  WALK_FRAME_MS,
  billboardNormal,
  cellUv,
  deathAnimationComplete,
  deathFrame,
  faceCamera,
  frameForGuard,
  frameRowForGuard,
  placeBillboard,
  updateGuardBillboard,
} from '../../src/enemy/billboard';
import { DEATH_DURATION_MS, DEATH_FRAMES, GUARD_FRAMES, WALK_FRAMES, guardSheetPlan } from '../../src/enemy/sprite-shape';
import { VIEW_ANGLE_COUNT as N, VIEW_ANGLE_STEP_RADIANS as STEP } from '../../src/enemy/view-angle';

const plan = guardSheetPlan();
const LAST_DEATH = DEATH_FRAMES[DEATH_FRAMES.length - 1];
const guard = { state: 'idle' as const, x: 32, z: 32, facing: 0 };

/** No sheet behind it: the frame arithmetic and the facing need no canvas. */
const testBillboard = () => ({
  mesh: new Mesh(new PlaneGeometry(1, BILLBOARD_HEIGHT), new MeshBasicMaterial()),
  plan,
  angle: -1,
  frameIndex: -1,
});

/** 1 exactly when the quad's normal points at the viewer. */
function normalDot(mesh: Mesh, viewer: { x: number; z: number }, x = 32, z = 32): number {
  const n = billboardNormal(mesh);
  const to = new Vector3(viewer.x - x, 0, viewer.z - z).normalize();
  return n.x * to.x + n.z * to.z;
}

function frustumAt(x: number, z: number): Frustum {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(x, 1.5, z);
  camera.rotation.order = 'YXZ';
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

// US4-S1: the normal points at the camera, not along an axis.
describe('faceCamera', () => {
  it('points the quad normal at the camera from every bearing, standing on the floor', () => {
    for (let step = 0; step < 16; step += 1) {
      const bearing = (step / 16) * Math.PI * 2;
      const camera = new Vector3(32 + Math.sin(bearing) * 5, 1.5, 32 + Math.cos(bearing) * 5);
      const mesh = new Mesh(new PlaneGeometry(1, BILLBOARD_HEIGHT));
      placeBillboard(mesh, 32, 32);
      faceCamera(mesh, camera);
      expect(normalDot(mesh, camera)).toBeCloseTo(1, 10);
      expect(mesh.rotation.x).toBe(0);
      expect(mesh.rotation.z).toBe(0);
      expect(mesh.position.y).toBeCloseTo(BILLBOARD_HEIGHT / 2, 10);
    }
  });

  it('is not an axis-aligned card: the yaw changes with the camera', () => {
    const mesh = new Mesh(new PlaneGeometry(1, BILLBOARD_HEIGHT));
    placeBillboard(mesh, 10, 10);
    const first = faceCamera(mesh, new Vector3(10, 1.5, 4));
    expect(first).not.toBeCloseTo(faceCamera(mesh, new Vector3(4, 1.5, 10)), 3);
  });
});

// US4-S5: the death frames advance over the declared duration, then hold.
describe('the frame a guard shows', () => {
  it('advances through every declared death frame in order, from the first', () => {
    expect(deathFrame(0)).toBe(DEATH_FRAMES[0]);
    expect(deathFrame(-50)).toBe(DEATH_FRAMES[0]);
    expect(DEATH_FRAMES.map((_, i) => deathFrame(i * DEATH_FRAME_MS + 1))).toEqual([...DEATH_FRAMES]);
  });

  it('holds the final death frame once the declared duration has elapsed', () => {
    expect(deathAnimationComplete(DEATH_DURATION_MS - 1)).toBe(false);
    expect(deathAnimationComplete(DEATH_DURATION_MS)).toBe(true);
    expect(deathFrame(DEATH_DURATION_MS)).toBe(LAST_DEATH);
    expect(deathFrame(DEATH_DURATION_MS * 10)).toBe(LAST_DEATH);
    expect(deathFrame(Number.MAX_SAFE_INTEGER)).toBe(LAST_DEATH);
  });

  it('stands while idle, walks the cycle while chasing, and fires while attacking', () => {
    expect(frameForGuard('idle', 0)).toBe('stand');
    expect(frameForGuard('alert', 5000)).toBe('stand');
    expect(WALK_FRAMES.map((_, i) => frameForGuard('chase', i * WALK_FRAME_MS))).toEqual([...WALK_FRAMES]);
    expect(frameForGuard('chase', WALK_FRAMES.length * WALK_FRAME_MS)).toBe(WALK_FRAMES[0]);
    expect(frameForGuard('attack', 0)).toBe('attack');
    expect(frameForGuard('death', DEATH_DURATION_MS * 4)).toBe(LAST_DEATH);
  });

  it('sits on a row of the sheet for every state, in its own cell of the atlas', () => {
    for (const s of ['idle', 'alert', 'chase', 'attack', 'death'] as const) {
      expect(frameRowForGuard(s, 500)).toBeLessThan(GUARD_FRAMES.length);
    }
    const seen = new Set(plan.cells.map((c) => JSON.stringify(cellUv(plan, c.angle, c.frameIndex))));
    expect(seen.size).toBe(plan.cells.length);
  });
});

// US4-S3, US4-S4 and US4-S8, before a browser is involved.
describe('an orbit of eight steps', () => {
  it('reads eight distinct columns with no consecutive repeat, facing the viewer at each', () => {
    const billboard = testBillboard();
    const readings: number[] = [];
    for (let step = 0; step < N; step += 1) {
      const bearing = step * STEP;
      const viewer = new Vector3(guard.x - Math.sin(bearing) * 4, 1.5, guard.z - Math.cos(bearing) * 4);
      readings.push(updateGuardBillboard(billboard, guard, viewer, 0, null).viewAngle);
      expect(normalDot(billboard.mesh, viewer)).toBeCloseTo(1, 10);
    }
    expect(readings).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let i = 1; i < readings.length; i += 1) expect(readings[i]).not.toBe(readings[i - 1]);
  });

  it('rewrites the quad UVs as the column changes', () => {
    const billboard = testBillboard();
    const uvs = () => [...(billboard.mesh.geometry.getAttribute('uv').array as Float32Array)];
    updateGuardBillboard(billboard, guard, new Vector3(32, 1.5, 28), 0, null);
    const front = uvs();
    updateGuardBillboard(billboard, guard, new Vector3(32, 1.5, 36), 0, null);
    expect(front).not.toEqual(uvs());
  });

  it('draws a guard in front of the camera and neither one behind it nor one aside', () => {
    const frustum = frustumAt(32, 32); // at the guard, looking down -Z: due north
    const viewer = new Vector3(32, 1.5, 32);
    const billboard = testBillboard();
    for (const [x, z, drawn] of [[32, 26, true], [32, 38, false], [50, 32, false]] as const) {
      const update = updateGuardBillboard(billboard, { ...guard, x, z }, viewer, 0, frustum);
      expect(update.visible).toBe(drawn);
      expect(billboard.mesh.visible).toBe(drawn);
    }
  });
});
