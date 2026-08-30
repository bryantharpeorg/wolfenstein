// Geometry builder entry point. US1 owns the guard: no geometry is ever built
// from a malformed map (US1-S6). The actual face emission and mesh assembly
// land in US2 (T012-T016); this module is the seam that runs `validateLevel()`
// first and throws a typed failure carrying the error list when the grid is
// invalid, so a bad map is refused before any geometry is built from it.
//
// Pure: no three.js, no DOM (FR-004). US2 adds the three.js import when it
// turns the emitted faces into BufferGeometry meshes.

import { validateLevel, type ValidationReport, type ValidateLevelOptions } from '../level-validate';
import { LEVEL_GRID } from '../level';

// A typed build failure carrying the validator's report, so the caller (US2's
// level system) can render the named errors into the document body instead of a
// partial level, rather than surfacing a bare stack trace.
export class LevelBuildError extends Error {
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    super(
      `cannot build level geometry: ${report.errors.length} validation error(s) — ` +
        report.errors.map((e) => e.message).join('; '),
    );
    this.name = 'LevelBuildError';
    this.report = report;
  }
}

// The geometry US2 assembles from the emitted faces. US1 leaves it empty: the
// guard below is the only part of the build contract this story depends on.
export interface LevelGeometry {
  walls: unknown[];
  floor: unknown;
  ceiling: unknown;
}

// Builds level geometry from a grid, refusing a malformed map first. Throws
// `LevelBuildError` (carrying the full validation report) when the grid is
// invalid, so geometry building from a bad grid throws rather than rendering
// (US1-S6). Returns an empty geometry set for a valid grid until US2 fills in
// the face emission and mesh assembly.
export function buildLevelGeometry(
  grid: string[] = LEVEL_GRID,
  options: ValidateLevelOptions = {},
): LevelGeometry {
  const report = validateLevel(grid, options);
  if (!report.valid) {
    throw new LevelBuildError(report);
  }
  return { walls: [], floor: null, ceiling: null };
}
