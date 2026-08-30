/**
 * The level system: builds the merged wall/floor/ceiling geometry once in setup(),
 * adds the meshes and the scene's lights, and seats the camera on the player spawn
 * tile. It replaces 001's spin-cube placeholder, which owned the lights.
 */
import { AmbientLight, DirectionalLight } from 'three';
import { defineSystem } from '../../boot/registry';
import { buildLevelGeometry, LevelBuildError, type LevelGeometry } from '../../geometry/build';
import { PLAYER_SPAWN, TILE_SIZE, FLOOR_Y } from '../../level';

const EYE_HEIGHT = 1.5;

function showFatalMessage(message: string): void {
  document.body.innerHTML = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  paragraph.style.padding = '1rem';
  paragraph.style.color = '#fff';
  paragraph.style.fontFamily = 'sans-serif';
  document.body.appendChild(paragraph);
}

defineSystem({
  name: 'level',
  order: 40,
  setup(ctx) {
    let geometry: LevelGeometry;
    try {
      geometry = buildLevelGeometry();
    } catch (error) {
      if (error instanceof LevelBuildError) {
        const messages = error.report.errors.map((e) => e.message).join('; ');
        showFatalMessage(`Level validation failed: ${messages}`);
      } else {
        showFatalMessage(
          `Level build failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    for (const wall of geometry.walls) {
      ctx.scene.add(wall);
    }
    ctx.scene.add(geometry.floor);
    ctx.scene.add(geometry.ceiling);

    ctx.scene.add(new AmbientLight(0x404040, 1));
    const keyLight = new DirectionalLight(0xffffff, 2);
    keyLight.position.set(2, 4, 5);
    ctx.scene.add(keyLight);

    const centerX = PLAYER_SPAWN.x + TILE_SIZE / 2;
    const centerZ = PLAYER_SPAWN.z + TILE_SIZE / 2;
    const eyeY = FLOOR_Y + EYE_HEIGHT;
    ctx.camera.position.set(centerX, eyeY, centerZ);
    const yaw = PLAYER_SPAWN.yaw;
    ctx.camera.lookAt(centerX - Math.sin(yaw), eyeY, centerZ - Math.cos(yaw));
  },
});
