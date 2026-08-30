import { WebGLRenderer } from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { RendererBackend } from './select';

export interface RendererFailure {
  readonly backend: RendererBackend;
  readonly reason: string;
}

export function isRendererFailure(value: unknown): value is RendererFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'backend' in value &&
    'reason' in value &&
    typeof (value as RendererFailure).backend === 'string' &&
    typeof (value as RendererFailure).reason === 'string'
  );
}

export interface CreateRendererOptions {
  canvas: HTMLCanvasElement;
  backend: RendererBackend;
}

function makeParams(canvas: HTMLCanvasElement) {
  return { canvas, antialias: true, alpha: false };
}

export function createRenderer(options: CreateRendererOptions) {
  const canvas = options.canvas;

  try {
    if (options.backend === 'webgpu') {
      return new WebGPURenderer(makeParams(canvas));
    }
    return new WebGLRenderer(makeParams(canvas));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failure: RendererFailure = { backend: options.backend, reason };
    throw failure;
  }
}
