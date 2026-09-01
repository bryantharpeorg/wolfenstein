export type RendererBackend = 'webgpu' | 'webgl';

export interface Capabilities {
  gpu?: unknown;
}

// WebGL is the default even where WebGPU is available. Every gate in this
// project runs headless Chromium, which exposes no `navigator.gpu`, so the
// WebGPU path has never drawn a verified frame -- and on real desktop Chrome
// (2026-09-01) it initialises without error and then renders nothing: the
// published site was a black screen for exactly the browsers most players use.
// Until the WebGPU chain renders under a gate that can actually execute it,
// it is opt-in via `?webgpu` in the URL, and still requires the capability.
export function selectBackend(
  capabilities: Capabilities | Navigator,
  search = '',
): RendererBackend {
  const optIn = new URLSearchParams(search).has('webgpu');
  return optIn && (capabilities as Capabilities).gpu != null ? 'webgpu' : 'webgl';
}
