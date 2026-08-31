// The post system (order 200): the render edge of US4 (FR-014, FR-015, FR-017, FR-018).
// Every decision lives in `src/post/` -- the four effects and their defaults in
// `state.ts`, the measurement in `cost.ts`, the passes in `chain.ts` -- and this file is
// the wiring: build the chain, bind the four declared keys, forward resizes, keep the
// readouts above the effects, and publish. 001's glob discovery finds it, so neither
// `main.ts` nor `diag.ts` is edited by this story beyond the single render indirection.
//
// Order 200 is last on purpose: the HUD parents its quad to the camera at 90 and the
// stats screen at 95, and this system's `setup` has to find both already there.
//
// **What goes through the chain and what goes over it.** The HUD readout (render order
// 1000) and the stats screen (1100) are composited above the effects: a bloomed,
// grain-covered ammo counter is not a readout, and US4-S10 asks for a legible one. The
// weapon view-model at 900 and its muzzle flash at 901 go *through* the chain, which is
// the whole of US4-S6 -- bloom that did not reach the flash was constructed, not applied.
// The split is one layer: the world renders on layer 0 and the overlays on layer 1, and
// the frame is two renders rather than two scenes.

import { defineSystem, type GameContext } from '../../boot/registry';
import { createPostChain } from '../../post/chain';
import { readDrawCalls, type PostChain } from '../../post/chain-support';
import {
  createPostCostSampler,
  postCostSampleCount,
  postFrameCostMs,
  postPhaseFrameMs,
  recordPostCostSample,
  resetPostCostSampler,
  type PostCostPhase,
  type PostCostSampler,
} from '../../post/cost';
import { ensurePostDiag, type PostDiagnostics } from '../../post/diag';
import { clearFrameRenderer, installFrameRenderer, type FrameRenderContext } from '../../post/render-hook';
import {
  POST_EFFECTS,
  POST_EFFECT_IDS,
  allPostEffectsRequested,
  createPostState,
  disablePostEffect,
  noPostEffectsRequested,
  postEffectForKeyCode,
  postEffectStates,
  setPostEffect,
  togglePostEffect,
  type PostEffectId,
  type PostState,
} from '../../post/state';
import { HUD_RENDER_ORDER } from '../hud/register';

/** The world renders on layer 0 -- three's default, so nothing else has to opt in -- and
 *  the screen-space readouts on layer 1. */
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

/** What the harness reads and drives, in the shape `window.__hud` and `window.__run`
 *  established: a texture cannot be read back, and neither can a shader. */
export interface PostHarness {
  effects(): Record<PostEffectId, boolean>;
  set(id: PostEffectId, on: boolean): boolean;
  toggle(id: PostEffectId): boolean;
  setAll(on: boolean): Record<PostEffectId, boolean>;
  renderTargets(): number;
}

declare global {
  interface Window {
    __post?: PostHarness;
  }
}

/** Anything the camera carries at or above the HUD's render order is a readout and
 *  composites above the chain; anything below it -- the view-model and its flash -- goes
 *  through the chain. Rescanned each frame because it is three objects. */
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
  post.enabledFrameMs = postPhaseFrameMs(sampler, 'enabled');
  post.baselineFrameMs = postPhaseFrameMs(sampler, 'disabled');
  post.costSamples = {
    enabled: postCostSampleCount(sampler, 'enabled'),
    disabled: postCostSampleCount(sampler, 'disabled'),
  };
  post.drawCalls = frameDrawCalls;
  post.renderTargets = chain?.renderTargets() ?? 0;
  post.viewport = chain?.size() ?? post.viewport;
  post.resizes = resizes;
  if (post.fallbacks.length !== state.fallbacks.length) post.fallbacks = [...state.fallbacks];
  // 001's budget is the *scene's* draw calls, and it stays that even with eleven bloom
  // passes in the frame; the frame's whole count is `__diag.post.drawCalls` (US4-S10).
  ctx.diag.drawCalls = sceneDrawCalls;
}

/**
 * One frame: the world through the chain, then the readouts over it. `renderer.info` is
 * driven by hand because a composer calls `renderer.render` once per pass and each call
 * would otherwise reset the counters that 001's draw-call budget is read from.
 */
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
    camera.layers.set(WORLD_LAYER);
    if (chain != null && chain.active()) {
      chain.renderWorld();
      sceneDrawCalls = chain.sceneDrawCalls();
    } else {
      renderer.render(frame.scene, camera);
      sceneDrawCalls = readDrawCalls(renderer);
    }

    if (overlays > 0) {
      camera.layers.set(OVERLAY_LAYER);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget?.(null);
      renderer.render(frame.scene, camera);
      renderer.autoClear = autoClear;
    }

    frameDrawCalls = readDrawCalls(renderer);
  } finally {
    camera.layers.mask = mask;
    if (info != null) info.autoReset = true;
  }
}

/** The hook's last resort: whatever threw is named against every effect that was on, and
 *  the passthrough takes the frame. Dark is not a report; this is (US4-S3). */
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
    effects: () => postEffectStates(state),
    set(id, on) {
      const result = setPostEffect(state, id, on);
      rebuild(ctx);
      return result;
    },
    toggle(id) {
      const result = togglePostEffect(state, id);
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
    // Within this same frame: `main.ts` calls every system's `resize` from the event, and
    // the next `renderFrame` already draws into the resized targets (US4-S9).
    chain?.setSize(width, height);
    // A different viewport is a different frame cost, so the windows measured at the old
    // one are not a baseline for the new one.
    resetPostCostSampler(sampler);
    publish(ctx);
  },
});
