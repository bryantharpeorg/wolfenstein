// The key inventory: counts per kind, and nothing else (FR-007). Pure data — no
// DOM, no three.js, and deliberately no level import either, so the inventory is
// a fact about what the player carries rather than about the map they carry it
// through. `pickups.ts` is where the two meet.

/** The two kinds, declared once and in the order the HUD reads them (FR-007). */
export const KEY_KINDS = ['silver', 'gold'] as const;

export type KeyKind = (typeof KEY_KINDS)[number];

/** Counts keyed by kind — the whole of the inventory's shape (US2-S1). */
export type KeyCounts = Record<KeyKind, number>;

/** The inventory *is* its counts: `Object.keys(inventory)` is exactly the kinds. */
export type KeyInventory = KeyCounts;

export function createInventory(): KeyInventory {
  return { silver: 0, gold: 0 };
}

/** Adds exactly one key of `kind` (FR-008). Idempotence belongs to the pickup,
 * not to this: two distinct pickups of one kind are two keys. */
export function addKey(inventory: KeyInventory, kind: KeyKind): void {
  inventory[kind] += 1;
}

export function hasKey(inventory: KeyInventory, kind: KeyKind): boolean {
  return inventory[kind] > 0;
}

/** A copy, so a reader — the HUD, the diagnostics — cannot spend a key by
 * writing through the object it was handed (FR-010). */
export function keyCounts(inventory: KeyInventory): KeyCounts {
  return { silver: inventory.silver, gold: inventory.gold };
}
