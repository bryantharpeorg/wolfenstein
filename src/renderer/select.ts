export type RendererBackend = 'webgpu' | 'webgl';

export interface Capabilities {
  gpu?: unknown;
}

export function selectBackend(capabilities: Capabilities | Navigator): RendererBackend {
  return (capabilities as Capabilities).gpu != null ? 'webgpu' : 'webgl';
}
