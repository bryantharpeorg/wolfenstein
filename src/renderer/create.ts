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

export interface CreateRendererResult {
  renderer: WebGLRenderer | WebGPURenderer;
  usedBackend: RendererBackend;
  fallbackReason: string | null;
}

function makeParams(canvas: HTMLCanvasElement) {
  return { canvas, antialias: true, alpha: false };
}

function makeFailure(backend: RendererBackend, error: unknown): never {
  const reason = error instanceof Error ? error.message : String(error);
  const failure: RendererFailure = { backend, reason };
  throw failure;
}

export async function createRenderer(
  options: CreateRendererOptions,
): Promise<CreateRendererResult> {
  const canvas = options.canvas;
  const requested = options.backend;

  if (requested === 'webgpu') {
    try {
      const renderer = new WebGPURenderer(makeParams(canvas));
      const usedBackend: RendererBackend = 'webgpu';
      return { renderer, usedBackend, fallbackReason: null };
    } catch (error) {
      try {
        const fallback = new WebGLRenderer(makeParams(canvas));
        return {
          renderer: fallback,
          usedBackend: 'webgl',
          fallbackReason:
            error instanceof Error ? error.message : String(error),
        };
      } catch (fallbackError) {
        makeFailure(
          'webgl',
          `WebGPU failed (${String(error)}); WebGL fallback also failed (${String(fallbackError)})`,
        );
      }
    }
  }

  try {
    const renderer = new WebGLRenderer(makeParams(canvas));
    return { renderer, usedBackend: 'webgl', fallbackReason: null };
  } catch (error) {
    makeFailure('webgl', error);
  }
}
