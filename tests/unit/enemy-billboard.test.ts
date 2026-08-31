// T033, T034 (US4): the billboard itself. The quad's normal points at the camera
// from every bearing rather than down a fixed axis, the sheet cell it shows is
// the view angle and the state's frame, the death animation advances over its
// declared duration and then holds, and a guard behind the camera is not drawn
// (FR-009, FR-010, US4-S1, US4-S5, US4-S6, US4-S8).

import { describe, it, expect } from 'vitest';
import {
  Frustum,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three';
import {
  BILLBOARD_HEIGHT,
  DEATH_FRAME_MS,
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
import {
  DEATH_DURATION_MS,
  DEATH_FRAMES,
  GUARD_FRAMES,
  WALK_FRAMES,
  guardSheetPlan,
} from '../../src/enemy/sprite-shape';
import { VIEW_ANGLE_COUNT, VIEW_ANGLE_STEP_RADIANS } from '../../src/enemy/view-angle';

const plan = guardSheetPlan();

/** A billboard with no sheet behind it: the frame arithmetic and the facing are
 *  what these tests are about, and neither needs a canvas. */
function testBillboard() {
  return {
    mesh: new Mesh(new PlaneGeometry(1, BILLBOARD_HEIGHT), new MeshBasicMaterial()),
    plan,
    angle: -1,
    frameIndex: -1,
  };
}

function quadAt(x: number, z: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(1, BILLBOARD_HEIGHT));
  placeBillboard(mesh, x, z);
  return mesh;
}

// US4-S1: the normal points at the camera, not along an axis.
describe('faceCamera', () => {
  it('points the quad normal at the camera from every bearing', () => {
    for (let step = 0; step < 16; step += 1) {
      const bearing = (step / 16) * Math.PI * 2;
      const camera = new Vector3(32 + Math.sin(bearing) * 5, 1.5, 32 + Math.cos(bearing) * 5);
      const mesh = quadAt(32, 32);
      faceCamera(mesh, camera);

      const normal = billboardNormal(mesh);
      const toCamera = new Vector3(camera.x - 32, 0, camera.z - 32).normalize();
      // A dot product of 1 is exactly "the normal points at the camera".
      expect(normal.x * toCamera.x + normal.z * toCamera.z).toBeCloseTo(1, 10);
    }
  });

  it('never tips the quad off its feet', () => {
    const mesh = quadAt(10, 10);
    faceCamera(mesh, new Vector3(14, 12, 7));
    expect(mesh.rotation.x).toBe(0);
    expect(mesh.rotation.z).toBe(0);
  });

  it('is not an axis-aligned card: the yaw changes with the camera', () => {
    const mesh = quadAt(10, 10);
    const first = faceCamera(mesh, new Vector3(10, 1.5, 4));
    const second = faceCamera(mesh, new Vector3(4, 1.5, 10));
    expect(first).not.toBeCloseTo(second, 3);
  });

  it('holds its last heading when the camera stands on the guard', () => {
    const mesh = quadAt(10, 10);
    const held = faceCamera(mesh, new Vector3(14, 1.5, 10));
    expect(faceCamera(mesh, new Vector3(10, 1.5, 10))).toBe(held);
  });

  it('stands the quad on the floor', () => {
    const mesh = quadAt(3, 4);
    expect(mesh.position.y).toBeCloseTo(BILLBOARD_HEIGHT / 2, 10);
    expect(mesh.position.x).toBe(3);
    expect(mesh.position.z).toBe(4);
  });
});

// US4-S5: the death frames advance over the declared duration, then hold.
describe('the death animation', () => {
  it('starts on the first death frame', () => {
    expect(deathFrame(0)).toBe(DEATH_FRAMES[0]);
    expect(deathFrame(-50)).toBe(DEATH_FRAMES[0]);
  });

  it('advances through every declared death frame in order', () => {
    const seen = DEATH_FRAMES.map((_, index) => deathFrame(index * DEATH_FRAME_MS + 1));
    expect(seen).toEqual([...DEATH_FRAMES]);
  });

  it('holds the final death frame once the duration has elapsed', () => {
    const last = DEATH_FRAMES[DEATH_FRAMES.length - 1];
    expect(deathFrame(DEATH_DURATION_MS)).toBe(last);
    expect(deathFrame(DEATH_DURATION_MS * 10)).toBe(last);
    expect(deathFrame(Number.MAX_SAFE_INTEGER)).toBe(last);
  });

  it('reports completion only once the declared duration has passed', () => {
    expect(deathAnimationComplete(DEATH_DURATION_MS - 1)).toBe(false);
    expect(deathAnimationComplete(DEATH_DURATION_MS)).toBe(true);
  });
});

describe('frameForGuard', () => {
  it('stands still while idle and alert', () => {
    expect(frameForGuard('idle', 0)).toBe('stand');
    expect(frameForGuard('alert', 5000)).toBe('stand');
  });

  it('walks the cycle while chasing and returns to its start', () => {
    const cycle = WALK_FRAMES.map((_, index) => frameForGuard('chase', index * 140));
    expect(cycle).toEqual([...WALK_FRAMES]);
    expect(frameForGuard('chase', WALK_FRAMES.length * 140)).toBe(WALK_FRAMES[0]);
  });

  it('shows the attack frame while attacking', () => {
    expect(frameForGuard('attack', 0)).toBe('attack');
  });

  it('shows a death frame while dead', () => {
    expect(DEATH_FRAMES).toContain(frameForGuard('death', 0));
    expect(frameForGuard('death', DEATH_DURATION_MS * 4)).toBe(DEATH_FRAMES[DEATH_FRAMES.length - 1]);
  });

  it('reports a row that exists on the sheet for every state', () => {
    for (const state of ['idle', 'alert', 'chase', 'attack', 'death'] as const) {
      const row = frameRowForGuard(state, 500);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(GUARD_FRAMES.length);
    }
  });
});

describe('cellUv', () => {
  it('cuts each cell out of its own eighth of the sheet', () => {
    for (let angle = 0; angle < VIEW_ANGLE_COUNT; angle += 1) {
      const uv = cellUv(plan, angle, 0);
      expect(uv.u0).toBeGreaterThanOrEqual(angle / VIEW_ANGLE_COUNT);
      expect(uv.u1).toBeLessThanOrEqual((angle + 1) / VIEW_ANGLE_COUNT);
      expect(uv.u0).toBeLessThan(uv.u1);
      expect(uv.v0).toBeLessThan(uv.v1);
    }
  });

  it('reads the sheet from the top row down, matching the canvas', () => {
    const first = cellUv(plan, 0, 0);
    const second = cellUv(plan, 0, 1);
    expect(first.v0).toBeGreaterThan(second.v1);
  });

  it('insets the rectangle so a sample cannot land in the neighbouring cell', () => {
    const uv = cellUv(plan, 3, 2);
    expect(uv.u0).toBeGreaterThan((3 * plan.cell) / plan.width);
    expect(uv.u1).toBeLessThan((4 * plan.cell) / plan.width);
  });

  it('gives every cell of the sheet a distinct rectangle', () => {
    const seen = new Set<string>();
    for (const cell of plan.cells) {
      seen.add(JSON.stringify(cellUv(plan, cell.angle, cell.frameIndex)));
    }
    expect(seen.size).toBe(plan.cells.length);
  });
});

// US4-S8: a guard behind the camera is not drawn.
describe('frustum culling', () => {
  const frustumFor = (camera: PerspectiveCamera): Frustum => {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  };

  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(32, 1.5, 32);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = 0; // looking down -Z, which is due north

  it('sees a guard standing in front of it', () => {
    const mesh = quadAt(32, 26);
    mesh.updateMatrixWorld();
    expect(frustumFor(camera).intersectsObject(mesh)).toBe(true);
  });

  it('does not see a guard standing behind it', () => {
    const mesh = quadAt(32, 38);
    mesh.updateMatrixWorld();
    expect(frustumFor(camera).intersectsObject(mesh)).toBe(false);
  });

  it('does not see a guard far off to the side', () => {
    const mesh = quadAt(50, 32);
    mesh.updateMatrixWorld();
    expect(frustumFor(camera).intersectsObject(mesh)).toBe(false);
  });
});

// The whole of US4-S4's arithmetic, before a browser is involved: eight orbit
// positions around a stationary guard, eight distinct columns, no consecutive
// repeat, and the quad facing the viewer at every one of them.
describe('an orbit of eight steps', () => {
  it('reads eight distinct columns with no consecutive repeat', () => {
    const guard = { state: 'idle' as const, x: 32, z: 32, facing: 0 };
    const billboard = testBillboard();
    const readings: number[] = [];
    for (let step = 0; step < VIEW_ANGLE_COUNT; step += 1) {
      const bearing = step * VIEW_ANGLE_STEP_RADIANS;
      const viewer = new Vector3(
        guard.x - Math.sin(bearing) * 4,
        1.5,
        guard.z - Math.cos(bearing) * 4,
      );
      const update = updateGuardBillboard(billboard, guard, viewer, 0, null);
      readings.push(update.viewAngle);

      const normal = billboardNormal(billboard.mesh);
      const toViewer = new Vector3(viewer.x - guard.x, 0, viewer.z - guard.z).normalize();
      expect(normal.x * toViewer.x + normal.z * toViewer.z).toBeCloseTo(1, 10);
    }
    expect(readings).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(readings).size).toBe(VIEW_ANGLE_COUNT);
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i]).not.toBe(readings[i - 1]);
    }
  });

  it('rewrites the quad UVs as the column changes', () => {
    const guard = { state: 'idle' as const, x: 32, z: 32, facing: 0 };
    const billboard = testBillboard();
    updateGuardBillboard(billboard, guard, new Vector3(32, 1.5, 28), 0, null);
    const front = [...(billboard.mesh.geometry.getAttribute('uv').array as Float32Array)];
    updateGuardBillboard(billboard, guard, new Vector3(32, 1.5, 36), 0, null);
    const back = [...(billboard.mesh.geometry.getAttribute('uv').array as Float32Array)];
    expect(front).not.toEqual(back);
  });

  it('hides a guard the camera cannot see and shows one it can', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.position.set(32, 1.5, 32);
    camera.rotation.order = 'YXZ';
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const billboard = testBillboard();

    const ahead = updateGuardBillboard(
      billboard,
      { state: 'idle', x: 32, z: 26, facing: 0 },
      camera.position,
      0,
      frustum,
    );
    expect(ahead.visible).toBe(true);
    expect(billboard.mesh.visible).toBe(true);

    const behind = updateGuardBillboard(
      billboard,
      { state: 'idle', x: 32, z: 38, facing: 0 },
      camera.position,
      0,
      frustum,
    );
    expect(behind.visible).toBe(false);
    expect(billboard.mesh.visible).toBe(false);
  });
});
