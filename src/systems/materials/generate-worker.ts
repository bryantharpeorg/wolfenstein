/**
 * The whole map derivation for one material, off the main thread (FR-011,
 * US4-S6).
 *
 * `src/materials/` was written to import neither three.js nor any DOM API,
 * which is what makes every texel assertable under vitest — and, for free, what
 * makes it runnable here. The worker owns its own copy of the generation
 * memo, so it reports the milliseconds it spent back with each result; the
 * page adds them to `generatedMs` because a user waited for them even though
 * no frame was blocked by them.
 *
 * A degradation taken in here (FR-007) is carried back rather than swallowed:
 * this thread's diagnostics record dies with the message.
 */
import { generationStats } from '../../materials/generate';
import { buildMaterialMaps } from '../../materials/maps';
import { materialDiagnostics } from '../../materials/diagnostics';
import type { MaterialFallback } from '../../materials/diagnostics';
import type { MaterialName } from '../../materials/table';

export interface DeriveRequest {
  readonly name: MaterialName;
  readonly size: number;
}

/** The map set flattened to transferable buffers. Reassembled by the host. */
export interface DeriveResult {
  readonly name: MaterialName;
  readonly size: number;
  /** Milliseconds this thread spent on the material. */
  readonly ms: number;
  readonly albedo: Uint8ClampedArray;
  readonly normal: Uint8ClampedArray;
  readonly roughness: Uint8ClampedArray;
  readonly height: Float32Array;
  readonly hasNormal: boolean;
  readonly hasRoughness: boolean;
  /** Degradations recorded while deriving, to replay on the page (FR-007). */
  readonly fallbacks: readonly MaterialFallback[];
}

/** `lib` is DOM here, not WebWorker — the two conflict and every other module in
 * this project is a page module. The three members this file uses are named
 * rather than pulled in wholesale. */
interface WorkerScope {
  onmessage: ((event: { data: DeriveRequest }) => void) | null;
  postMessage(message: DeriveResult, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { name, size } = event.data;
  const before = generationStats().generatedMs;
  const set = buildMaterialMaps(name, size);
  const ms = generationStats().generatedMs - before;

  const result: DeriveResult = {
    name,
    size,
    ms,
    albedo: set.albedo,
    normal: set.normal,
    roughness: set.roughness,
    height: set.height,
    hasNormal: set.hasNormal,
    hasRoughness: set.hasRoughness,
    fallbacks: materialDiagnostics().fallbacks.filter((entry) => entry.name === name),
  };

  scope.postMessage(result, [
    set.albedo.buffer as ArrayBuffer,
    set.normal.buffer as ArrayBuffer,
    set.roughness.buffer as ArrayBuffer,
    set.height.buffer as ArrayBuffer,
  ]);
};
