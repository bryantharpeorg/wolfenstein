// Pickups: one per item spawn marker 002 declares, collected by walking within a
// declared radius, collected once (FR-013, FR-014). Pure: no DOM, no three.js, and
// the marker table arrives as an argument — `ITEM_SPAWNS` is only the default, so a
// test drives synthetic markers and the render loop drives the shipped level.
//
// The kind is taken from the marker and nowhere else: no position convention, no
// inference from what happens to sit nearby. A marker whose kind this spec does not
// declare is recorded as a named error citing its coordinates and then skipped —
// neither silently dropped nor allowed to throw the load (US3-S2).
//
// What a pickup *does* is `pickup-effects.ts`'s; this module never learns. It calls
// an `apply` callback and consumes the pickup only if that callback took it, which
// is how a health pickup survives a player at maximum health without this file
// knowing what health is (US3-S6).

import { ITEM_SPAWNS } from '../level';
import { isPickupKind, type PickupKind } from './pickup-effects';

/** The declared collection radius (FR-014), in tiles, measured from the pickup's
 *  tile centre to the player's position. A little over half a tile: the player
 *  collects by standing on the marker or brushing its edge, never from the next
 *  tile along. */
export const PICKUP_RADIUS_TILES = 0.6;

/** The named error US3-S2 asks for. */
export const UNDECLARED_PICKUP_KIND = 'undeclared-pickup-kind';

export interface PickupTile {
  readonly x: number;
  readonly z: number;
}

/** `{tile, kind, consumed}` and nothing else: a pickup carries no effect, no mesh
 *  and no amount, so the only thing a restart has to undo is one boolean. */
export interface Pickup {
  readonly tile: PickupTile;
  readonly kind: PickupKind;
  consumed: boolean;
}

/** Recorded, not thrown, and citing the coordinates rather than the index (US3-S2). */
export interface PickupError {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly kind: string;
  readonly message: string;
}

/** The counters FR-013 reports. The totals are facts about the level and are
 *  readonly; the two progress counters are the run's and reset with it. */
export interface PickupField {
  readonly pickups: readonly Pickup[];
  readonly errors: readonly PickupError[];
  readonly pickupsTotal: number;
  readonly treasureTotal: number;
  pickupsCollected: number;
  treasureFound: number;
}

/** The marker shape this module reads: 002's `ItemSpawn` satisfies it, and `kind`
 *  is widened to `string` on purpose — an undeclared kind is a case to report, so
 *  it must be representable. */
export interface PickupMarker {
  readonly x: number;
  readonly z: number;
  readonly kind: string;
}

/** One pickup per declared marker, in marker order (FR-013, US3-S1). */
export function buildPickupField(
  markers: readonly PickupMarker[] = ITEM_SPAWNS,
): PickupField {
  const pickups: Pickup[] = [];
  const errors: PickupError[] = [];

  for (const marker of markers) {
    if (!isPickupKind(marker.kind)) {
      errors.push({
        name: UNDECLARED_PICKUP_KIND,
        x: marker.x,
        z: marker.z,
        kind: marker.kind,
        message:
          `item marker at ${marker.x},${marker.z} declares the undeclared kind ` +
          `"${marker.kind}"; no pickup was instantiated for it`,
      });
      continue;
    }
    pickups.push({ tile: { x: marker.x, z: marker.z }, kind: marker.kind, consumed: false });
  }

  return {
    pickups,
    errors,
    // Only what was instantiated: a marker that errored is not a pickup the player
    // could ever collect, so counting it would make US3-S10 unsatisfiable.
    pickupsTotal: pickups.length,
    treasureTotal: pickups.filter((pickup) => pickup.kind === 'treasure').length,
    pickupsCollected: 0,
    treasureFound: 0,
  };
}

/** The tile centre a pickup sits on, in tiles. */
export function pickupCenter(pickup: Pickup): { x: number; z: number } {
  return { x: pickup.tile.x + 0.5, z: pickup.tile.z + 0.5 };
}

/** Radial, not the bounding box: a player at the diagonal corner of the radius is
 *  further away than one straight ahead, and is treated as such (FR-014). */
export function withinPickupRadius(
  pickup: Pickup,
  x: number,
  z: number,
  radius: number = PICKUP_RADIUS_TILES,
): boolean {
  const centre = pickupCenter(pickup);
  const dx = x - centre.x;
  const dz = z - centre.z;
  return dx * dx + dz * dz < radius * radius;
}

/** The pickup on a tile, consumed or not — what a mesh builder looks up by. */
export function pickupAt(field: PickupField, x: number, z: number): Pickup | null {
  return field.pickups.find((pickup) => pickup.tile.x === x && pickup.tile.z === z) ?? null;
}

/** Takes the pickup, or declines it. Returning `false` leaves it on the floor
 *  untouched — no consumption, no counter, no error (FR-014, US3-S6). */
export type PickupApply = (pickup: Pickup) => boolean;

/** Collects one pickup, once (FR-014, US3-S3, US3-S4).
 *
 * A consumed pickup returns before `apply` is ever called, so a second pass
 * applies nothing, moves no counter and records nothing — the second pass is not a
 * refusal to report, it is a non-event. */
export function collectPickup(field: PickupField, pickup: Pickup, apply: PickupApply): boolean {
  if (pickup.consumed) return false;
  if (!apply(pickup)) return false;

  pickup.consumed = true;
  // Exactly one, exactly here: no other line in this spec writes these counters.
  field.pickupsCollected += 1;
  if (pickup.kind === 'treasure') field.treasureFound += 1;
  return true;
}

/** Every uncollected pickup the player's position reaches, collected (FR-014).
 *  Returns those actually taken, so the caller can retire their meshes. */
export function collectPickupsAt(
  field: PickupField,
  x: number,
  z: number,
  apply: PickupApply,
  radius: number = PICKUP_RADIUS_TILES,
): Pickup[] {
  const taken: Pickup[] = [];
  for (const pickup of field.pickups) {
    if (pickup.consumed) continue;
    if (!withinPickupRadius(pickup, x, z, radius)) continue;
    if (collectPickup(field, pickup, apply)) taken.push(pickup);
  }
  return taken;
}

/** Every pickup back on the floor and both counters at zero: what US2's restart
 *  runs through the reset registry (FR-011, US2-S7). The totals are the level's
 *  and are left standing. */
export function resetPickupField(field: PickupField): void {
  for (const pickup of field.pickups) pickup.consumed = false;
  field.pickupsCollected = 0;
  field.treasureFound = 0;
}
