// Key pickups over 002's item spawn table (FR-008). A pickup is consumed on
// collection and never yields a second key, so re-entering its tile — which the
// player does constantly, a tile being a metre wide — is idempotent (US2-S2).
// Pure: no DOM, no three.js.

import { ITEM_SPAWNS, type ItemKind, type ItemSpawn } from '../level';
import { addKey, type KeyInventory, type KeyKind } from './keys';

export interface KeyPickup {
  readonly x: number;
  readonly z: number;
  readonly kind: KeyKind;
  /** Monotonic: set once on collection and never cleared within a session. */
  consumed: boolean;
}

export interface CollectResult {
  readonly collected: boolean;
  /** The kind added, or null when nothing was collected. */
  readonly kind: KeyKind | null;
}

const NOTHING: CollectResult = { collected: false, kind: null };

/** The key kind an item spawn carries, or null for health, ammo and treasure. */
export function pickupKind(kind: ItemKind): KeyKind | null {
  if (kind === 'silver-key') return 'silver';
  if (kind === 'gold-key') return 'gold';
  return null;
}

export function buildKeyPickups(spawns: readonly ItemSpawn[] = ITEM_SPAWNS): KeyPickup[] {
  const pickups: KeyPickup[] = [];
  for (const spawn of spawns) {
    const kind = pickupKind(spawn.kind);
    if (kind != null) pickups.push({ x: spawn.x, z: spawn.z, kind, consumed: false });
  }
  return pickups;
}

/** The pickup occupying a tile, consumed or not. */
export function keyPickupAt(pickups: readonly KeyPickup[], x: number, z: number): KeyPickup | null {
  return pickups.find((pickup) => pickup.x === x && pickup.z === z) ?? null;
}

/** Collects a pickup into `inventory`, once. A consumed pickup reports
 * `collected: false` and adds nothing (FR-008). */
export function collectKeyPickup(pickup: KeyPickup, inventory: KeyInventory): CollectResult {
  if (pickup.consumed) return NOTHING;
  pickup.consumed = true;
  addKey(inventory, pickup.kind);
  return { collected: true, kind: pickup.kind };
}

/** Tile-addressed collection: what the render layer calls with the player's tile. */
export function collectKeyPickupAt(
  pickups: readonly KeyPickup[],
  x: number,
  z: number,
  inventory: KeyInventory,
): CollectResult {
  const pickup = keyPickupAt(pickups, x, z);
  return pickup == null ? NOTHING : collectKeyPickup(pickup, inventory);
}
