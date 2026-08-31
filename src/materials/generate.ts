// The generation orchestrator: raw buffers in memory, one per (name, size),
// produced once per page load and never inside the frame loop (FR-001, FR-003,
// FR-004, US1-S3, US1-S8). Nothing here knows what a renderer is.

import { GENERATION_BUDGET_MS, RGBA_CHANNELS, TEXTURE_SIZE } from './constants';
import { renderMaterial } from './patterns';
import type { RawMaterial } from './patterns';
import { MATERIAL_NAMES, MATERIAL_TABLE } from './table';
import type { MaterialName, MaterialSpec } from './table';

export interface GeneratedMaterial extends RawMaterial {
  readonly name: MaterialName;
  readonly size: number;
}

/** What one generation pass cost, for diagnostics US2 publishes (FR-004). */
export interface MaterialGenerationEntry {
  readonly name: MaterialName;
  readonly size: number;
  readonly ms: number;
  readonly bytes: number;
}

export interface GenerationStats {
  /** Milliseconds spent generating, accumulated across every material. */
  readonly generatedMs: number;
  /** How many materials were actually generated — a memo hit adds nothing. */
  readonly generatedCount: number;
  readonly budgetMs: number;
  /** False records an overrun for diagnostics; it never aborts a load. */
  readonly withinBudget: boolean;
  readonly bytes: number;
  readonly materials: readonly MaterialGenerationEntry[];
}

const memo = new Map<string, GeneratedMaterial>();
const passes: MaterialGenerationEntry[] = [];
let generatedMs = 0;

function elapsed(): number {
  return performance.now();
}

/**
 * One material from one spec at one size — pure, uncached, and the function
 * FR-003 is stated over: the same `(seed, size)` pair yields byte-identical
 * output, and a different seed yields different bytes.
 */
export function generateMaterial(spec: MaterialSpec, size: number): GeneratedMaterial {
  const { albedo, height } = renderMaterial(spec, size);
  return { name: spec.name, size, albedo, height };
}

/**
 * The memoized entry point the application calls: a material is generated at
 * most once per `(name, size)` for the lifetime of the page, so a second call
 * — from a resize, a re-bind, or a frame — costs a map lookup (US1-S8).
 */
export function generateAlbedo(name: MaterialName, size: number = TEXTURE_SIZE): GeneratedMaterial {
  const key = `${name}@${size}`;
  const cached = memo.get(key);
  if (cached) return cached;

  const startedAt = elapsed();
  const generated = generateMaterial(MATERIAL_TABLE[name], size);
  const ms = elapsed() - startedAt;
  generatedMs += ms;
  passes.push({ name, size, ms, bytes: size * size * RGBA_CHANNELS });
  memo.set(key, generated);
  return generated;
}

/**
 * All five materials, generated at load. The elapsed total is measured across
 * the whole set and compared against the declared budget; an overrun records a
 * number rather than aborting the load, because a slow machine is not a broken
 * build (FR-004, Edge Cases).
 */
export function generateAllMaterials(
  size: number = TEXTURE_SIZE,
): Record<MaterialName, GeneratedMaterial> {
  const generated = {} as Record<MaterialName, GeneratedMaterial>;
  for (const name of MATERIAL_NAMES) generated[name] = generateAlbedo(name, size);
  return generated;
}

/** What generation has cost so far — read by diagnostics, never by the loop. */
export function generationStats(): GenerationStats {
  return {
    generatedMs,
    generatedCount: passes.length,
    budgetMs: GENERATION_BUDGET_MS,
    withinBudget: generatedMs <= GENERATION_BUDGET_MS,
    bytes: passes.reduce((total, pass) => total + pass.bytes, 0),
    materials: [...passes],
  };
}
