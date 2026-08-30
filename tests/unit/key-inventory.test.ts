import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KEY_KINDS,
  createInventory,
  addKey,
  hasKey,
  keyCounts,
} from '../../src/interaction/keys';
import {
  buildKeyPickups,
  keyPickupAt,
  collectKeyPickupAt,
  pickupKind,
} from '../../src/interaction/pickups';
import { ITEM_SPAWNS } from '../../src/level';

// Same proof shape as tests/unit/level-purity.test.ts: importing the module from
// a node-environment test with no `window` is itself half the evidence; the
// source-text assertions catch a DOM or three.js reference behind a lazy branch.
const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

const keysSource = readFileSync(new URL('../../src/interaction/keys.ts', import.meta.url), 'utf8');
const pickupsSource = readFileSync(
  new URL('../../src/interaction/pickups.ts', import.meta.url),
  'utf8',
);

describe('key inventory purity (FR-007, US2-S1)', () => {
  it('imports neither three nor a DOM API', () => {
    expect(THREE_IMPORT.test(keysSource)).toBe(false);
    expect(DOM_GLOBAL.test(keysSource)).toBe(false);
    expect(THREE_IMPORT.test(pickupsSource)).toBe(false);
    expect(DOM_GLOBAL.test(pickupsSource)).toBe(false);
  });

  it('imports no level module from keys.ts — the inventory knows nothing of the map', () => {
    expect(/from\s+['"]\.\.\/level['"]/.test(keysSource)).toBe(false);
  });

  it('holds only counts keyed by silver and gold', () => {
    expect([...KEY_KINDS]).toEqual(['silver', 'gold']);
    const inventory = createInventory();
    expect(Object.keys(inventory).sort()).toEqual(['gold', 'silver']);
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 0 });
    expect(Object.keys(keyCounts(inventory)).sort()).toEqual(['gold', 'silver']);
  });

  it('starts empty and reports no key of either kind', () => {
    const inventory = createInventory();
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

  it('returns a copy from keyCounts, so a caller cannot mutate the inventory through it', () => {
    const inventory = createInventory();
    const counts = keyCounts(inventory);
    counts.gold = 99;
    expect(keyCounts(inventory).gold).toBe(0);
  });
});

describe('key pickups (FR-008, US2-S2)', () => {
  it('builds one pickup per key entry of 002 spawn table, unconsumed', () => {
    const pickups = buildKeyPickups();
    const expected = ITEM_SPAWNS.filter((s) => s.kind === 'silver-key' || s.kind === 'gold-key');
    expect(pickups).toHaveLength(expected.length);
    expect(pickups.length).toBeGreaterThan(0);
    for (const pickup of pickups) {
      expect(pickup.consumed).toBe(false);
      expect(KEY_KINDS).toContain(pickup.kind);
    }
    expect(pickupKind('silver-key')).toBe('silver');
    expect(pickupKind('gold-key')).toBe('gold');
    expect(pickupKind('treasure')).toBe(null);
  });

  it('ignores non-key item spawns', () => {
    const pickups = buildKeyPickups([
      { x: 1, z: 1, kind: 'treasure' },
      { x: 2, z: 2, kind: 'health' },
      { x: 3, z: 3, kind: 'gold-key' },
    ]);
    expect(pickups).toHaveLength(1);
    expect(pickups[0]?.kind).toBe('gold');
    expect(keyPickupAt(pickups, 1, 1)).toBe(null);
    expect(keyPickupAt(pickups, 3, 3)?.kind).toBe('gold');
  });

  it('collecting a silver pickup at its occupied tile adds exactly one silver key', () => {
    const inventory = createInventory();
    const pickups = buildKeyPickups([{ x: 4, z: 7, kind: 'silver-key' }]);

    const result = collectKeyPickupAt(pickups, 4, 7, inventory);

    expect(result.collected).toBe(true);
    expect(result.kind).toBe('silver');
    expect(keyCounts(inventory)).toEqual({ silver: 1, gold: 0 });
    expect(pickups[0]?.consumed).toBe(true);
  });

  it('collecting the same pickup a second time in one session does not yield two keys', () => {
    const inventory = createInventory();
    const pickups = buildKeyPickups([{ x: 4, z: 7, kind: 'silver-key' }]);

    collectKeyPickupAt(pickups, 4, 7, inventory);
    const second = collectKeyPickupAt(pickups, 4, 7, inventory);
    const third = collectKeyPickupAt(pickups, 4, 7, inventory);

    expect(second.collected).toBe(false);
    expect(second.kind).toBe(null);
    expect(third.collected).toBe(false);
    expect(keyCounts(inventory)).toEqual({ silver: 1, gold: 0 });
  });

  it('reports nothing collected on a tile that holds no key pickup', () => {
    const inventory = createInventory();
    const pickups = buildKeyPickups([{ x: 4, z: 7, kind: 'gold-key' }]);

    const result = collectKeyPickupAt(pickups, 9, 9, inventory);

    expect(result.collected).toBe(false);
    expect(result.kind).toBe(null);
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 0 });
  });
});
