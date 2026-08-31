/**
 * The level-diag system: publishes `window.__diag.level` once, in setup(), so the
 * smoke harness can assert map integrity without a human walking the map. It runs
 * after `level` (order 40) and registers no `update` hook, so the object stays
 * identical across reads while the renderer keeps running (US3-S6).
 *
 * The smoke harness asserts the stable half directly. It does NOT assert that
 * `fps`/`frameTimeMs` differ between reads: that is inequality of two sampled
 * floats, which a steady frame rate legitimately fails. Liveness is proven
 * instead by the harness awaiting 120 requestAnimationFrame callbacks -- a
 * frozen renderer never gets past that.
 */
import { defineSystem } from '../../boot/registry';
import { LEVEL_GRID, WALL_MATERIALS } from '../../level';
import { validateLevel } from '../../level-validate';
import { emitFaces } from '../../geometry/faces';
import { computeLevelStats, corruptGrid } from '../../level-stats';

// The query-string flag that makes the diagnostics report a corrupted grid, so the
// smoke gate can prove its failure path against a real validator rejection (FR-012).
const CORRUPT_FLAG = 'corrupt';

function readCorruptionFlag(): boolean {
  return new URLSearchParams(window.location.search).has(CORRUPT_FLAG);
}

// Wall type IDs (1..9) present in the emitted faces that have no material entry.
// These are the default-material fallbacks `src/geometry/build.ts` reports; the
// shipped grid has none, but the mechanism is here so a future wall type without a
// material entry is surfaced in `__diag.level.errors` rather than silently.
function fallbackTypesFor(faces: ReturnType<typeof emitFaces>): string[] {
  return Object.keys(faces.walls).filter(
    (type) => type >= '1' && type <= '9' && WALL_MATERIALS[type] === undefined,
  );
}

defineSystem({
  name: 'level-diag',
  order: 50,
  setup(ctx) {
    const grid = readCorruptionFlag() ? corruptGrid() : LEVEL_GRID;
    const report = validateLevel(grid);
    const faces = emitFaces(grid);
    const stats = computeLevelStats(grid, report, faces);

    for (const type of fallbackTypesFor(faces)) {
      stats.errors.push(`material: wall type '${type}' fell back to the default material`);
    }

    ctx.diag.level = stats;
  },
});
