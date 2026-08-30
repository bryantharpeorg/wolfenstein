export type RendererBackend = 'webgpu' | 'webgl';

export interface Diagnostics {
  ready: boolean;
  renderer: RendererBackend | null;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  errors: string[];
  fallbackReason: string | null;
}

export function createDiagnostics(renderer: RendererBackend | null = null): Diagnostics {
  return {
    ready: false,
    renderer,
    fps: 0,
    frameTimeMs: 0,
    drawCalls: 0,
    errors: [],
    fallbackReason: null,
  };
}

const FPS_WINDOW_FRAMES = 60;

export function updateFps(diag: Diagnostics, deltaMs: number): void {
  if (deltaMs <= 0) {
    diag.frameTimeMs = 0;
    return;
  }

  diag.frameTimeMs = deltaMs;

  if (diag.frameTimeSamples == null) {
    diag.frameTimeSamples = [];
  }

  const samples = diag.frameTimeSamples;
  samples.push(deltaMs);
  if (samples.length > FPS_WINDOW_FRAMES) {
    samples.shift();
  }

  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  diag.fps = 1000 / average;
}

/**
 * Internal mutable state used only by {@link updateFps}. It is attached to the
 * diagnostics object so the rest of the application does not need to manage it.
 */
declare module './diag' {
  interface Diagnostics {
    frameTimeSamples?: number[];
  }
}
