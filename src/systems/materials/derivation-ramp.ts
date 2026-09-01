/**
 * Where the cost of five 512px materials is spent (FR-011, US4-S6).
 *
 * Deriving the whole set in one call is ~466ms of blocked main thread, measured
 * headlessly — a frame the page owes the render loop and cannot pay. The floor
 * is not lowered for that; the work moves. A preview pass at
 * `PREVIEW_TEXTURE_SIZE` runs before the first frame for a sixty-fourth of the
 * texels, so every surface is skinned from frame one and nothing is untextured.
 * The full derivation then runs one *stage* of one material per frame, so the
 * most any single frame carries is a fraction of one material.
 *
 * Pure: no three.js, no DOM. It hands finished map sets back and the system
 * file is what puts them on the GPU.
 */
import { TEXTURE_SIZE } from '../../materials/constants';
import { generateAlbedo, generationStats } from '../../materials/generate';
import { buildMaterialMaps, type MaterialMapSet } from '../../materials/maps';
import { MATERIAL_NAMES, type MaterialName } from '../../materials/table';
import type { MaterialMapReport } from '../../materials/diagnostics';

/** Resolution of the pass that skins the level before the render loop starts:
 * 1/64th of the full set's work, and it reads as the right material, just soft,
 * for the handful of frames before its own maps arrive. */
export const PREVIEW_TEXTURE_SIZE = 64;

/** How many frames one material's full derivation is spread across. */
export const STAGES_PER_MATERIAL = 2;

/** The two halves of one material's cost, in the order they run: the height and
 * albedo fields first, then the two maps derived from them. */
interface Step {
  readonly name: MaterialName;
  readonly stage: 'generate' | 'derive';
}

/** What `MaterialDiagnostics` gains from this story, declared by augmentation
 * rather than by reopening US2's `diagnostics.ts` — a contract four stories
 * write through and none edits. */
declare module '../../materials/diagnostics' {
  interface MaterialDiagnostics {
    /** Materials still awaiting full-resolution maps; 0 once the ramp is spent.
     * A resize is only meaningfully asserted against a settled page. */
    pendingMaterials?: number;
  }
}

let maps: Record<MaterialName, MaterialMapSet> | null = null;
let queue: Step[] = [];
let fullSize = TEXTURE_SIZE;

/** Builds the preview set for every material and arms the ramp. Returns the sets
 * to skin with now; full-resolution replacements arrive later. */
export function startRamp(
  previewSize: number = PREVIEW_TEXTURE_SIZE,
  targetSize: number = TEXTURE_SIZE,
): Record<MaterialName, MaterialMapSet> {
  fullSize = targetSize;
  const built = {} as Record<MaterialName, MaterialMapSet>;
  for (const name of MATERIAL_NAMES) built[name] = buildMaterialMaps(name, previewSize);
  maps = built;
  queue = MATERIAL_NAMES.flatMap((name): Step[] => [
    { name, stage: 'generate' },
    { name, stage: 'derive' },
  ]);
  return built;
}

/** Runs the next stage and no more. Returns the set of the material that just
 * reached full resolution, or `null` for a generate half or a spent ramp. */
export function stepRamp(): MaterialMapSet | null {
  const step = queue.shift();
  if (step == null || maps == null) return null;

  if (step.stage === 'generate') {
    // Memoized by `(name, size)`, so the derive half that follows reads the
    // height field back for a map lookup rather than rebuilding it.
    generateAlbedo(step.name, fullSize);
    return null;
  }

  const full = buildMaterialMaps(step.name, fullSize);
  maps[step.name] = full;
  return full;
}

/** Materials still short of their full-resolution maps. */
export function rampPending(): number {
  return new Set(queue.map((step) => step.name)).size;
}

/** The sets as they stand — preview where the ramp has not reached yet. */
export function rampMaps(): Record<MaterialName, MaterialMapSet> | null {
  return maps;
}

/** Texture memory held across every material's three maps. */
export function rampBytes(): number {
  if (maps == null) return 0;
  return MATERIAL_NAMES.reduce((total, name) => {
    const set = maps![name];
    return total + set.albedo.length + set.normal.length + set.roughness.length;
  }, 0);
}

/** Per-material proof that both derived maps are real and not FR-007's
 * degradation, at whatever resolution each material currently holds. */
export function rampReports(): MaterialMapReport[] {
  if (maps == null) return [];
  return MATERIAL_NAMES.map((name) => ({
    name,
    hasNormal: maps![name].hasNormal,
    hasRoughness: maps![name].hasRoughness,
  }));
}

/** Generation spent so far, preview and full passes together. */
export function rampGeneratedMs(): number {
  return generationStats().generatedMs;
}

/** Test seam: forget the ramp so a suite can arm a fresh one. */
export function resetRamp(): void {
  maps = null;
  queue = [];
}
