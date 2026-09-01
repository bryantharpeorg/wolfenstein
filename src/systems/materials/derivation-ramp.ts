/**
 * Where the cost of five 512px materials is spent (FR-011, US4-S6).
 *
 * Deriving the whole set in one call is roughly a third of a second of blocked
 * main thread — measured headlessly at ~466ms, which is a frame the page owes
 * the render loop and cannot pay. The floor is not lowered to accommodate that;
 * the work moves:
 *
 *  - a preview pass at `PREVIEW_TEXTURE_SIZE` runs before the first frame. It
 *    costs one sixty-fourth of the texels, so every surface is skinned with a
 *    real generated albedo from frame one and nothing is ever untextured;
 *  - the full derivation then runs one *stage* of one material per frame. The
 *    generate half and the derive half are separate steps, so the largest piece
 *    of work any single frame carries is a fraction of one material.
 *
 * The module is pure: no three.js, no DOM. It hands finished map sets back and
 * the system file is what puts them on the GPU.
 */
import { TEXTURE_SIZE } from '../../materials/constants';
import { generateAlbedo, generationStats } from '../../materials/generate';
import { buildMaterialMaps, type MaterialMapSet } from '../../materials/maps';
import { MATERIAL_NAMES, type MaterialName } from '../../materials/table';
import type { MaterialMapReport } from '../../materials/diagnostics';

/** Resolution of the pass that skins the level before the render loop starts.
 * Sixty-four texels a side is 1/64th of the full set's work — a few
 * milliseconds — and reads as the right material, just soft, for the handful of
 * frames before its own maps arrive. */
export const PREVIEW_TEXTURE_SIZE = 64;

/** How many frames one material's full derivation is spread across. */
export const STAGES_PER_MATERIAL = 2;

/** The two halves of one material's cost, in the order they must run: the
 * height and albedo fields first, then the two maps derived from them. */
type Stage = 'generate' | 'derive';

interface Step {
  readonly name: MaterialName;
  readonly stage: Stage;
}

/** How much `MaterialDiagnostics` gains from this story: how many materials are
 * still short of their full resolution. Declared here, by augmentation, rather
 * than by reopening US2's `diagnostics.ts` — that file is a contract four
 * stories write through and none edits. */
declare module '../../materials/diagnostics' {
  interface MaterialDiagnostics {
    /** Materials still awaiting their full-resolution maps; 0 once the ramp is
     * spent. A resize is only meaningfully asserted against a settled page. */
    pendingMaterials?: number;
    /** Whether the full derivation ran on a worker rather than on the frames
     * the page owes the render loop. False is a legitimate outcome — an
     * environment with no `Worker` takes the stepped fallback — but it is the
     * difference between the two costs, so it is reported rather than assumed. */
    derivedOffThread?: boolean;
  }
}

let maps: Record<MaterialName, MaterialMapSet> | null = null;
let queue: Step[] = [];
let fullSize = TEXTURE_SIZE;
/** Generation time spent off this thread, which `generationStats()` cannot see
 * because it accumulates in the worker's own copy of the module. */
let offThreadMs = 0;

/**
 * Builds the preview set for every material and arms the ramp. Returns the map
 * sets to skin with immediately — full-resolution replacements arrive later,
 * one stage per `stepRamp()` call.
 */
export function startRamp(
  previewSize: number = PREVIEW_TEXTURE_SIZE,
  targetSize: number = TEXTURE_SIZE,
): Record<MaterialName, MaterialMapSet> {
  fullSize = targetSize;
  offThreadMs = 0;
  const built = {} as Record<MaterialName, MaterialMapSet>;
  for (const name of MATERIAL_NAMES) built[name] = buildMaterialMaps(name, previewSize);
  maps = built;
  queue = MATERIAL_NAMES.flatMap((name) => [
    { name, stage: 'generate' as Stage },
    { name, stage: 'derive' as Stage },
  ]);
  return built;
}

/**
 * Runs the next stage, and no more than that. Returns the map set of the
 * material that just reached full resolution, or `null` when the step was a
 * generate half or the ramp is already spent.
 */
export function stepRamp(): MaterialMapSet | null {
  const step = queue.shift();
  if (step == null || maps == null) return null;

  if (step.stage === 'generate') {
    // Memoized by `(name, size)`, so the derive half that follows reads the
    // height field back for the price of a map lookup rather than rebuilding it.
    generateAlbedo(step.name, fullSize);
    return null;
  }

  const full = buildMaterialMaps(step.name, fullSize);
  maps[step.name] = full;
  return full;
}

/**
 * Installs a full-resolution set derived somewhere else — the worker path —
 * and drops that material's outstanding stages, so the stepped fallback never
 * re-derives what has already arrived. `generatedMs` is the time the other
 * thread spent, which the page paid for even though this one did not block.
 */
export function completeRamp(set: MaterialMapSet, generatedMs = 0): void {
  if (maps == null) return;
  maps[set.name] = set;
  offThreadMs += generatedMs;
  queue = queue.filter((step) => step.name !== set.name);
}

/** Materials still short of their full-resolution maps. */
export function rampPending(): number {
  return new Set(queue.map((step) => step.name)).size;
}

/** The map sets as they stand — preview where the ramp has not reached yet. */
export function rampMaps(): Record<MaterialName, MaterialMapSet> | null {
  return maps;
}

/** Texture memory currently held across every material's three maps. */
export function rampBytes(): number {
  if (maps == null) return 0;
  return MATERIAL_NAMES.reduce((total, name) => {
    const set = maps![name];
    return total + set.albedo.length + set.normal.length + set.roughness.length;
  }, 0);
}

/** Per-material proof that both derived maps are real and not FR-007's
 * degradation, for whichever resolution each material currently holds. */
export function rampReports(): MaterialMapReport[] {
  if (maps == null) return [];
  return MATERIAL_NAMES.map((name) => ({
    name,
    hasNormal: maps![name].hasNormal,
    hasRoughness: maps![name].hasRoughness,
  }));
}

/** Milliseconds of generation spent so far, preview and full passes together. */
export function rampGeneratedMs(): number {
  return generationStats().generatedMs + offThreadMs;
}

/** Test seam: forget the ramp so a suite can arm a fresh one. */
export function resetRamp(): void {
  maps = null;
  queue = [];
  offThreadMs = 0;
}
