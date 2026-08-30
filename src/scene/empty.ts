/**
 * The scene SHELL: a scene and a camera, with no content in them.
 *
 * Content used to be built here and wired in `main.ts`, which meant replacing the
 * placeholder scene required editing `main.ts` — the shared file this arrangement
 * exists to keep stories out of. Lights and meshes now come from systems
 * (`src/systems/<name>/register.ts`), so 002 adds level geometry by adding a directory
 * and removes the placeholder by deleting one.
 */
import { Scene, PerspectiveCamera } from 'three';

export interface SceneShell {
  scene: Scene;
  camera: PerspectiveCamera;
}

export function createSceneShell(): SceneShell {
  const scene = new Scene();
  scene.background = null;

  const camera = new PerspectiveCamera(
    60,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.1,
    100,
  );
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  return { scene, camera };
}

export function resizeCamera(camera: PerspectiveCamera): void {
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
}
