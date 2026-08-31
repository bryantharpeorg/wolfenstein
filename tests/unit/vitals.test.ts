// T014 (FR-009, FR-010, FR-012; US2-S1, US2-S2, US2-S3, US2-S5, US2-S10): the
// player's health, the one-way death transition, and the score accumulator.
//
// Two of these properties are about what the code may *not* do. The starting
// maximum must be declared in exactly one place, so the source tree is scanned
// for a second declaration. And the damage a guard deals must be 006's
// falloff-computed number applied unchanged, so the shots below are resolved by
// `src/enemy/attack.ts` rather than by a literal written here.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  MAX_HEALTH,
  MIN_HEALTH,
  applyDamage,
  createVitals,
  isDead,
  resetVitals,
} from '../../src/combat/vitals';
import {
  SCORE_TABLE,
  TREASURE_KINDS,
  addScore,
  createScore,
  resetScore,
  scoreGuardKill,
  scoreTreasure,
} from '../../src/combat/score';
import { resolveShot } from '../../src/enemy/attack';
import { damageAtDistance } from '../../src/enemy/falloff';
import { createGuard } from '../../src/enemy/step';
import type { Guard } from '../../src/enemy/step';
import { NO_OPEN_TILES, draw, roomDraft } from './enemy-grid';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every `.ts` file under `src/`, so a second declaration cannot hide in a
 *  directory this test did not think to name. */
function sourceFiles(dir = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const ROOM = draw(roomDraft(24, 24));

/** A guard standing at the centre of cell (x, z), already committed to a shot. */
function firing(id: string, x: number, z: number): Guard {
  return { ...createGuard({ id, x: x + 0.5, z: z + 0.5 }), state: 'attack' };
}

/** One guard shot resolved against the player by 006's attack module, whose
 *  damage this spec applies rather than recomputes (Assumptions). */
function guardShotDamage(guardX: number, playerX: number): number {
  const shot = resolveShot(firing('g', guardX, 2), { x: playerX + 0.5, z: 2.5 }, ROOM, NO_OPEN_TILES);
  expect(shot).not.toBeNull();
  expect(shot!.outcome).toBe('hit');
  expect(shot!.damage).toBeGreaterThan(0);
  return shot!.damage;
}

describe('starting health is one named constant (FR-009, US2-S1)', () => {
  it('spawns at the declared maximum', () => {
    expect(MAX_HEALTH).toBeGreaterThan(0);
    expect(MIN_HEALTH).toBe(0);
    expect(createVitals().health).toBe(MAX_HEALTH);
    expect(createVitals().phase).toBe('alive');
    expect(isDead(createVitals())).toBe(false);
  });

  it('is declared in exactly one file, and that file is src/combat/vitals.ts', () => {
    const declaring = sourceFiles()
      .filter((path) => /\bMAX_HEALTH\s*[:=]\s*[0-9]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).replaceAll('\\', '/'));
    expect(declaring).toEqual(['combat/vitals.ts']);
  });
});

describe('a guard shot takes exactly its falloff damage (FR-009, US2-S2)', () => {
  it('decreases health by the attack module\'s number, unchanged', () => {
    const vitals = createVitals();
    const near = guardShotDamage(3, 8);
    expect(near).toBe(damageAtDistance(5));

    const report = applyDamage(vitals, near);
    expect(report.applied).toBe(near);
    expect(report.health).toBe(MAX_HEALTH - near);
    expect(vitals.health).toBe(MAX_HEALTH - near);
    expect(report.died).toBe(false);
  });

  it('accumulates shot by shot, each at its own distance', () => {
    const vitals = createVitals();
    const first = guardShotDamage(3, 8);
    const second = guardShotDamage(3, 6);
    applyDamage(vitals, first);
    applyDamage(vitals, second);
    expect(vitals.health).toBe(MAX_HEALTH - first - second);
    expect(second).toBeGreaterThan(first); // the nearer shot hurts more
  });

  it('clamps at a floor of zero and never reports negative health', () => {
    const vitals = createVitals();
    const report = applyDamage(vitals, MAX_HEALTH * 10);
    expect(vitals.health).toBe(MIN_HEALTH);
    expect(vitals.health).toBeGreaterThanOrEqual(0);
    // Only the health that existed is spent: the overkill is not "applied".
    expect(report.applied).toBe(MAX_HEALTH);
    expect(report.died).toBe(true);
  });

  it('ignores a shot that deals nothing, and a nonsense amount', () => {
    const vitals = createVitals();
    expect(applyDamage(vitals, 0).applied).toBe(0);
    expect(applyDamage(vitals, -25).applied).toBe(0);
    expect(applyDamage(vitals, Number.NaN).applied).toBe(0);
    expect(vitals.health).toBe(MAX_HEALTH);
  });
});

describe('health above zero keeps the run alive (FR-009, US2-S3)', () => {
  it('stays alive for every shot that leaves health standing', () => {
    const vitals = createVitals();
    const damage = guardShotDamage(3, 8);
    for (let shot = 0; vitals.health - damage > 0; shot += 1) {
      const report = applyDamage(vitals, damage);
      expect(report.died).toBe(false);
      expect(vitals.phase).toBe('alive');
      expect(isDead(vitals)).toBe(false);
      expect(vitals.deaths).toBe(0);
    }
    expect(vitals.health).toBeGreaterThan(0);
  });
});

describe('reaching zero enters `dead` exactly once (FR-010, US2-S5)', () => {
  it('transitions on the shot that brings health to zero, and only then', () => {
    const vitals = createVitals();
    const report = applyDamage(vitals, MAX_HEALTH);
    expect(vitals.health).toBe(0);
    expect(vitals.phase).toBe('dead');
    expect(isDead(vitals)).toBe(true);
    expect(report.died).toBe(true);
    expect(vitals.deaths).toBe(1);
  });

  it('fires no second transition however many further shots resolve', () => {
    const vitals = createVitals();
    applyDamage(vitals, MAX_HEALTH);
    for (let shot = 0; shot < 12; shot += 1) {
      const report = applyDamage(vitals, guardShotDamage(3, 8));
      expect(report.died).toBe(false);
      expect(report.applied).toBe(0);
      expect(vitals.health).toBe(0);
    }
    expect(vitals.deaths).toBe(1);
    expect(vitals.phase).toBe('dead');
  });

  it('counts a second death only after a reset returned the run to alive', () => {
    const vitals = createVitals();
    applyDamage(vitals, MAX_HEALTH);
    resetVitals(vitals);
    expect(vitals.health).toBe(MAX_HEALTH);
    expect(vitals.phase).toBe('alive');
    // The session counter survives the reset; the run state does not.
    expect(vitals.deaths).toBe(1);

    applyDamage(vitals, MAX_HEALTH);
    expect(vitals.deaths).toBe(2);
  });
});

describe('the one score table (FR-012, US2-S10)', () => {
  it('declares a value for a guard kill and for each treasure kind', () => {
    expect(SCORE_TABLE.guardKill).toBeGreaterThan(0);
    expect(TREASURE_KINDS.length).toBeGreaterThan(0);
    for (const kind of TREASURE_KINDS) {
      expect(SCORE_TABLE.treasure[kind]).toBeGreaterThan(0);
    }
  });

  it('rises on a kill and on treasure, by the table\'s amounts', () => {
    const score = createScore();
    expect(score.points).toBe(0);
    expect(scoreGuardKill(score)).toBe(SCORE_TABLE.guardKill);
    expect(score.points).toBe(SCORE_TABLE.guardKill);
    const treasure = SCORE_TABLE.treasure[TREASURE_KINDS[0]!];
    expect(scoreTreasure(score, TREASURE_KINDS[0]!)).toBe(SCORE_TABLE.guardKill + treasure);
    expect(score.points).toBe(SCORE_TABLE.guardKill + treasure);
  });

  it('never decreases within a run', () => {
    const score = createScore();
    scoreGuardKill(score);
    const high = score.points;
    addScore(score, -500);
    addScore(score, 0);
    addScore(score, Number.NaN);
    expect(score.points).toBe(high);
    scoreGuardKill(score);
    expect(score.points).toBeGreaterThan(high);
  });

  it('returns to zero on reset, and nowhere else', () => {
    const score = createScore();
    scoreGuardKill(score);
    expect(score.points).toBeGreaterThan(0);
    resetScore(score);
    expect(score.points).toBe(0);
  });
});
