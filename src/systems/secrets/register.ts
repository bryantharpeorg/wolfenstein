/**
 * The secrets system: the render and DOM edge of US3's push-wall. Every decision
 * lives in `src/interaction/` and is tested without a page; this file builds a block
 * per secret, steps them each frame, drives the block's offset from displacement,
 * registers the opened tiles with US1's passable-tile registry, and publishes the
 * counters through the interaction diagnostics setters (FR-012, FR-017, US3-S7).
 * `src/main.ts` is not edited: 001's glob discovery finds this file. On FR-005, this
 * installs a second *listener*, not a second command path — both key codes still
 * resolve through the one table in `bindings.ts`.
 */
import { BoxGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { CEILING_Y, FLOOR_Y, LEVEL_GRID, TILE_SIZE } from '../../level';
import { commandForEvent } from '../../interaction/bindings';
import { registerOpenTileProvider } from '../../interaction/open-state';
import { secretOffset, type Secret } from '../../interaction/secret';
import {
  buildSecretField,
  interactWithSecrets,
  openSecretTiles,
  publishSecretCounts,
  setSecretRemainingTiles,
  stepSecrets,
  type SecretField,
} from '../../interaction/secret-field';
import {
  ensureInteractionDiag,
  recordOutcome,
  type InteractionDiagnostics,
} from '../../interaction/interaction-diag';
import { buildSecretShell, isSecretTileGeometry, secretWallColor } from './secret-mesh';

// The recess a slid-away wall reveals, in 002's flat colour: the inside of the
// rock, never an imported texture (Constitution II).
const SHELL_COLOR = 0x6f6f6f;
const SECRET_HEIGHT = CEILING_Y - FLOOR_Y;

let field: SecretField | null = null;
let interaction: InteractionDiagnostics | null = null;
/** The names the push-wall meshes carry. A block's name carries its tile, so 005
 *  gives it the run's material without reopening this file's state. */
export const SECRET_SHELL_MESH_NAME = 'secret-shell';
export const SECRET_BLOCK_MESH_PREFIX = 'secret-block-';

const blocks = new Map<Secret, Mesh>();

/** The live secrets, or null before setup. 007's restart returns every one to
 *  unfound through this (007 FR-011). */
export function getSecretField(): SecretField | null {
  return field;
}

function blockPosition(secret: Secret): { x: number; z: number } {
  const offset = secretOffset(secret);
  return {
    x: (secret.x + 0.5 + offset.x) * TILE_SIZE,
    z: (secret.z + 0.5 + offset.z) * TILE_SIZE,
  };
}

/** Hides the faces 002 emitted for the `S` tiles, which the moving block replaces.
 * Only a merged group at the scene origin can be one of 002's. */
function hideStaticSecretFaces(scene: Object3D, secrets: readonly Secret[]): void {
  for (const child of scene.children) {
    if (!(child instanceof Mesh)) continue;
    if (child.position.lengthSq() !== 0) continue;
    const positions = child.geometry.getAttribute('position');
    if (positions != null && isSecretTileGeometry(positions.array, secrets)) child.visible = false;
  }
}

function buildMeshes(ctx: GameContext, built: SecretField): void {
  // One mesh for every recess in the level, so the shell is a single draw call.
  const shell = buildSecretShell(built.secrets);
  if (shell != null) {
    const shellMesh = new Mesh(shell, new MeshStandardMaterial({ color: SHELL_COLOR }));
    shellMesh.name = SECRET_SHELL_MESH_NAME;
    ctx.scene.add(shellMesh);
  }

  const geometry = new BoxGeometry(TILE_SIZE, SECRET_HEIGHT, TILE_SIZE);
  const materials = new Map<number, MeshStandardMaterial>();
  for (const secret of built.secrets) {
    const color = secretWallColor(built.grid, secret);
    let material = materials.get(color);
    if (material == null) {
      material = new MeshStandardMaterial({ color });
      materials.set(color, material);
    }
    const mesh = new Mesh(geometry, material);
    mesh.name = `${SECRET_BLOCK_MESH_PREFIX}${secret.x},${secret.z}`;
    const position = blockPosition(secret);
    mesh.position.set(position.x, FLOOR_Y + SECRET_HEIGHT / 2, position.z);
    ctx.scene.add(mesh);
    blocks.set(secret, mesh);
  }
}

defineSystem({
  name: 'secrets',
  // After doors (45) and keys (46): the interaction diagnostics exist by the time
  // this writes the counters, and doors answer the press before a secret is asked.
  order: 47,
  setup(ctx) {
    const built = buildSecretField(LEVEL_GRID);
    field = built;
    interaction = ensureInteractionDiag(ctx.diag);
    publishSecretCounts(interaction, built);
    setSecretRemainingTiles(interaction, 0);

    // An opened secret stops blocking 003's collider, so the player can walk through
    // the opening rather than see one they cannot enter (US3-S7).
    registerOpenTileProvider(() => openSecretTiles(built));

    // Before buildMeshes: the shell's vertices lie on secret tiles and would match.
    hideStaticSecretFaces(ctx.scene, built.secrets);
    buildMeshes(ctx, built);

    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (commandForEvent(event) == null) return;
      event.preventDefault();
      const player = ctx.diag.player;
      const resolution = interactWithSecrets(
        built,
        player?.x ?? ctx.camera.position.x,
        player?.z ?? ctx.camera.position.z,
      );
      if (interaction == null || resolution.secret == null) return;

      // Only a press that found a secret speaks for the level: otherwise the doors
      // system's own answer — including its `no-target` — is the reason.
      recordOutcome(interaction, resolution.outcome);
      setSecretRemainingTiles(interaction, resolution.remainingTiles);
      publishSecretCounts(interaction, built);
    });
  },
  update(_ctx, deltaMs) {
    if (field == null || interaction == null) return;
    stepSecrets(field, deltaMs);
    for (const secret of field.secrets) {
      const mesh = blocks.get(secret);
      if (mesh == null) continue;
      const position = blockPosition(secret);
      mesh.position.x = position.x;
      mesh.position.z = position.z;
    }
    publishSecretCounts(interaction, field);
  },
});
