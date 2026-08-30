export type RendererBackend = 'webgpu' | 'webgl';

export interface Capabilities {
  gpu?: unknown;
}

export function selectBackend(capabilities: Capabilities): RendererBackend {
  return capabilities.gpu != null ? 'webgpu' : 'webgl';
}
