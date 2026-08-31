// T042 (FR-015; US4-S3): the one indirection in the frame loop. `src/main.ts` calls
// `renderFrame(ctx)`, and until a chain installs itself that call *is* `renderer.render`.
// The guard is load-bearing: US4-S3 says an effect that cannot render must be reported, never
// merely dark, so a renderer that throws is uninstalled, its throw handed to whoever knows how
// to record it, and the passthrough takes that same frame.

import type { PerspectiveCamera, Scene } from 'three';

export interface FrameRenderContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: { render(scene: Scene, camera: PerspectiveCamera): void };
}

export type FrameRenderer = (ctx: FrameRenderContext) => void;

export type FrameRendererFailureHandler = (error: unknown) => void;

let installed: FrameRenderer | null = null;
let onFailure: FrameRendererFailureHandler | null = null;

export function installFrameRenderer(
  renderer: FrameRenderer,
  failureHandler?: FrameRendererFailureHandler,
): void {
  installed = renderer;
  onFailure = failureHandler ?? null;
}

export function clearFrameRenderer(): void {
  installed = null;
  onFailure = null;
}

export function renderDirect(ctx: FrameRenderContext): void {
  ctx.renderer.render(ctx.scene, ctx.camera);
}

export function renderFrame(ctx: FrameRenderContext): void {
  const renderer = installed;
  if (renderer == null) return renderDirect(ctx);
  try {
    renderer(ctx);
  } catch (error) {
    const handler = onFailure;
    clearFrameRenderer();
    handler?.(error);
    renderDirect(ctx);
  }
}
