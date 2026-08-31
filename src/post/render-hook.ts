// T042 (FR-015; US4-S3): the one indirection in the frame loop. `src/main.ts` calls
// `renderFrame(ctx)` instead of `renderer.render(scene, camera)`, and until a chain
// installs itself that call *is* `renderer.render(scene, camera)` -- so installing
// post-processing is adding a system, not editing the bootstrap, and a build with no post
// system at all renders exactly as it did before this story.
//
// The guard is the load-bearing part. US4-S3 says an effect that cannot render must be
// reported, never merely dark: if an installed renderer throws -- a shader that would not
// compile, a render target the driver refused -- the hook uninstalls it, hands the throw
// to the failure handler that knows how to record it, and renders the passthrough for
// that same frame. The screen never goes black waiting for someone to notice.
//
// No three.js import and no DOM: the renderer is structurally typed to the one method
// this file calls, exactly as `boot/registry.ts` types it.

import type { PerspectiveCamera, Scene } from 'three';

export interface FrameRenderContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: { render(scene: Scene, camera: PerspectiveCamera): void };
}

export type FrameRenderer = (ctx: FrameRenderContext) => void;

/** Told what threw and handed the chance to record it before the passthrough resumes. */
export type FrameRendererFailureHandler = (error: unknown) => void;

let installed: FrameRenderer | null = null;
let onFailure: FrameRendererFailureHandler | null = null;

/** Installs the frame's renderer. The last caller wins; there is one frame loop. */
export function installFrameRenderer(
  renderer: FrameRenderer,
  failureHandler?: FrameRendererFailureHandler,
): void {
  installed = renderer;
  onFailure = failureHandler ?? null;
}

/** Returns the loop to the passthrough. Safe to call when nothing is installed. */
export function clearFrameRenderer(): void {
  installed = null;
  onFailure = null;
}

export function hasFrameRenderer(): boolean {
  return installed != null;
}

/** The passthrough, named so a chain can fall back to it explicitly. */
export function renderDirect(ctx: FrameRenderContext): void {
  ctx.renderer.render(ctx.scene, ctx.camera);
}

/**
 * Renders one frame: through the installed renderer if there is one, directly if there
 * is not, and directly again if the installed one threw.
 */
export function renderFrame(ctx: FrameRenderContext): void {
  const renderer = installed;
  if (renderer == null) {
    renderDirect(ctx);
    return;
  }

  try {
    renderer(ctx);
  } catch (error) {
    const handler = onFailure;
    clearFrameRenderer();
    handler?.(error);
    renderDirect(ctx);
  }
}
