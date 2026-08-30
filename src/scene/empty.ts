import {
  Scene,
  PerspectiveCamera,
  BoxGeometry,
  MeshStandardMaterial,
  Mesh,
  AmbientLight,
  DirectionalLight,
} from 'three';

export interface EmptyScene {
  scene: Scene;
  camera: PerspectiveCamera;
  meshes: Mesh[];
}

export function buildEmptyScene(): EmptyScene {
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

  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({ color: 0x808080 });
  const cube = new Mesh(geometry, material);
  cube.position.set(0, 0, 0);
  scene.add(cube);

  scene.add(new AmbientLight(0x404040, 1));
  const keyLight = new DirectionalLight(0xffffff, 2);
  keyLight.position.set(2, 4, 5);
  scene.add(keyLight);

  return { scene, camera, meshes: [cube] };
}

export function resizeCamera(camera: PerspectiveCamera): void {
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
}
