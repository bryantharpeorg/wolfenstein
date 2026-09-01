// What crosses the worker boundary, and what the page does with it.
//
// The height field each map was derived from stays on the far side: it is the
// largest buffer of the set and the renderer has no use for it, so shipping it
// back would be five megabytes of copy for nothing.

import type { MaterialMapSet } from '../../materials/maps';
import type { MaterialUpload } from '../../materials/texture-adapter';
import type { MaterialFallback, MaterialMapReport } from '../../materials/diagnostics';

// Type-only, so the worker that imports this file does not pull three in with it.
export type { MaterialUpload };

/** Everything one derivation pass produces, wherever it ran. */
export interface DerivedMaterials {
  readonly uploads: readonly MaterialUpload[];
  readonly generatedMs: number;
  readonly textureCount: number;
  readonly bytes: number;
  readonly materials: readonly MaterialMapReport[];
  readonly fallbacks: readonly MaterialFallback[];
}

export function toUpload(set: MaterialMapSet): MaterialUpload {
  return {
    name: set.name,
    size: set.size,
    albedo: set.albedo,
    normal: set.normal,
    roughness: set.roughness,
  };
}

/** The buffers a `postMessage` can hand over instead of copying. */
export function transferable(uploads: readonly MaterialUpload[]): ArrayBuffer[] {
  return uploads.flatMap((upload) => [
    upload.albedo.buffer as ArrayBuffer,
    upload.normal.buffer as ArrayBuffer,
    upload.roughness.buffer as ArrayBuffer,
  ]);
}
