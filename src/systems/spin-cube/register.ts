/**
 * The placeholder scene from 001-scaffold: one lit, rotating cube.
 *
 * It lives in a system, not in `main.ts` or the scene shell, so that 002 can retire it
 * by deleting this directory — touching no file any other story also edits. That is the
 * property the seam exists to give; this is the first thing to exercise it.
 */
import { BoxGeometry, MeshStandardMaterial, Mesh, AmbientLight, DirectionalLight } from 'three';
import { defineSystem } from '../../boot/registry';

let cube: Mesh | null = null;

defineSystem({
  name: 'spin-cube',
  order: 50,
  setup(ctx) {
    cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0x808080 }));
    cube.position.set(0, 0, 0);
    ctx.scene.add(cube);

    ctx.scene.add(new AmbientLight(0x404040, 1));
    const keyLight = new DirectionalLight(0xffffff, 2);
    keyLight.position.set(2, 4, 5);
    ctx.scene.add(keyLight);
  },
  update() {
    if (cube != null) {
      cube.rotation.x += 0.01;
      cube.rotation.y += 0.01;
    }
  },
});
