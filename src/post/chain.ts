// T044, T045 (FR-014, FR-015, FR-016; US4-S3, US4-S7, US4-S8, US4-S9): both halves of the
// chain — `EffectComposer` passes on WebGL, a node graph handed to three's `PostProcessing` on
// WebGPU — and the entry point that picks one for 001's active backend.
//
// The shape of this file is FR-016: post-processing is a different API per backend and not all
// four effects cross, so each is constructed inside its own guard, and one that cannot be built
// here is disabled, recorded in `__diag.post.fallbacks` with the backend it failed on, and
// stepped over while the scene and the other three still render. Rebuild-on-toggle is
// deliberate (T045) — a toggled-off effect's targets are disposed rather than parked.

import { SRGBColorSpace, UnsignedByteType, Vector2, WebGLRenderTarget } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import PostProcessing from 'three/src/renderers/common/PostProcessing.js';
import { pass } from 'three/src/nodes/display/PassNode.js';
import { bloom } from 'three/src/nodes/display/BloomNode.js';
import { afterImage } from 'three/src/nodes/display/AfterImageNode.js';
import { film } from 'three/src/nodes/display/FilmNode.js';
import {
  POST_EFFECTS, anyPostEffectEnabled, disablePostEffect, postEffectEnabled, type PostBackend,
  type PostEffectId, type PostState
} from './state';

export interface PostChainOptions {
  readonly renderer: object;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly backend: PostBackend;
  readonly state: PostState;
  readonly width: number;
  readonly height: number;
}

export interface PostChain {
  readonly backend: PostBackend;
  active(): boolean;
  sync(): void;
  renderWorld(): void;
  setSize(width: number, height: number): void;
  size(): { width: number; height: number };
  renderTargets(): number;
  /** Draw calls the *scene* cost, chain passes excluded, so 001's budget keeps its meaning
   *  with a composer in the way (US4-S10). */
  sceneDrawCalls(): number;
  dispose(): void;
}

export interface RendererLike {
  info?: { autoReset: boolean; reset(): void; render: Record<string, number | undefined> };
  render(scene: Scene, camera: PerspectiveCamera): void;
}

export function readDrawCalls(renderer: object): number {
  const info = (renderer as RendererLike).info;
  return info == null ? 0 : info.render['drawCalls'] ?? info.render['calls'] ?? 0;
}

export function describeChainError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function countRenderTargets(owner: object): number {
  const isTarget = (value: unknown): boolean =>
    value != null && (value as { isRenderTarget?: boolean }).isRenderTarget === true;
  let count = 0;
  for (const value of Object.values(owner)) {
    if (Array.isArray(value)) count += value.filter(isTarget).length;
    else if (isTarget(value)) count += 1;
  }
  return count;
}

// AO's kernel halved from three's default; both effects are low frequency, so a fraction of
// the viewport costs the eye nothing.
const SSAO_KERNEL_SIZE = 16;
const BLOOM_RESOLUTION_SCALE = 0.25;
const SSAO_RESOLUTION_SCALE = 0.5;

/** Bookmarks the scene's own draw calls, after the scene and before any effect. It draws
 *  nothing and swaps nothing, so 001's "under twenty draw calls" does not silently become
 *  "under twenty full-screen quads" (US4-S10). */
class DrawCallProbePass extends Pass {
  calls = 0;

  constructor(private readonly source: object) {
    super();
    this.needsSwap = false;
  }

  override render(): void {
    this.calls = readDrawCalls(this.source);
  }
}

class ScaledSSAOPass extends SSAOPass {
  override setSize(width: number, height: number): void {
    super.setSize(
      Math.max(1, Math.round(width * SSAO_RESOLUTION_SCALE)),
      Math.max(1, Math.round(height * SSAO_RESOLUTION_SCALE)),
    );
  }
}

/** Composited in this order, not the order FR-014 names them: AO darkens the scene's shading,
 *  bloom spreads what survives the threshold, motion blur accumulates, grain goes over all. */
const APPLY_ORDER: readonly PostEffectId[] = ['ssao', 'bloom', 'motionBlur', 'filmGrain'];

function webglChain(options: PostChainOptions): PostChain {
  const { renderer, scene, camera, state, backend } = options;
  const target = renderer as RendererLike;
  let width = options.width;
  let height = options.height;

  let composer: EffectComposer | null = null;
  let probe: DrawCallProbePass | null = null;
  let passes: Pass[] = [];
  let lastSceneDrawCalls = 0;

  const factories: Readonly<Record<PostEffectId, () => Pass>> = {
    ssao: () => {
      const tuning = POST_EFFECTS.ssao.tuning;
      const ssao = new ScaledSSAOPass(scene, camera, width, height, SSAO_KERNEL_SIZE);
      ssao.kernelRadius = tuning.radius;
      ssao.minDistance = tuning.minDistance;
      ssao.maxDistance = tuning.maxDistance;
      return ssao;
    },
    bloom: () => {
      const tuning = POST_EFFECTS.bloom.tuning;
      const resolution = new Vector2(
        Math.max(1, Math.round(width * BLOOM_RESOLUTION_SCALE)),
        Math.max(1, Math.round(height * BLOOM_RESOLUTION_SCALE)),
      );
      return new UnrealBloomPass(resolution, tuning.strength, tuning.radius, tuning.threshold);
    },
    motionBlur: () => new AfterimagePass(POST_EFFECTS.motionBlur.tuning.damp),
    filmGrain: () => new FilmPass(POST_EFFECTS.filmGrain.tuning.intensity),
  };

  function teardown(): void {
    for (const built of passes) (built as { dispose?: () => void }).dispose?.();
    passes = [];
    probe = null;
    composer?.dispose();
    composer = null;
  }

  function build(): void {
    teardown();
    if (!anyPostEffectEnabled(state)) return;

    // An 8-bit sRGB intermediate rather than three's half-float default (see `DECISIONS.md`).
    const buffer = new WebGLRenderTarget(width, height, {
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
    });
    const built = new EffectComposer(target as ConstructorParameters<typeof EffectComposer>[0], buffer);
    built.setSize(width, height);
    built.addPass(new RenderPass(scene, camera));
    const bookmark = new DrawCallProbePass(renderer);
    built.addPass(bookmark);

    for (const id of APPLY_ORDER) {
      if (!postEffectEnabled(state, id)) continue;
      try {
        const effect = factories[id]();
        effect.setSize?.(width, height);
        built.addPass(effect);
        passes.push(effect);
      } catch (error) {
        // One effect that will not build is one effect disabled, named and stepped over.
        disablePostEffect(state, id, backend, describeChainError(error));
      }
    }

    // Every pass works in linear light, so the conversion `renderer.render` would have done
    // on the way to the screen is done by a pass instead.
    built.addPass(new OutputPass());

    composer = built;
    probe = bookmark;

    // One frame immediately: shader compilation is paid at build time, and a chain that cannot
    // render says so *here*, where the reason can be recorded, not as a black screen (US4-S3).
    try {
      built.render();
    } catch (error) {
      const reason = describeChainError(error);
      for (const id of APPLY_ORDER) {
        if (postEffectEnabled(state, id)) disablePostEffect(state, id, backend, reason);
      }
      teardown();
    }
  }

  build();

  return {
    backend,
    active: () => composer != null,
    sync: build,
    renderWorld(): void {
      if (composer == null) {
        target.render(scene, camera);
        lastSceneDrawCalls = readDrawCalls(renderer);
        return;
      }
      composer.render();
      lastSceneDrawCalls = probe?.calls ?? 0;
    },
    setSize(nextWidth: number, nextHeight: number): void {
      width = Math.max(1, Math.floor(nextWidth));
      height = Math.max(1, Math.floor(nextHeight));
      composer?.setSize(width, height);
      for (const built of passes) built.setSize?.(width, height);
    },
    size: () => ({ width, height }),
    renderTargets(): number {
      if (composer == null) return 0;
      let count = countRenderTargets(composer);
      for (const built of passes) count += countRenderTargets(built);
      return count;
    },
    sceneDrawCalls: () => lastSceneDrawCalls,
    dispose: teardown,
  };
}

// The WebGPU half. SSAO is the effect that does not cross: three's node ambient occlusion reads
// view-space normals from a multiple-render-target pass, so here it is disabled before anything
// is built, named in `__diag.post.fallbacks` and in `DECISIONS.md` (FR-016, US4-S8). The scene
// renders either way, which is the whole of US4-S7.
function webgpuNodeChain(options: PostChainOptions): PostChain {
  const { renderer, scene, camera, state, backend } = options;
  const target = renderer as RendererLike;
  let width = options.width;
  let height = options.height;

  let processing: PostProcessing | null = null;
  let sized: { setSize(width: number, height: number): void }[] = [];
  let lastSceneDrawCalls = 0;

  disablePostEffect(state, 'ssao', 'webgpu',
    "three's node ambient occlusion needs an MRT normal pass this chain does not build");

  function teardown(): void {
    processing = null;
    sized = [];
  }

  function build(): void {
    teardown();
    if (!anyPostEffectEnabled(state)) return;

    try {
      const scenePass = pass(scene, camera);
      let output: ReturnType<typeof pass> | ReturnType<typeof film> = scenePass;

      if (postEffectEnabled(state, 'motionBlur')) {
        const trail = afterImage(scenePass, POST_EFFECTS.motionBlur.tuning.damp);
        sized.push(trail);
        output = trail as unknown as typeof output;
      }
      if (postEffectEnabled(state, 'bloom')) {
        const tuning = POST_EFFECTS.bloom.tuning;
        const glow = bloom(output, tuning.strength, tuning.radius, tuning.threshold);
        sized.push(glow);
        output = output.add(glow) as unknown as typeof output;
      }
      if (postEffectEnabled(state, 'filmGrain')) {
        output = film(output, POST_EFFECTS.filmGrain.tuning.intensity) as unknown as typeof output;
      }

      const built = new PostProcessing(target as ConstructorParameters<typeof PostProcessing>[0], output);
      built.needsUpdate = true;
      processing = built;
      for (const node of sized) node.setSize(width, height);
    } catch (error) {
      // A graph that will not build takes the whole chain: every effect asked for is named.
      const reason = describeChainError(error);
      for (const id of ['bloom', 'motionBlur', 'filmGrain'] as const) {
        if (postEffectEnabled(state, id)) disablePostEffect(state, id, backend, reason);
      }
      teardown();
    }
  }

  build();

  return {
    backend,
    active: () => processing != null,
    sync: build,
    renderWorld(): void {
      if (processing == null) target.render(scene, camera);
      else processing.render();
      lastSceneDrawCalls = readDrawCalls(renderer);
    },
    setSize(nextWidth: number, nextHeight: number): void {
      width = Math.max(1, Math.floor(nextWidth));
      height = Math.max(1, Math.floor(nextHeight));
      for (const node of sized) node.setSize(width, height);
    },
    size: () => ({ width, height }),
    renderTargets(): number {
      let count = 0;
      for (const node of sized) count += countRenderTargets(node);
      return count;
    },
    sceneDrawCalls: () => lastSceneDrawCalls,
    dispose: teardown,
  };
}

/** For 001's active backend. One that cannot be constructed at all disables every effect,
 *  records why, and is never active — a game without effects, not a page without a game
 *  (FR-016, US4-S7). */
export function createPostChain(options: PostChainOptions): PostChain {
  try {
    return options.backend === 'webgpu' ? webgpuNodeChain(options) : webglChain(options);
  } catch (error) {
    const reason = describeChainError(error);
    for (const id of Object.keys(POST_EFFECTS) as PostEffectId[]) {
      disablePostEffect(options.state, id, options.backend, reason);
    }
    return {
      backend: options.backend,
      active: () => false,
      sync: () => {},
      renderWorld: () => (options.renderer as RendererLike).render(options.scene, options.camera),
      setSize: () => {},
      size: () => ({ width: options.width, height: options.height }),
      renderTargets: () => 0,
      sceneDrawCalls: () => readDrawCalls(options.renderer),
      dispose: () => {},
    };
  }
}
