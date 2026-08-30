// Which tiles are passable right now: a registry of providers (FR-016, US1-S2).
// 003's collider already takes open state as an argument, so US1 wires this in at
// its one existing call site and US3 registers secrets without re-editing it.

import { tileKey } from '../player/tiles';
import type { OpenState } from '../player/tiles';

export type OpenTileProvider = () => Iterable<string>;

const providers: OpenTileProvider[] = [];

export function registerOpenTileProvider(provider: OpenTileProvider): void {
  providers.push(provider);
}

export function openTiles(): Set<string> {
  const tiles = new Set<string>();
  for (const provider of providers) {
    for (const key of provider()) {
      tiles.add(key);
    }
  }
  return tiles;
}

/** The live view 003's collider reads (FR-016): every query re-asks the providers,
 * so a door that opens mid-frame is passable on the next collision query. */
export const liveOpenTiles: OpenState = {
  get size(): number {
    return openTiles().size;
  },
  has: (value) => openTiles().has(value),
  forEach: (callback, thisArg) => openTiles().forEach(callback, thisArg),
  entries: () => openTiles().entries(),
  keys: () => openTiles().keys(),
  values: () => openTiles().values(),
  [Symbol.iterator]: () => openTiles()[Symbol.iterator](),
};

export { tileKey };
