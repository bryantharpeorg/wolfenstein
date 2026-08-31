import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  DEFAULT_WEAPON,
  WEAPON_KINDS,
  WEAPON_SELECT_KEY_CODES,
  WEAPON_SWITCH_DELAY_SECONDS,
  startingAmmo,
  weaponFor,
  WEAPON_TABLE,
  type Weapon,
  type WeaponKind,
} from '../../src/combat/weapons';

// FR-002 / FR-003, US1-S2 / US1-S3. The table is the whole of the tuning: three
// weapons, seven declared numbers each, two strict orderings between them, and
// no call site allowed to restate any of it.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const WEAPONS_PATH = join(SRC, 'combat/weapons.ts');

function tsFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsFilesUnder(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** Every file that reads the table — the call sites FR-002 forbids literals in. */
function callSites(): string[] {
  return tsFilesUnder(SRC)
    .filter((path) => path !== WEAPONS_PATH)
    .filter((path) => /from\s+['"]\.[^'"]*\/weapons['"]/.test(readFileSync(path, 'utf8')))
    .sort();
}

describe('the weapon table (FR-002, US1-S2)', () => {
  it('declares exactly pistol, smg and chaingun', () => {
    expect(Object.keys(WEAPON_TABLE).sort()).toEqual(['chaingun', 'pistol', 'smg']);
    expect([...WEAPON_KINDS].sort()).toEqual(['chaingun', 'pistol', 'smg']);
    expect(WEAPON_KINDS).toHaveLength(3);
  });

  it.each([...WEAPON_KINDS])('%s declares every tuning field, all positive', (kind: WeaponKind) => {
    const weapon: Weapon = WEAPON_TABLE[kind];
    expect(weapon.kind).toBe(kind);
    for (const field of [
      'fireIntervalSeconds',
      'damage',
      'maxSpreadRadians',
      'ammoCost',
      'ammoCapacity',
      'startingAmmo',
      'maxRangeCells',
    ] as const) {
      expect(typeof weapon[field], `${kind}.${field}`).toBe('number');
      expect(weapon[field], `${kind}.${field}`).toBeGreaterThan(0);
      expect(Number.isFinite(weapon[field]), `${kind}.${field}`).toBe(true);
    }
    expect(weapon.startingAmmo).toBeLessThanOrEqual(weapon.ammoCapacity);
    expect(weapon.ammoCost).toBeLessThanOrEqual(weapon.startingAmmo);
  });

  it('resolves a weapon by kind and a starting magazine from the same table', () => {
    for (const kind of WEAPON_KINDS) {
      expect(weaponFor(kind)).toBe(WEAPON_TABLE[kind]);
      expect(startingAmmo()[kind]).toBe(WEAPON_TABLE[kind].startingAmmo);
    }
    // A fresh record each call: two runs must not share one magazine.
    expect(startingAmmo()).not.toBe(startingAmmo());
    expect(startingAmmo()).toEqual(startingAmmo());
  });

  it('declares the default weapon, the switch delay and one select key per weapon', () => {
    expect(WEAPON_KINDS).toContain(DEFAULT_WEAPON);
    expect(WEAPON_SWITCH_DELAY_SECONDS).toBeGreaterThan(0);
    expect(Object.keys(WEAPON_SELECT_KEY_CODES).sort()).toEqual(['Digit1', 'Digit2', 'Digit3']);
    expect(Object.values(WEAPON_SELECT_KEY_CODES).sort()).toEqual(['chaingun', 'pistol', 'smg']);
  });
});

describe('the two strict orderings (FR-003, US1-S3)', () => {
  it('orders fire intervals chaingun < smg < pistol, strictly', () => {
    expect(WEAPON_TABLE.chaingun.fireIntervalSeconds).toBeLessThan(
      WEAPON_TABLE.smg.fireIntervalSeconds,
    );
    expect(WEAPON_TABLE.smg.fireIntervalSeconds).toBeLessThan(
      WEAPON_TABLE.pistol.fireIntervalSeconds,
    );
  });

  it('orders maximum spreads pistol < smg < chaingun, strictly', () => {
    expect(WEAPON_TABLE.pistol.maxSpreadRadians).toBeLessThan(WEAPON_TABLE.smg.maxSpreadRadians);
    expect(WEAPON_TABLE.smg.maxSpreadRadians).toBeLessThan(WEAPON_TABLE.chaingun.maxSpreadRadians);
  });

  it('keeps the slow weapon the hard-hitting one, so the orderings are a trade', () => {
    expect(WEAPON_TABLE.pistol.damage).toBeGreaterThan(WEAPON_TABLE.smg.damage);
    expect(WEAPON_TABLE.smg.damage).toBeGreaterThan(WEAPON_TABLE.chaingun.damage);
  });
});

describe('no tuning value is restated at a call site (FR-002)', () => {
  const sites = callSites();

  it('finds call sites to check, so the scan is not vacuous', () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it.each(sites)('%s writes no value from the table as a literal', (path: string) => {
    // Values below ten with no decimal point (an ammo cost of 1 or 2) are
    // excluded: they are indistinguishable from an array index or a sign, and
    // an exclusion stated here is honest where a silent one would not be.
    const scanned = new Set<number>();
    for (const kind of WEAPON_KINDS) {
      const weapon = WEAPON_TABLE[kind];
      for (const value of [
        weapon.fireIntervalSeconds,
        weapon.damage,
        weapon.maxSpreadRadians,
        weapon.ammoCapacity,
        weapon.startingAmmo,
        weapon.maxRangeCells,
      ]) {
        if (value >= 10 || !Number.isInteger(value)) scanned.add(value);
      }
    }
    scanned.add(WEAPON_SWITCH_DELAY_SECONDS);
    expect(scanned.size).toBeGreaterThan(10);

    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)) {
        const value = Number(match[0]);
        if (!scanned.has(value)) continue;
        throw new Error(`${path}:${index + 1} restates the table value ${value}: ${line.trim()}`);
      }
    });
    expect(true).toBe(true);
  });
});
