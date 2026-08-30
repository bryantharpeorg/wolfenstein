/// <reference types="vite/client" />

import type { Diagnostics } from '../diag/diag';

export const OVERLAY_TOGGLE_KEY = 'F1';

export interface PerfOverlay {
  element: HTMLElement;
  visible: boolean;
  toggle(): void;
  update(diag: Diagnostics): void;
}

export function createPerfOverlay(): PerfOverlay {
  const element = document.createElement('div');
  element.id = 'perf-overlay';
  element.style.position = 'fixed';
  element.style.top = '0.5rem';
  element.style.left = '0.5rem';
  element.style.padding = '0.4rem 0.6rem';
  element.style.fontFamily = 'monospace';
  element.style.fontSize = '12px';
  element.style.color = '#0f0';
  element.style.background = 'rgba(0, 0, 0, 0.6)';
  element.style.pointerEvents = 'none';
  element.style.zIndex = '1000';
  element.style.whiteSpace = 'pre';

  const isDev = import.meta.env.DEV === true;
  const visible = isDev;
  element.style.display = visible ? 'block' : 'none';

  const overlay: PerfOverlay = {
    element,
    visible,
    toggle() {
      overlay.visible = !overlay.visible;
      element.style.display = overlay.visible ? 'block' : 'none';
    },
    update(diag) {
      const fps = diag.fps.toFixed(1);
      const frameTime = diag.frameTimeMs.toFixed(2);
      const renderer = diag.renderer ?? 'unknown';
      element.textContent = `backend: ${renderer}\nfps: ${fps}\nframetime: ${frameTime}ms\ndraws: ${diag.drawCalls}`;
    },
  };

  document.body.appendChild(element);
  return overlay;
}

export function installToggle(overlay: PerfOverlay, key = OVERLAY_TOGGLE_KEY): void {
  window.addEventListener('keydown', (event) => {
    if (event.key === key) {
      overlay.toggle();
    }
  });
}
