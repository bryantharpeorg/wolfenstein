// T044 (FR-016; US4-S7, US4-S8): the WebGPU half of the chain, split out of `chain.ts`
// under the 400-line ceiling. Post-processing is a different API per backend and this is
// the other one: on WebGPU there is no list of passes to compose, there is a graph of
// nodes handed to three's `PostProcessing`, and the shared surface between the two is the
// `PostChain` interface in `chain.ts` and nothing else.
//
// SSAO is the effect that does not cross. Three's node ambient occlusion reads the
// scene's view-space normals from a multiple-render-target pass, which is a different
// scene pass from the one the other three effects read, so on this backend SSAO is
// disabled before anything is built, named in `__diag.post.fallbacks` and recorded in
// `DECISIONS.md` (FR-016, US4-S8). Bloom, motion blur and film grain all have node
// equivalents and are built here. The scene renders either way, which is the whole of
// US4-S7.

import PostProcessing from 'three/src/renderers/common/PostProcessing.js';
import { pass } from 'three/src/nodes/display/PassNode.js';
import { bloom } from 'three/src/nodes/display/BloomNode.js';
import { afterImage } from 'three/src/nodes/display/AfterImageNode.js';
import { film } from 'three/src/nodes/display/FilmNode.js';
import {
  POST_EFFECTS,
  anyPostEffectEnabled,
  disablePostEffect,
  postEffectEnabled,
} from './state';
import {
  countRenderTargets,
  describeChainError,
  readDrawCalls,
  type PostChain,
  type PostChainOptions,
  type RendererLike,
} from './chain-support';

/** The node chain, built for the backend `chain.ts` hands it. */
export function webgpuNodeChain(options: PostChainOptions): PostChain {
  const { renderer, scene, camera, state, backend } = options;
  const target = renderer as RendererLike;
  let width = options.width;
  let height = options.height;

  let processing: PostProcessing | null = null;
  let sized: { setSize(width: number, height: number): void }[] = [];
  let lastSceneDrawCalls = 0;

  disablePostEffect(
    state,
    'ssao',
    'webgpu',
    "three's node ambient occlusion needs an MRT normal pass this chain does not build",
  );

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

      const built = new PostProcessing(
        target as ConstructorParameters<typeof PostProcessing>[0],
        output,
      );
      built.needsUpdate = true;
      processing = built;
      for (const node of sized) node.setSize(width, height);
    } catch (error) {
      // A graph that will not build takes the whole chain with it rather than half of
      // it: every effect that was asked for is named, and the scene renders directly.
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
      // The node graph renders the scene inside itself, so there is no point between the
      // scene and the first effect to read a count at: the whole frame is reported.
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
