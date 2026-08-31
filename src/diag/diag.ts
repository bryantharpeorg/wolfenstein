import type { LevelStats } from '../level-stats';
import type { EnemyDiagnosticsRecord } from '../enemy/world';

export interface Diagnostics {
  ready: boolean;
  renderer: 'webgpu' | 'webgl' | null;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  errors: string[];
  fallbackReason: string | null;
  /** Level facts published by the level-diag system; null until it runs. */
  level: LevelStats | null;
  /** One entry per live guard, published by the enemies system (006 FR-011).
   *  `viewAngle` is written by the enemy-billboards system, which owns bearings. */
  enemies: readonly EnemyDiagnosticsRecord[];
  /** Guards whose state is not `death` (006 FR-011). */
  enemiesAlive: number;
  /** Named spawn-marker faults (006 FR-006, US3-S7). Empty on a sound level.
   *  Deliberately not `errors`: 001 owns that array and its meaning is
   *  "something threw", while a marker on a wall cell is a level fault with
   *  coordinates. `tools/smoke-checks/enemies.mjs` fails the gate on this one. */
  enemySpawnErrors: string[];
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
    level: null,
    enemies: [],
    enemiesAlive: 0,
    enemySpawnErrors: [],
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
