// Which tiles are passable right now: a registry of providers, mirroring
// `src/boot/registry.ts` (FR-016, US1-S2).
//
// 003's collider already takes open state as an argument, so US1 wires this in
// at 003's single existing call site and registers the door provider. US3 adds
// opened secrets by registering a second provider from its own file, without
// re-editing that call site — which is the whole reason this is a registry and
// not a set.
//
// Pure: no DOM, no three.js.

import { tileKey } from '../player/tiles';
import type { OpenState } from '../player/tiles';

/** Returns the `"x,z"` keys of the tiles this provider currently makes passable. */
export type OpenTileProvider = () => Iterable<string>;

const providers: OpenTileProvider[] = [];

/** Register a provider. Called for side effect from a system's setup. */
export function registerOpenTileProvider(provider: OpenTileProvider): void {
  providers.push(provider);
}

/** A snapshot of every passable tile, unioned across providers. */
export function openTiles(): Set<string> {
  const tiles = new Set<string>();
  for (const provider of providers) {
    for (const key of provider()) {
      tiles.add(key);
    }
  }
  return tiles;
}

/**
 * A live view of `openTiles()`, for the one caller that must capture the open
 * state once and keep reading it afterwards. Each query re-asks the providers,
 * so a door that opens mid-frame is passable on the next collision query rather
 * than on the next reload. The provider count is a handful, so the rebuild costs
 * less than threading a mutable set through 003's signatures would.
 */
class LiveOpenTiles implements ReadonlySet<string> {
  get size(): number {
    return openTiles().size;
  }

  has(value: string): boolean {
    return openTiles().has(value);
  }

  forEach(
    callback: (value: string, value2: string, set: ReadonlySet<string>) => void,
    thisArg?: unknown,
  ): void {
    openTiles().forEach((value) => callback.call(thisArg, value, value, this));
  }

  entries(): SetIterator<[string, string]> {
    return openTiles().entries();
  }

  keys(): SetIterator<string> {
    return openTiles().keys();
  }

  values(): SetIterator<string> {
    return openTiles().values();
  }

  [Symbol.iterator](): SetIterator<string> {
    return openTiles()[Symbol.iterator]();
  }
}

/** The live open state 003's collider reads (FR-016). */
export const liveOpenTiles: OpenState = new LiveOpenTiles();

export { tileKey };

/** Test seam only. Production code never unregisters. */
export function resetOpenTileProvidersForTest(): void {
  providers.length = 0;
}
