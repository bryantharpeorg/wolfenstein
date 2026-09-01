// Map derivation, off the animation frame (T040, FR-011, US4-S6).
//
// Five materials at the declared size is real arithmetic — noise fields, a
// central-difference normal per texel, a roughness pass — and the page owes the
// render loop every frame it has. So it happens here, on a thread that owes the
// render loop nothing, and the finished buffers are transferred rather than
// copied. Nothing in this file touches three or the DOM; it imports the same
// pure modules `npm run test` does.

import { buildAllMaterialMaps } from '../../materials/maps';
import { materialDiagnostics } from '../../materials/diagnostics';
import { toUpload, transferable, type DerivedMaterials } from './upload';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = () => {
  const sets = buildAllMaterialMaps();
  const record = materialDiagnostics();
  const uploads = Object.values(sets).map(toUpload);
  const derived: DerivedMaterials = {
    uploads,
    generatedMs: record.generatedMs,
    textureCount: record.textureCount,
    bytes: record.bytes,
    materials: record.materials,
    fallbacks: record.fallbacks,
  };
  scope.postMessage(derived, transferable(uploads));
};
