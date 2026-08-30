import { WebGLRenderer } from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeFailure(backend: RendererBackend, error: unknown): never {
  const reason = describeError(error);
  const failure: RendererFailure = { backend, reason };
  throw failure;
}

export async function createRenderer(
  options: CreateRendererOptions,
): Promise<CreateRendererResult> {
  const canvas = options.canvas;
  const requested = options.backend;

  if (requested === 'webgpu') {
    // If the adapter cannot be obtained, fall back to WebGL before constructing the
    // WebGPU renderer so the page reports the fallback cleanly rather than logging a
    // warning and rendering through a hidden WebGL backend.
    if (!WebGPU.isAvailable()) {
      const reason = 'WebGPU adapter request failed';
      try {
        const renderer = new WebGLRenderer(makeParams(canvas));
        return { renderer, usedBackend: 'webgl', fallbackReason: reason };
      } catch (fallbackError) {
        makeFailure(
          'webgl',
          `${reason}; WebGL fallback also failed: ${describeError(fallbackError)}`,
        );
      }
    }

    try {
      const renderer = new WebGPURenderer(makeParams(canvas));
      await renderer.init();
      return { renderer, usedBackend: 'webgpu', fallbackReason: null };
    } catch (error) {
      const reason = describeError(error);
      try {
        const fallback = new WebGLRenderer(makeParams(canvas));
        return { renderer: fallback, usedBackend: 'webgl', fallbackReason: reason };
      } catch (fallbackError) {
        makeFailure(
          'webgl',
          `WebGPU failed (${reason}); WebGL fallback also failed: ${describeError(fallbackError)}`,
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
