export interface Diagnostics {
  ready: boolean;
  renderer: 'webgpu' | 'webgl' | null;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  errors: string[];
  fallbackReason: string | null;
}

export function createDiagnostics(renderer: 'webgpu' | 'webgl' | null = null): Diagnostics {
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
  if (deltaMs > 0) {
    const instant = 1000 / deltaMs;
    const weight = 1 / FPS_WINDOW_FRAMES;
    diag.fps = diag.fps * (1 - weight) + instant * weight;
    diag.frameTimeMs = deltaMs;
  }
}
