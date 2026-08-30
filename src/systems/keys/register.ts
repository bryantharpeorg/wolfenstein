/**
 * The keys system: the render and DOM edge of US2's inventory. Every decision
 * lives in `src/interaction/` and is tested without a page; this file builds a
 * pickup mesh per key on 002's spawn table, collects on the player's tile,
 * registers the lock gate on US1's door machine, and publishes the counts and
 * the named refusal to `__diag.interaction` (FR-008, FR-009, FR-010).
 *
 * `src/main.ts` is not edited — 001's glob discovery finds this file — and
 * neither is the doors system: the lock reaches the door through the gate
 * registry, which is what that seam is for.
 */
import { Mesh, MeshStandardMaterial, OctahedronGeometry } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { DOOR_LOCKS, FLOOR_Y, ITEM_SPAWNS, TILE_SIZE } from '../../level';
import { registerDoorGate } from '../../interaction/gate-registry';
import { createInventory, keyCounts, type KeyInventory, type KeyKind } from '../../interaction/keys';
import { buildKeyPickups, collectKeyPickupAt, type KeyPickup } from '../../interaction/pickups';
import { lockGate } from '../../interaction/locks';
import {
  ensureInteractionDiag,
  recordOutcome,
  setKeyConsumed,
  setKeyCounts,
  type InteractionDiagnostics,
} from '../../interaction/interaction-diag';

// Generated geometry and flat colour, per Constitution II: a key is an octahedron
// the colour of its kind, never an imported icon.
const KEY_COLORS: Record<KeyKind, number> = { silver: 0xc8d0d8, gold: 0xd8a520 };
const KEY_RADIUS = 0.18;
const KEY_HEIGHT = 0.6;

const inventory: KeyInventory = createInventory();
let pickups: KeyPickup[] = [];
let interaction: InteractionDiagnostics | null = null;
const meshes = new Map<KeyPickup, Mesh>();

// The kind the lock gate last refused for. The doors system records *that* a
// command was refused; naming the key is this story's business, so the kind is
// carried here from the gate to the next frame's diagnostics write (US2-S8).
let refusedKey: KeyKind | null = null;
let refusalSpentKey = false;

function publishKeys(): void {
  if (interaction == null) return;
  setKeyCounts(interaction, keyCounts(inventory));
  // Unchanged by every unlock, and asserted as such rather than assumed (FR-010).
  setKeyConsumed(interaction, refusalSpentKey);
}

function buildMeshes(ctx: GameContext): void {
  const geometry = new OctahedronGeometry(KEY_RADIUS);
  const materials = new Map<KeyKind, MeshStandardMaterial>();
  for (const pickup of pickups) {
    let material = materials.get(pickup.kind);
    if (material == null) {
      material = new MeshStandardMaterial({ color: KEY_COLORS[pickup.kind] });
      materials.set(pickup.kind, material);
    }
    const mesh = new Mesh(geometry, material);
    mesh.position.set(
      (pickup.x + 0.5) * TILE_SIZE,
      FLOOR_Y + KEY_HEIGHT,
      (pickup.z + 0.5) * TILE_SIZE,
    );
    ctx.scene.add(mesh);
    meshes.set(pickup, mesh);
  }
}

function collectAtPlayer(ctx: GameContext): void {
  const player = ctx.diag.player;
  if (player == null || interaction == null) return;

  const result = collectKeyPickupAt(
    pickups,
    Math.floor(player.x / TILE_SIZE),
    Math.floor(player.z / TILE_SIZE),
    inventory,
  );
  if (!result.collected) return;

  // The pickup is consumed, so the mesh goes with it; re-entering the tile
  // yields nothing, which is what `consumed` means (FR-008, US2-S2).
  for (const [pickup, mesh] of meshes) {
    if (!pickup.consumed) continue;
    ctx.scene.remove(mesh);
    meshes.delete(pickup);
  }
  publishKeys();
}

defineSystem({
  name: 'keys',
  // After the doors system (45): the gate is registered either way, but the
  // interaction diagnostics exist by the time this one names a refused key.
  order: 46,
  setup(ctx) {
    interaction = ensureInteractionDiag(ctx.diag);
    pickups = buildKeyPickups(ITEM_SPAWNS);
    publishKeys();

    // The lock reads the live inventory, so a key collected mid-session counts
    // on the next press without re-registration (FR-009).
    registerDoorGate(
      lockGate(DOOR_LOCKS, inventory, (kind, consumed) => {
        refusedKey = kind;
        refusalSpentKey = consumed;
      }),
    );

    buildMeshes(ctx);
  },
  update(ctx) {
    if (interaction == null) return;

    collectAtPlayer(ctx);

    if (refusedKey != null) {
      // The doors system already recorded the reason; this names the key it
      // wanted, so the HUD and the harness read a refusal and not a dead press.
      if (interaction.lastReason === 'locked-missing-key') {
        recordOutcome(interaction, 'locked-missing-key', refusedKey);
      }
      refusedKey = null;
      publishKeys();
    }
  },
});
