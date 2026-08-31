/**
 * The doors system: the render and DOM edge of US1's machine. Every decision lives
 * in `src/interaction/` and is tested without a page; this file builds a mesh per
 * door, installs the one keydown listener, steps the doors each frame and
 * publishes the counts (FR-005, FR-015). `src/main.ts` is not edited — 001's glob
 * discovery finds this file.
 */
import { BoxGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_Y, DOOR_LOCKS, FLOOR_Y, LEVEL_GRID, TILE_SIZE } from '../../level';
import { COLLIDER_RADIUS } from '../../player/params';
import { commandForEvent } from '../../interaction/bindings';
import { createCrushGate } from '../../interaction/crush';
import { registerDoorGate } from '../../interaction/gate-registry';
import { registerOpenTileProvider } from '../../interaction/open-state';
import { isDoorPassable, stepDoor, type Door, type PlayerCapsule } from '../../interaction/door';
import { buildDoorField, interactWithDoors, openDoorTiles, type DoorField } from '../../interaction/door-field';
import { ensureInteractionDiag, recordOutcome, setDoorCounts, type InteractionDiagnostics } from '../../interaction/interaction-diag';
import { buildDoorwayShell, isDoorTileGeometry } from './doorway-mesh';

// Flat colours, per Constitution II: never an imported texture.
const LEAF_COLOR = 0xb07a2c;
const SHELL_COLOR = 0x6f6f6f;

const DOOR_HEIGHT = CEILING_Y - FLOOR_Y;

let field: DoorField | null = null;
let interaction: InteractionDiagnostics | null = null;
/** The names the doorway meshes carry into the scene, so 005's materials system
 *  binds a door's material by surface rather than by scanning vertices. */
export const DOOR_SHELL_MESH_NAME = 'door-shell';
export const DOOR_LEAF_MESH_PREFIX = 'door-leaf-';

const leaves = new Map<Door, Mesh>();

/** The live doors, or null before setup. 007's restart shuts every one through
 *  this (007 FR-011). */
export function getDoorField(): DoorField | null {
  return field;
}

function readPlayer(ctx: GameContext): PlayerCapsule | null {
  const player = ctx.diag.player;
  return player == null ? null : { x: player.x, z: player.z, radius: COLLIDER_RADIUS };
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
 * which the moving leaf replaces. */
function hideStaticDoorFaces(scene: Object3D, doors: readonly Door[]): void {
  for (const child of scene.children) {
    if (!(child instanceof Mesh)) continue;
    const positions = child.geometry.getAttribute('position');
    if (positions != null && isDoorTileGeometry(positions.array, doors)) child.visible = false;
  }
}

function buildMeshes(ctx: GameContext, doors: readonly Door[]): void {
  const shell = buildDoorwayShell(doors);
  // One mesh for every doorway in the level, so the shell is a single draw call.
  if (shell != null) {
    const shellMesh = new Mesh(shell, new MeshStandardMaterial({ color: SHELL_COLOR }));
    shellMesh.name = DOOR_SHELL_MESH_NAME;
    ctx.scene.add(shellMesh);
  }

  const leafMaterial = new MeshStandardMaterial({ color: LEAF_COLOR });
  for (const door of doors) {
    const mesh = new Mesh(new BoxGeometry(TILE_SIZE, DOOR_HEIGHT, TILE_SIZE), leafMaterial);
    mesh.name = `${DOOR_LEAF_MESH_PREFIX}${door.x},${door.z}`;
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
    // (FR-015); an open door stops blocking 003's collider (FR-016).
    registerDoorGate(createCrushGate(() => readPlayer(ctx)));
    registerOpenTileProvider(() => openDoorTiles(built));

    // Before buildMeshes, not after: the shell's own vertices lie on door tiles
    // and would match the same predicate.
    hideStaticDoorFaces(ctx.scene, built.doors);
    buildMeshes(ctx, built.doors);

    // The single interact handler (FR-005): both codes resolve through
    // `bindings.ts`, and nothing here knows which key was pressed.
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (commandForEvent(event) == null) return;
      event.preventDefault();
      const player = readPlayer(ctx);
      const resolution = interactWithDoors(
        built,
        player?.x ?? ctx.camera.position.x,
        player?.z ?? ctx.camera.position.z,
      );
      if (interaction != null) recordOutcome(interaction, resolution.outcome);
    });
  },
  update(_ctx, deltaMs) {
    if (field == null || interaction == null) return;

    let open = 0;
    for (const door of field.doors) {
      for (const outcome of stepDoor(door, deltaMs).outcomes) recordOutcome(interaction, outcome);
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
