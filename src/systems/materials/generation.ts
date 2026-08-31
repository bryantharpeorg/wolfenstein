// Where the five materials are generated, and on which thread (US3-S11).
//
// Generating one 512px material costs tens of milliseconds and deriving its
// normal and roughness costs tens more; five of them is roughly a third of a
// second. Spent on the main thread that is a third of a second of animation
// frames, and `__diag.fps` is a trailing window read the moment the loop
// reports ready — so the harness reads the load, not the game, and the branch
// measured 4.6 fps against a floor of 5. Spreading the work one step per frame
// only spreads the same total across the same window.
//
// So it is not spent on the main thread. `src/materials/` imports no three.js
// and touches no DOM — the seam US1 built for `npm run test` is exactly the
// seam a worker needs — so the generating path runs verbatim in a worker and
// the main thread receives finished buffers. What is left for a frame is the
// upload and the attach, which no worker can take.
//
// A platform with no worker is a declared degradation, not a failure: the
// caller is told, generates on the main thread as before, and the smoke check
// reports which thread did the work.

import type { MaterialFallback } from '../../materials/diagnostics';
import type { MaterialMapSet } from '../../materials/maps';

/** One finished material, as it crosses the thread boundary. Every field of
 * `MaterialMapSet` travels — `height` included, so a later story can re-derive
 * from the field its maps were derived from — plus the two numbers only the
 * generating side can know: what generation cost, and what it had to degrade. */
export interface GeneratedMaps extends MaterialMapSet {
  /** `generationStats().generatedMs` as of this material, accumulated (FR-004). */
  readonly generatedMs: number;
  /** FR-007 degradations recorded while building, replayed on the main thread. */
  readonly fallbacks: readonly MaterialFallback[];
}

/** The message the worker waits for; its content is the whole protocol. */
export const GENERATE_REQUEST = 'generate';

export interface GenerationRun {
  /** False where the platform has no worker and the caller must generate itself. */
  readonly offThread: boolean;
  /** Releases the thread; safe to call more than once. */
  stop(): void;
}

/**
 * Starts generating every material on a worker, delivering each as it finishes
 * and releasing the thread after `expected` of them. `onFailure` fires for a
 * worker that cannot be built or that dies partway, and the caller finishes the
 * remaining materials itself.
 */
export function startGeneration(
  expected: number,
  onDelivery: (maps: GeneratedMaps) => void,
  onFailure: () => void,
): GenerationRun {
  const idle: GenerationRun = { offThread: false, stop() {} };
  if (typeof Worker === 'undefined') return idle;

  let worker: Worker;
  try {
    worker = new Worker(new URL('./generation-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return idle;
  }

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
  };

  let delivered = 0;
  worker.onmessage = (event: MessageEvent<GeneratedMaps>) => {
    delivered += 1;
    onDelivery(event.data);
    if (delivered >= expected) stop();
  };
  worker.onerror = (event: ErrorEvent) => {
    // Handled here and not re-thrown: a worker that dies is a degradation the
    // caller absorbs, not a page error the smoke gate should report.
    event.preventDefault();
    stop();
    onFailure();
  };
  worker.postMessage(GENERATE_REQUEST);

  return { offThread: true, stop };
}
