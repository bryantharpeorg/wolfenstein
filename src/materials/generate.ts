// The generation orchestrator: raw buffers in memory, one per (name, size),
// produced once per page load and never inside the frame loop (FR-001, FR-003,
// FR-004, US1-S3, US1-S8). Nothing here knows what a renderer is.

import { TEXTURE_SIZE } from './constants';
import { renderMaterial } from './patterns';
import type { RawMaterial } from './patterns';
import { MATERIAL_NAMES, MATERIAL_TABLE } from './table';
import type { MaterialName, MaterialSpec } from './table';

export interface GeneratedMaterial extends RawMaterial {
  readonly name: MaterialName;
  readonly size: number;
}

const memo = new Map<string, GeneratedMaterial>();

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

  const generated = generateMaterial(MATERIAL_TABLE[name], size);
  memo.set(key, generated);
  return generated;
}

/** All five materials, generated at load and never again. */
export function generateAllMaterials(
  size: number = TEXTURE_SIZE,
): Record<MaterialName, GeneratedMaterial> {
  const generated = {} as Record<MaterialName, GeneratedMaterial>;
  for (const name of MATERIAL_NAMES) generated[name] = generateAlbedo(name, size);
  return generated;
}
