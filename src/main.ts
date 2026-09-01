/**
 * Bootstrap only. Behaviour lives in `src/systems/<name>/register.ts`.
 *
 * This file used to wire every subsystem by hand, which made it the one file every
 * story had to edit. See `boot/registry.ts` for why that matters. Adding behaviour
 * here is the thing this arrangement exists to prevent: add a system instead.
 */
import { selectBackend } from './renderer/select';
import { createRenderer, isRendererFailure } from './renderer/create';
import { createSceneShell, resizeCamera } from './scene/empty';
import { createDiagnostics } from './diag/diag';
import { installErrorHandlers } from './diag/handlers';
import { collectSystems, type GameContext } from './boot/registry';
import { renderFrame } from './post/render-hook';
import './boot/discover';
import type { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import type WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';

type Renderer = WebGLRenderer | WebGPURenderer;

declare global {
  interface Window {
    __diag: import('./diag/diag').Diagnostics;
    __injectSmokeError?: string;
  }
}

function showFatalMessage(message: string): void {
  document.body.innerHTML = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  paragraph.style.padding = '1rem';
  paragraph.style.color = '#fff';
  paragraph.style.fontFamily = 'sans-serif';
  document.body.appendChild(paragraph);
}

async function makeRenderer(): Promise<{
  renderer: Renderer;
  usedBackend: 'webgpu' | 'webgl';
  fallbackReason: string | null;
}> {
  const backend = selectBackend(navigator, window.location.search);

  const container = document.getElementById('canvas-container');
  if (container == null) {
    throw new Error('Missing canvas-container element');
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  container.appendChild(canvas);

  return createRenderer({ canvas, backend });
}

async function run() {
  const selected = selectBackend(navigator, window.location.search);
  const diag = createDiagnostics(selected);
  installErrorHandlers(diag);
  window.__diag = diag;

  const injectMessage = window.__injectSmokeError;
  if (injectMessage != null) {
    throw new Error(injectMessage);
  }

  let renderer: Renderer;
  let usedBackend: 'webgpu' | 'webgl' = selected;
  try {
    const result = await makeRenderer();
    renderer = result.renderer;
    usedBackend = result.usedBackend;
    diag.renderer = usedBackend;
    diag.fallbackReason = result.fallbackReason;
  } catch (error) {
    if (isRendererFailure(error)) {
      showFatalMessage(`Renderer initialization failed for ${error.backend}: ${error.reason}`);
      diag.renderer = error.backend;
      diag.errors.push(`Failed backend ${error.backend}: ${error.reason}`);
    } else {
      const reason = error instanceof Error ? error.message : String(error);
      showFatalMessage(`Renderer initialization failed: ${reason}`);
      diag.errors.push(reason);
    }
    return;
  }

  const shell = createSceneShell();
  resizeCamera(shell.camera);

  const ctx: GameContext = {
    scene: shell.scene,
    camera: shell.camera,
    diag,
    backend: usedBackend,
    renderer,
  };

  const systems = collectSystems();
  for (const system of systems) {
    system.setup?.(ctx);
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    resizeCamera(shell.camera);
    for (const system of systems) {
      system.resize?.(ctx, width, height);
    }
  }

  window.addEventListener('resize', resize);
  resize();

  // Frame deltas are measured with `performance.now()` at callback entry rather
  // than from the timestamp requestAnimationFrame hands in.
  //
  // The two are the same clock, but the rAF argument is the start time of the
  // browser's frame, and a frame that began *before* a long synchronous load
  // still carries its original start time when its callbacks finally run. 005
  // generates five 512px materials at load — FR-004 budgets up to 1500ms for it
  // — so the first callback arrives with a timestamp from before that work, and
  // the second frame's delta comes out as the whole load: ~466ms measured
  // headlessly, against a 16.7ms steady state. That one bogus sample is handed
  // to every system as `deltaMs`, teleporting the player and every door through
  // half a second of simulation on frame two, and it drags `__diag.fps` — a
  // 60-frame trailing mean the smoke harness reads two frames in — down to 4.
  //
  // Callback entry to callback entry is the interval the systems actually
  // integrate over, and it cannot predate the loop that started them.
  let lastTime = performance.now();

  function frame() {
    const now = performance.now();
    const delta = now - lastTime;
    lastTime = now;

    for (const system of systems) {
      system.update?.(ctx, delta);
    }

    // The frame's one render call, indirected exactly once: a passthrough to
    // `renderer.render` until US4's post chain installs itself (FR-015).
    renderFrame(ctx);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

run();
