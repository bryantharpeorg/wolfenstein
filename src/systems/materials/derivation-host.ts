/**
 * Drives `generate-worker.ts` from the page: one request per material, results
 * handed back as finished map sets (FR-011, US4-S6).
 *
 * This is a best-effort path on purpose. If the environment has no `Worker`, or
 * the worker fails to construct or errors mid-derivation, the host reports the
 * failure and the caller falls back to the stepped ramp — the level is already
 * skinned with the preview set either way, so a missing worker costs sharpness
 * for a few more frames and nothing else.
 */
import type { MaterialMapSet } from '../../materials/maps';
import { recordFallback } from '../../materials/diagnostics';
import type { MaterialName } from '../../materials/table';
import type { DeriveResult } from './generate-worker';

export interface DerivationHandlers {
  /** One material finished, with the milliseconds the worker spent on it. */
  onMaterial(set: MaterialMapSet, ms: number): void;
  /** The worker is unusable; derive on the main thread instead. */
  onUnavailable(reason: string): void;
}

let worker: Worker | null = null;

function rebuildSet(result: DeriveResult): MaterialMapSet {
  return {
    name: result.name,
    size: result.size,
    albedo: result.albedo,
    normal: result.normal,
    roughness: result.roughness,
    height: result.height,
    hasNormal: result.hasNormal,
    hasRoughness: result.hasRoughness,
  };
}

/**
 * Asks the worker for every named material at `size`. Returns false when no
 * worker could be started, in which case `onUnavailable` has already run and
 * nothing was requested.
 */
export function startWorkerDerivation(
  names: readonly MaterialName[],
  size: number,
  handlers: DerivationHandlers,
): boolean {
  if (typeof Worker === 'undefined') {
    handlers.onUnavailable('Worker is not available in this environment');
    return false;
  }

  try {
    worker = new Worker(new URL('./generate-worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    handlers.onUnavailable(error instanceof Error ? error.message : String(error));
    worker = null;
    return false;
  }

  let remaining = names.length;

  worker.onmessage = (event: MessageEvent<DeriveResult>) => {
    const result = event.data;
    // A degradation the worker took is replayed here, or FR-007's record would
    // exist only on a thread nobody reads.
    for (const fallback of result.fallbacks) recordFallback(fallback);
    handlers.onMaterial(rebuildSet(result), result.ms);
    remaining -= 1;
    if (remaining <= 0) stopWorkerDerivation();
  };

  worker.onerror = (event: ErrorEvent) => {
    handlers.onUnavailable(event.message || 'material worker failed');
    stopWorkerDerivation();
  };

  for (const name of names) worker.postMessage({ name, size });
  return true;
}

/** Releases the worker. Idempotent. */
export function stopWorkerDerivation(): void {
  worker?.terminate();
  worker = null;
}
