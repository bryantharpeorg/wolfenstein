import { selectBackend } from './renderer/select';
import { createRenderer, isRendererFailure } from './renderer/create';
import { buildEmptyScene, resizeCamera } from './scene/empty';
import { createDiagnostics, updateFps } from './diag/diag';
import { installErrorHandlers } from './diag/handlers';
import { createPerfOverlay, installToggle } from './overlay/perf';
import type { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import type WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';

type Renderer = WebGLRenderer | WebGPURenderer;

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
  const backend = selectBackend(navigator);

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
  const selected = selectBackend(navigator);
  const diag = createDiagnostics(selected);
  window.__diag = diag;
  installErrorHandlers(() => window.__diag);

  const overlay = createPerfOverlay();
  installToggle(overlay);

  let renderer: Renderer;
  let usedBackend = selected;
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

  const empty = buildEmptyScene();
  resizeCamera(empty.camera);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    resizeCamera(empty.camera);
  }

  window.addEventListener('resize', resize);
  resize();

  let lastTime = performance.now();

  function frame(now: number) {
    const delta = now - lastTime;
    lastTime = now;

    const cube = empty.meshes[0]!;
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;

    renderer.render(empty.scene, empty.camera);

    diag.drawCalls =
      'drawCalls' in renderer.info.render
        ? (renderer.info.render as { drawCalls: number }).drawCalls
        : renderer.info.render.calls;
    updateFps(diag, delta);
    overlay.update(diag);
    diag.ready = true;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

run();

declare global {
  interface Window {
    __diag: import('./diag/diag').Diagnostics;
  }
}
