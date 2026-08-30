/**
 * The doors system: the render and DOM edge of US1's machine. Every decision
 * lives in `src/interaction/` and is tested without a page; this file builds a
 * mesh per door, installs the one keydown listener, steps the doors each frame
 * and publishes the counts (FR-005, FR-015). `src/main.ts` is not edited.
 */
import { BackSide, BoxGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_Y, DOOR_LOCKS, FLOOR_Y, LEVEL_GRID, TILE_SIZE } from '../../level';
import { COLLIDER_RADIUS } from '../../player/params';
import { commandForEvent } from '../../interaction/bindings';
import { createCrushGate } from '../../interaction/crush';
import { registerDoorGate } from '../../interaction/gate-registry';
import { registerOpenTileProvider } from '../../interaction/open-state';
import {
  isDoorPassable,
  stepDoor,
  type Door,
  type PlayerCapsule,
} from '../../interaction/door';
import {
  buildDoorField,
  interactWithDoors,
  openDoorTiles,
  type DoorField,
} from '../../interaction/door-field';
import {
  ensureInteractionDiag,
  recordOutcome,
  setDoorCounts,
  type InteractionDiagnostics,
} from '../../interaction/interaction-diag';
import { buildDoorwayShell } from './doorway-mesh';
import { isDoorTileGeometry } from './static-faces';

// Flat colours, per Constitution II: leaf and recess are geometry and colour,
// never an imported texture.
const LEAF_COLOR = 0xb07a2c;
const SHELL_COLOR = 0x6f6f6f;

const DOOR_HEIGHT = CEILING_Y - FLOOR_Y;

let field: DoorField | null = null;
let interaction: InteractionDiagnostics | null = null;
const leaves = new Map<Door, Mesh>();

function readPlayer(ctx: GameContext): PlayerCapsule | null {
  const player = ctx.diag.player;
  if (player == null) return null;
  return { x: player.x, z: player.z, radius: COLLIDER_RADIUS };
}

function leafPosition(door: Door): { x: number; z: number } {
  const offset = door.progress * TILE_SIZE * door.direction;
  const centreX = (door.x + 0.5) * TILE_SIZE;
  const centreZ = (door.z + 0.5) * TILE_SIZE;
  return door.axis === 'x'
    ? { x: centreX + offset, z: centreZ }
    : { x: centreX, z: centreZ + offset };
}

/** Hides the faces 002 emitted for the `D` tiles — the closed door drawn as wall,
 * which the moving leaf replaces — recognising the group by its own vertices
 * rather than by an index into 002's build order. */
function hideStaticDoorFaces(scene: Object3D, doors: readonly Door[]): void {
  for (const child of scene.children) {
    if (!(child instanceof Mesh)) continue;
    const positions = child.geometry.getAttribute('position');
    if (positions == null) continue;
    if (isDoorTileGeometry(positions.array, doors)) child.visible = false;
  }
}

function buildMeshes(ctx: GameContext, doors: readonly Door[]): void {
  const shell = buildDoorwayShell(doors);
  if (shell != null) {
    // BackSide: the shell is seen from inside, so its inward faces are the ones
    // that draw. One mesh for every doorway in the level, one draw call.
    ctx.scene.add(new Mesh(shell, new MeshStandardMaterial({ color: SHELL_COLOR, side: BackSide })));
  }

  const leafMaterial = new MeshStandardMaterial({ color: LEAF_COLOR });
  for (const door of doors) {
    const mesh = new Mesh(new BoxGeometry(TILE_SIZE, DOOR_HEIGHT, TILE_SIZE), leafMaterial);
    const position = leafPosition(door);
    mesh.position.set(position.x, FLOOR_Y + DOOR_HEIGHT / 2, position.z);
    ctx.scene.add(mesh);
    leaves.set(door, mesh);
  }
}

defineSystem({
  name: 'doors',
  // After the level system (40) so the merged wall geometry exists to hide.
  order: 45,
  setup(ctx) {
    const built = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    field = built;
    interaction = ensureInteractionDiag(ctx.diag);
    setDoorCounts(interaction, built.doors.length, 0);

    // The player lives on this side of the DOM line, so it crosses as a closure
    // (FR-015). An open door stops blocking 003's collider (FR-016).
    registerDoorGate(createCrushGate(() => readPlayer(ctx)));
    registerOpenTileProvider(() => openDoorTiles(built));

    // Before buildMeshes, not after: the shell's own vertices lie on door tiles,
    // so it would match the same predicate.
    hideStaticDoorFaces(ctx.scene, built.doors);
    buildMeshes(ctx, built.doors);

    // The single interact handler (FR-005): both bound codes resolve through
    // `bindings.ts`, and nothing here knows which key was pressed.
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (commandForEvent(event) == null) return;
      event.preventDefault();
      const player = readPlayer(ctx);
      const x = player?.x ?? ctx.camera.position.x;
      const z = player?.z ?? ctx.camera.position.z;
      const resolution = interactWithDoors(built, x, z);
      if (interaction != null) recordOutcome(interaction, resolution.outcome);
    });
  },
  update(_ctx, deltaMs) {
    if (field == null || interaction == null) return;

    let open = 0;
    for (const door of field.doors) {
      for (const outcome of stepDoor(door, deltaMs).outcomes) {
        recordOutcome(interaction, outcome);
      }
      if (isDoorPassable(door)) open += 1;

      const mesh = leaves.get(door);
      if (mesh != null) {
        const position = leafPosition(door);
        mesh.position.x = position.x;
        mesh.position.z = position.z;
      }
    }
    setDoorCounts(interaction, field.doors.length, open);
  },
});
