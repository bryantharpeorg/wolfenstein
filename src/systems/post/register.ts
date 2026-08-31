// T047: the render edge of US4 (FR-014, FR-015, FR-017, FR-018) — build the chain, bind the four
// declared keys, forward resizes, keep the readouts above the effects, publish. 001's glob
// discovery finds it, so no shared file is edited beyond the render indirection; order 200 is
// last so `setup` finds the HUD (90) and the stats screen (95) already there. The HUD and the
// stats screen composite *above* the effects, because a grain-covered ammo counter is not a
// readout (US4-S10); the view-model and its muzzle flash go *through*, which is the whole of
// US4-S6 — one layer, so a composited frame is two renders of one scene rather than two
// scenes, and a frame with the chain idle is the single render it always was.

import { defineSystem, type GameContext } from '../../boot/registry';
import { createPostChain, readDrawCalls, type PostChain } from '../../post/chain';
import {
  createPostCostSampler, postCostSampleCount, postFrameCostMs,
  recordPostCostSample, resetPostCostSampler, type PostCostPhase, type PostCostSampler
} from '../../post/cost';
import { ensurePostDiag, type PostDiagnostics } from '../../post/diag';
import {
  clearFrameRenderer, installFrameRenderer, type FrameRenderContext
} from '../../post/render-hook';
import {
  POST_EFFECTS, POST_EFFECT_IDS, allPostEffectsRequested, createPostState, disablePostEffect,
  noPostEffectsRequested, postEffectForKeyCode, postEffectStates, setPostEffect, togglePostEffect,
  type PostEffectId, type PostState
} from '../../post/state';
import { HUD_RENDER_ORDER } from '../hud/register';

// The world on layer 0 — three's default, so nothing else opts in — readouts on layer 1.
const WORLD_LAYER = 0;
const OVERLAY_LAYER = 1;

interface RendererLike {
  autoClear: boolean;
  info?: { autoReset: boolean; reset(): void };
  setRenderTarget?: (target: null) => void;
  render(scene: FrameRenderContext['scene'], camera: FrameRenderContext['camera']): void;
}

let state: PostState = createPostState();
let chain: PostChain | null = null;
let post: PostDiagnostics | null = null;
let sampler: PostCostSampler = createPostCostSampler();
let overlays = 0;
let sceneDrawCalls = 0;
let frameDrawCalls = 0;
let resizes = 0;

/** What the harness drives, in the shape `window.__hud` established: a shader cannot be read
 *  back, so the states it sets are read from `__diag.post`. */
export interface PostHarness {
  set(id: PostEffectId, on: boolean): boolean;
  setAll(on: boolean): Record<PostEffectId, boolean>;
  renderTargets(): number;
}

declare global {
  interface Window {
    __post?: PostHarness;
  }
}

/** At or above the HUD's order is a readout, composited above the chain; below goes through. */
function assignOverlayLayers(ctx: GameContext): void {
  let found = 0;
  for (const child of ctx.camera.children) {
    if (child.renderOrder < HUD_RENDER_ORDER) continue;
    found += 1;
    if (!child.layers.isEnabled(OVERLAY_LAYER)) child.layers.set(OVERLAY_LAYER);
  }
  overlays = found;
}

function rebuild(ctx: GameContext): void {
  chain?.sync();
  publish(ctx);
}

function phaseOf(): PostCostPhase | null {
  if (allPostEffectsRequested(state)) return 'enabled';
  if (noPostEffectsRequested(state)) return 'disabled';
  return null;
}

function publish(ctx: GameContext): void {
  if (post == null) return;
  post.backend = ctx.backend;
  post.effects = postEffectStates(state);
  post.active = chain?.active() ?? false;
  post.frameCostMs = postFrameCostMs(sampler);
  post.costSamples = {
    enabled: postCostSampleCount(sampler, 'enabled'),
    disabled: postCostSampleCount(sampler, 'disabled'),
  };
  post.drawCalls = frameDrawCalls;
  post.renderTargets = chain?.renderTargets() ?? 0;
  post.viewport = chain?.size() ?? post.viewport;
  post.resizes = resizes;
  if (post.fallbacks.length !== state.fallbacks.length) post.fallbacks = [...state.fallbacks];
  // 001's budget is what the *game* draws — the world plus the readouts over it — and stays
  // that with eleven bloom passes in the frame. The whole count is `post.drawCalls` (US4-S10).
  ctx.diag.drawCalls = sceneDrawCalls;
}

/** One frame: the world through the chain, then the readouts over it. `renderer.info` is driven
 *  by hand because a composer calls `renderer.render` once per pass, and each call would
 *  otherwise reset the counters 001's budget is read from. */
function renderPostFrame(frame: FrameRenderContext): void {
  const renderer = frame.renderer as unknown as RendererLike;
  const camera = frame.camera;
  const mask = camera.layers.mask;
  const info = renderer.info;

  if (info != null) {
    info.autoReset = false;
    info.reset();
  }

  try {
    // With no chain in the way there is nothing to composite *over*, so the frame is one render
    // of every layer — exactly the frame 007 drew, at exactly the cost 007 paid. Splitting it in
    // two whatever the chain is doing would make the page with all four effects off slower than
    // the page before this spec, which is the one thing FR-017 does not allow (US4-S5).
    if (chain == null || !chain.active()) {
      camera.layers.set(WORLD_LAYER);
      if (overlays > 0) camera.layers.enable(OVERLAY_LAYER);
      renderer.render(frame.scene, camera);
      sceneDrawCalls = readDrawCalls(renderer);
      frameDrawCalls = sceneDrawCalls;
      return;
    }

    camera.layers.set(WORLD_LAYER);
    chain.renderWorld();
    sceneDrawCalls = chain.sceneDrawCalls();

    if (overlays > 0) {
      const before = readDrawCalls(renderer);
      camera.layers.set(OVERLAY_LAYER);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget?.(null);
      renderer.render(frame.scene, camera);
      renderer.autoClear = autoClear;
      // The readouts were inside 001's budget before the chain existed and stay inside it.
      sceneDrawCalls += readDrawCalls(renderer) - before;
    }

    frameDrawCalls = readDrawCalls(renderer);
  } finally {
    camera.layers.mask = mask;
    if (info != null) info.autoReset = true;
  }
}

/** The hook's last resort: whatever threw is named against every effect that was on, and the
 *  passthrough takes the frame — dark is not a report, this is (US4-S3). */
function onRenderFailure(ctx: GameContext, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  for (const id of POST_EFFECT_IDS) disablePostEffect(state, id, ctx.backend, reason);
  chain?.dispose();
  chain = null;
  publish(ctx);
}

function bindToggles(ctx: GameContext): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat) return;
    const id = postEffectForKeyCode(event.code);
    if (id == null) return;
    togglePostEffect(state, id);
    rebuild(ctx);
  });
}

function installHarness(ctx: GameContext): void {
  window.__post = {
    set(id, on) {
      const result = setPostEffect(state, id, on);
      rebuild(ctx);
      return result;
    },
    setAll(on) {
      for (const id of POST_EFFECT_IDS) setPostEffect(state, id, on);
      rebuild(ctx);
      return postEffectStates(state);
    },
    renderTargets: () => chain?.renderTargets() ?? 0,
  };
}

defineSystem({
  name: 'post',
  order: 200,

  setup(ctx) {
    state = createPostState();
    sampler = createPostCostSampler();
    resizes = 0;
    post = ensurePostDiag(ctx.diag, ctx.backend);
    post.defaults = Object.fromEntries(
      POST_EFFECT_IDS.map((id) => [id, POST_EFFECTS[id].enabledByDefault]),
    ) as Record<PostEffectId, boolean>;

    assignOverlayLayers(ctx);

    chain = createPostChain({
      renderer: ctx.renderer,
      scene: ctx.scene,
      camera: ctx.camera,
      backend: ctx.backend,
      state,
      width: window.innerWidth,
      height: window.innerHeight,
    });

    installFrameRenderer(renderPostFrame, (error) => {
      clearFrameRenderer();
      onRenderFailure(ctx, error);
    });

    bindToggles(ctx);
    installHarness(ctx);
    publish(ctx);
  },

  update(ctx, deltaMs) {
    assignOverlayLayers(ctx);
    recordPostCostSample(sampler, phaseOf(), deltaMs);
    publish(ctx);
  },

  resize(ctx, width, height) {
    resizes += 1;
    // Within this same frame: `main.ts` calls every system's `resize` from the event, so the
    // next `renderFrame` already draws into resized targets (US4-S9). A different viewport is
    // a different frame cost, so the old windows are not a baseline for it.
    chain?.setSize(width, height);
    resetPostCostSampler(sampler);
    publish(ctx);
  },
});
