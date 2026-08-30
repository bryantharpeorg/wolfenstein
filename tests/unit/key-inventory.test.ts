import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KEY_KINDS, createInventory, addKey, hasKey, keyCounts } from '../../src/interaction/keys';
import {
  buildKeyPickups,
  keyPickupAt,
  collectKeyPickupAt,
  pickupKind,
} from '../../src/interaction/pickups';
import { ITEM_SPAWNS } from '../../src/level';

// Same proof shape as tests/unit/level-purity.test.ts: importing the module from a
// node environment with no `window` is half the evidence; the source-text scan
// catches a DOM or three.js reference hidden behind a lazy branch (US2-S1).
const THREE = /(from\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM = /\b(window|document|navigator|localStorage|HTMLElement|requestAnimationFrame|addEventListener)\b/;
const read = (name: string): string =>
  readFileSync(new URL(`../../src/interaction/${name}`, import.meta.url), 'utf8');

describe('key inventory purity (FR-007, US2-S1)', () => {
  it('imports neither three nor a DOM API, and keys.ts knows nothing of the map', () => {
    for (const source of [read('keys.ts'), read('pickups.ts')]) {
      expect(THREE.test(source)).toBe(false);
      expect(DOM.test(source)).toBe(false);
    }
    expect(/from\s+['"]\.\.\/level['"]/.test(read('keys.ts'))).toBe(false);
  });

  it('holds only counts keyed by silver and gold, starting empty', () => {
    expect([...KEY_KINDS]).toEqual(['silver', 'gold']);
    const inventory = createInventory();
    expect(Object.keys(inventory).sort()).toEqual(['gold', 'silver']);
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 0 });
    expect(hasKey(inventory, 'silver')).toBe(false);
    expect(hasKey(inventory, 'gold')).toBe(false);
  });

  it('adds exactly one key of the named kind and leaves the other alone', () => {
    const inventory = createInventory();
    addKey(inventory, 'silver');
    expect(keyCounts(inventory)).toEqual({ silver: 1, gold: 0 });
    expect(hasKey(inventory, 'silver')).toBe(true);
    expect(hasKey(inventory, 'gold')).toBe(false);
  });

  it('reports counts as a copy, so no reader can spend a key through them', () => {
    const inventory = createInventory();
    keyCounts(inventory).gold = 99;
    expect(keyCounts(inventory).gold).toBe(0);
  });
});

describe('key pickups (FR-008, US2-S2)', () => {
  it('builds one unconsumed pickup per key of 002 spawn table, ignoring other items', () => {
    const shipped = buildKeyPickups();
    expect(shipped).toHaveLength(
      ITEM_SPAWNS.filter((s) => s.kind === 'silver-key' || s.kind === 'gold-key').length,
    );
    expect(shipped.length).toBeGreaterThan(0);
    for (const pickup of shipped) {
      expect(pickup.consumed).toBe(false);
      expect(KEY_KINDS).toContain(pickup.kind);
    }
    expect([pickupKind('silver-key'), pickupKind('gold-key'), pickupKind('treasure')]).toEqual([
      'silver',
      'gold',
      null,
    ]);

    const mixed = buildKeyPickups([
      { x: 1, z: 1, kind: 'treasure' },
      { x: 3, z: 3, kind: 'gold-key' },
    ]);
    expect(mixed).toHaveLength(1);
    expect(keyPickupAt(mixed, 1, 1)).toBe(null);
    expect(keyPickupAt(mixed, 3, 3)?.kind).toBe('gold');
  });

  it('collects a silver pickup at its occupied tile as exactly one silver key', () => {
    const inventory = createInventory();
    const pickups = buildKeyPickups([{ x: 4, z: 7, kind: 'silver-key' }]);

    const result = collectKeyPickupAt(pickups, 4, 7, inventory);

    expect(result).toEqual({ collected: true, kind: 'silver' });
    expect(keyCounts(inventory)).toEqual({ silver: 1, gold: 0 });
    expect(pickups[0]?.consumed).toBe(true);
  });

  it('does not yield a second key when the same pickup is collected again', () => {
    const inventory = createInventory();
    const pickups = buildKeyPickups([{ x: 4, z: 7, kind: 'silver-key' }]);

    const nothing = { collected: false, kind: null };
    collectKeyPickupAt(pickups, 4, 7, inventory);
    expect(collectKeyPickupAt(pickups, 4, 7, inventory)).toEqual(nothing);
    expect(collectKeyPickupAt(pickups, 4, 7, inventory)).toEqual(nothing);
    expect(keyCounts(inventory)).toEqual({ silver: 1, gold: 0 });
  });

  it('reports nothing collected on a tile that holds no pickup', () => {
    const inventory = createInventory();
    const pickups = buildKeyPickups([{ x: 4, z: 7, kind: 'gold-key' }]);

    expect(collectKeyPickupAt(pickups, 9, 9, inventory)).toEqual({ collected: false, kind: null });
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 0 });
  });
});
