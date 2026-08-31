// T044, T045 (FR-014, FR-015, FR-016; US4-S3, US4-S7, US4-S8, US4-S9): the WebGL half of
// the post chain, and the entry point that picks a half for 001's active backend.
//
// The shape of this file is FR-016. Post-processing is a *different API per backend* --
// here a chain of `EffectComposer` passes, in `node-chain.ts` a graph of nodes fed to
// three's `PostProcessing` -- and not all four effects have a common implementation. That
// is not a defect to paper over: each effect is constructed on its own, inside its own
// guard, and one that cannot be built here is disabled, recorded in
// `__diag.post.fallbacks` with the backend it failed on, and stepped over. The scene and
// the other three still render. An effect that goes wrong must say so; the failure this
// file exists to prevent is a black screen with a healthy frame rate.
//
// Rebuild-on-toggle is deliberate (T045). A toggled-off effect's render targets are
// disposed rather than parked, so a hundred on/off cycles return `renderTargets()` to its
// baseline instead of leaving a hundred framebuffers on the GPU; and with all four off
// the chain reports itself inactive, the caller renders straight to the screen, and
// US4-S5's floor is measured against the game exactly as it was before this story.

import { SRGBColorSpace, UnsignedByteType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { webgpuNodeChain } from './node-chain';
import {
  countRenderTargets,
  describeChainError,
  readDrawCalls,
  type PostChain,
  type PostChainOptions,
  type RendererLike,
} from './chain-support';
import {
  POST_EFFECTS,
  anyPostEffectEnabled,
  disablePostEffect,
  postEffectEnabled,
  type PostEffectId,
} from './state';

/** SSAO's kernel, halved from three's default: the AO this level needs is a seam in a
 *  corner, and 32 taps a frame buys none of it that 16 does not. */
const SSAO_KERNEL_SIZE = 16;

/** Bloom's blur pyramid runs at a quarter of the viewport. What it draws is a glow, which
 *  is low frequency by definition: the eleven blur passes cost a sixteenth of the fill at
 *  quarter resolution and the halo is indistinguishable from the full-resolution one. */
const BLOOM_RESOLUTION_SCALE = 0.25;

/** Ambient occlusion likewise. It is the most expensive of the four by a wide margin --
 *  a normal pass and sixteen depth taps per pixel -- and it is also the lowest frequency:
 *  what it draws is a soft darkening in a corner, which survives being computed at half
 *  the viewport and upsampled on the way back. */
const SSAO_RESOLUTION_SCALE = 0.5;

/**
 * Records the scene's own draw calls at the point in the chain where the scene has been
 * rendered and no effect has run yet. It renders nothing and swaps nothing; it is a
 * bookmark, so that adding eleven bloom passes to the frame does not silently turn 001's
 * "under twenty draw calls" budget into "under twenty full-screen quads".
 */
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

/**
 * SSAO at a fraction of the viewport. `EffectComposer.setSize` hands every pass the full
 * size, so the scaling has to live in the pass rather than at the call site or a resize
 * would quietly put the AO back to full resolution.
 */
class ScaledSSAOPass extends SSAOPass {
  override setSize(width: number, height: number): void {
    super.setSize(
      Math.max(1, Math.round(width * SSAO_RESOLUTION_SCALE)),
      Math.max(1, Math.round(height * SSAO_RESOLUTION_SCALE)),
    );
  }
}

type PassFactory = () => Pass;

function webglChain(options: PostChainOptions): PostChain {
  const { renderer, scene, camera, state, backend } = options;
  const target = renderer as RendererLike;
  let width = options.width;
  let height = options.height;

  let composer: EffectComposer | null = null;
  let probe: DrawCallProbePass | null = null;
  let passes: Pass[] = [];
  let lastSceneDrawCalls = 0;

  const factories: Readonly<Record<PostEffectId, PassFactory>> = {
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

  /** The order the frame is composited in, which is not the order FR-014 names them:
   *  ambient occlusion darkens the scene's own shading, bloom spreads what survives the
   *  threshold, motion blur accumulates the composited frame, and grain goes over all of
   *  it. */
  const APPLY_ORDER: readonly PostEffectId[] = ['ssao', 'bloom', 'motionBlur', 'filmGrain'];

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

    // The chain's intermediate buffer, and the one number in this file with real
    // consequences for what the frame looks like. Three's default is a half-float target:
    // sixteen bits a channel of linear light, which every pass then has to read and write
    // at twice the bandwidth. An 8-bit *sRGB* target instead spends its byte where the eye
    // is -- the hardware encodes on write and decodes on read, so the darks that 8-bit
    // linear would band across keep their precision -- and the whole chain runs at half
    // the fill cost. The scene is low dynamic range to begin with: nothing in it is
    // brighter than white, so the range the half-float target buys is range nothing uses.
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

    // Every pass works in linear light, so the conversion `renderer.render` would have
    // done on the way to the screen has to be done by a pass instead. `composer.dispose()`
    // takes both intermediate targets, which is why `teardown` needs no more than it.
    built.addPass(new OutputPass());

    composer = built;
    probe = bookmark;
    warmUp();
  }

  /**
   * Renders one frame through the freshly built chain, immediately, before the frame loop
   * ever sees it. Two things fall out of that. The shader compilation a chain of a dozen
   * passes costs -- a fifth of a second on a software rasterizer -- is paid at build time
   * rather than as a stall on the first frame the player is watching, and three.js caches
   * the programs, so every later rebuild is cheap. And a chain that cannot render at all
   * says so *here*, where the reason can be recorded and the effects disabled, rather than
   * from inside the frame loop where the only evidence would be a black screen (US4-S3).
   */
  function warmUp(): void {
    if (composer == null) return;
    try {
      composer.render();
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

/**
 * Builds the chain for 001's active backend. A backend whose chain cannot be constructed
 * at all disables every effect, records why, and answers a chain that is never active --
 * so the caller renders straight to the screen and the page is a game without effects
 * rather than a page without a game (FR-016, US4-S7).
 */
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
