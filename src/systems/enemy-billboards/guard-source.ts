// Where the billboards get their guards.
//
// US4 draws guard records; US3 owns the live ones (`src/enemy/world.ts`, which
// ticks the AI and publishes them onto `__diag.enemies`). This story cannot
// import a module its sibling has not landed yet, and must not grow a second
// world beside it either, so the seam is the *published records* rather than the
// module: whatever is already on `__diag.enemies` and carries a position is
// adopted as-is, and only when nothing has published anything does this file
// stand a guard on each of the level's own spawn markers so the renderer has
// something to draw.
//
// The adopted path is the one that runs once US3 lands: its records carry
// `state`, `viewAngle` and `pathable` (FR-011), the billboard system writes
// `viewAngle` back onto them each frame, and this fallback stops firing without
// either story editing the other's files.

import { ENEMY_SPAWNS, TILE_SIZE } from '../../level';
import { createGuard } from '../../enemy/guard';
import { bearingFromDelta } from '../../enemy/view-angle';
import type { EnemyDiagnostic } from '../../enemy/enemy-diag';
import type { Diagnostics } from '../../diag/diag';

/** A guard record with enough on it to place a billboard. FR-011's three fields
 *  plus where the guard stands and which way it looks. */
export interface GuardRecord extends EnemyDiagnostic {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
}

/** A published record, before it is known whether it carries a position: US3's
 *  world reports its guard's cell, which is the position in tile units. */
interface PositionedRecord extends EnemyDiagnostic {
  x?: number;
  z?: number;
  facing?: number;
  cell?: { x: number; z: number };
}

function positionOf(record: PositionedRecord): { x: number; z: number } | null {
  if (typeof record.x === 'number' && typeof record.z === 'number') {
    return { x: record.x, z: record.z };
  }
  if (record.cell != null) {
    return { x: record.cell.x + TILE_SIZE / 2, z: record.cell.z + TILE_SIZE / 2 };
  }
  return null;
}

/** Whether the records on `__diag.enemies` are usable as billboard sources. */
export function isAdoptable(enemies: readonly EnemyDiagnostic[] | undefined): boolean {
  if (enemies == null || enemies.length === 0) return false;
  return enemies.every((record) => positionOf(record as PositionedRecord) != null);
}

/** The position and heading of an adopted record, re-read every frame because a
 *  live guard walks. */
export function readAdopted(record: EnemyDiagnostic): GuardRecord {
  const positioned = record as PositionedRecord;
  const position = positionOf(positioned) ?? { x: 0, z: 0 };
  return {
    state: record.state,
    viewAngle: record.viewAngle,
    pathable: record.pathable,
    x: position.x,
    z: position.z,
    facing: typeof positioned.facing === 'number' ? positioned.facing : 0,
  };
}

/** The level's centre, which the fallback guards face so that eight markers do
 *  not all present the same bearing to a player walking between them. */
const LEVEL_CENTRE = { x: 32, z: 32 };

/**
 * One stationary guard per spawn marker, standing at its tile's centre. These
 * are records, not a simulation: they hold `idle` and never move, because the
 * behaviour that moves them is US3's and lands in its own file.
 */
export function spawnFallbackGuards(): GuardRecord[] {
  return ENEMY_SPAWNS.map((marker, index) => {
    const x = marker.x + TILE_SIZE / 2;
    const z = marker.z + TILE_SIZE / 2;
    const guard = createGuard({
      id: `guard-${index}`,
      x,
      z,
      facing: bearingFromDelta(LEVEL_CENTRE.x - x, LEVEL_CENTRE.z - z),
    });
    return {
      state: guard.state,
      viewAngle: 0,
      pathable: guard.pathable,
      x: guard.x,
      z: guard.z,
      facing: guard.facing,
    };
  });
}

export interface GuardSource {
  /** The records the renderer draws and writes `viewAngle` onto. */
  readonly records: EnemyDiagnostic[];
  /** True when the records came from another system rather than the fallback. */
  readonly adopted: boolean;
}

/**
 * Resolves the guards for this frame. Called every frame rather than once at
 * setup, because the system that owns the live records may register after this
 * one and may replace the array wholesale.
 */
export function resolveGuardSource(diag: Diagnostics, fallback: EnemyDiagnostic[]): GuardSource {
  const published = diag.enemies;
  if (published != null && published !== fallback && isAdoptable(published)) {
    return { records: published, adopted: true };
  }
  return { records: fallback, adopted: false };
}
