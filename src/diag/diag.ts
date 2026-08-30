export interface Diagnostics {
  ready: boolean;
  renderer: 'webgpu' | 'webgl' | null;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  errors: string[];
  fallbackReason: string | null;
}

interface FrameSamples {
  /** Circular buffer of the last N frame deltas in milliseconds. */
  times: number[];
  /** Write position in the circular buffer. */
  index: number;
  /** Number of valid samples currently in the buffer (1..FPS_WINDOW_FRAMES). */
  count: number;
}

const FPS_WINDOW_FRAMES = 60;

const samples = new WeakMap<Diagnostics, FrameSamples>();

function getSamples(diag: Diagnostics): FrameSamples {
  let state = samples.get(diag);
  if (state == null) {
    state = { times: new Array(FPS_WINDOW_FRAMES).fill(0), index: 0, count: 0 };
    samples.set(diag, state);
  }
  return state;
}

export function createDiagnostics(renderer: 'webgpu' | 'webgl' = 'webgl'): Diagnostics {
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

/**
 * Records the completion of one frame. Updates the trailing FPS window and marks
 * the diagnostics object as ready after the first frame.
 */
export function recordFrame(diag: Diagnostics, deltaMs: number): void {
  diag.frameTimeMs = deltaMs;

  if (deltaMs <= 0) {
    diag.ready = true;
    return;
  }

  const state = getSamples(diag);
  state.times[state.index] = deltaMs;
  state.index = (state.index + 1) % FPS_WINDOW_FRAMES;
  state.count = Math.min(state.count + 1, FPS_WINDOW_FRAMES);

  const totalMs = state.times.slice(0, state.count).reduce((sum, value) => sum + value, 0);
  diag.fps = (state.count / totalMs) * 1000;
  diag.ready = true;
}
