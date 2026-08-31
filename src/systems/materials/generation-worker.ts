// The worker thread US3-S11 buys its frames with. It imports `src/materials/`
// and nothing else: the generating path is pure by construction (FR-001), so it
// runs here unchanged and no texel differs from the one `npm run test` asserts.
//
// One material is posted the moment it is finished rather than all five at the
// end, so the main thread starts uploading while the next is still being
// generated. The buffers are copied rather than transferred: `generateAlbedo`
// memoizes its albedo and height (FR-004), and transferring would detach the
// memo the next material's derivation might read.

import { materialDiagnostics } from '../../materials/diagnostics';
import { generationStats } from '../../materials/generate';
import { buildMaterialMaps } from '../../materials/maps';
import { MATERIAL_NAMES } from '../../materials/table';
import { GENERATE_REQUEST, type GeneratedMaps } from './generation';

/** The dedicated-worker surface this file uses, declared locally: the shared
 * `tsconfig.json` compiles against the DOM lib, and one worker is no reason to
 * reopen it. */
interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: GeneratedMaps): void;
}

const scope = self as unknown as WorkerScope;

function generateAll(): void {
  for (const name of MATERIAL_NAMES) {
    const set = buildMaterialMaps(name);
    scope.postMessage({
      ...set,
      generatedMs: generationStats().generatedMs,
      // Recorded against this thread's diagnostics, which no page reads; the
      // main thread replays them so a degradation still reaches `__diag`.
      fallbacks: [...materialDiagnostics().fallbacks],
    });
  }
}

scope.onmessage = (event: MessageEvent) => {
  if (event.data !== GENERATE_REQUEST) return;
  generateAll();
};
