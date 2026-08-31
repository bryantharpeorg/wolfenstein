// The vocabulary the two backends share, so neither imports the other. `chain.ts` builds
// the WebGL pass chain and `node-chain.ts` the WebGPU node graph; both answer this one
// `PostChain` interface, and `src/systems/post/register.ts` never learns which it holds.
// It lives in its own file rather than in `chain.ts` because a cycle between two modules
// that each build half of a backend is a worse arrangement than one more small module,
// and `chain.ts` is at the 400-line ceiling either way (Constitution IV).

import type { PerspectiveCamera, Scene } from 'three';
import type { PostBackend, PostState } from './state';

/** What the chain is handed. The renderer is structurally typed so this file imports no
 *  backend-specific renderer class, exactly as `boot/registry.ts` does. */
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
  /** True when there is something to render through. False means render directly. */
  active(): boolean;
  /** Rebuilds the chain to match the state. Called after every toggle. */
  sync(): void;
  /** Renders the world through the chain. Only call it while `active()`. */
  renderWorld(): void;
  setSize(width: number, height: number): void;
  /** The viewport the render targets were last sized to (US4-S9). */
  size(): { width: number; height: number };
  /** Live render targets this chain owns, so a leak is a number and not a suspicion. */
  renderTargets(): number;
  /** Draw calls the *scene* cost, chain passes excluded, so 001's budget keeps its
   *  meaning once a composer is in the way of it (US4-S10). */
  sceneDrawCalls(): number;
  dispose(): void;
}

interface RendererInfoLike {
  autoReset: boolean;
  reset(): void;
  render: Record<string, number | undefined>;
}

export interface RendererLike {
  info?: RendererInfoLike;
  render(scene: Scene, camera: PerspectiveCamera): void;
}

/** WebGL calls it `calls`, WebGPU calls it `drawCalls`; 001's diagnostics system reads
 *  both, and so does this. */
export function readDrawCalls(renderer: object): number {
  const info = (renderer as RendererLike).info;
  if (info == null) return 0;
  return info.render['drawCalls'] ?? info.render['calls'] ?? 0;
}

/** Shared with `node-chain.ts`, so both backends name a failure the same way. */
export function describeChainError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Counts the render targets a pass or a composer owns, including the arrays of them a
 *  blur pyramid keeps. One level deep is enough: no pass in this chain nests further. */
export function countRenderTargets(owner: object): number {
  let count = 0;
  for (const value of Object.values(owner)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry != null && (entry as { isRenderTarget?: boolean }).isRenderTarget === true) count += 1;
      }
    } else if ((value as { isRenderTarget?: boolean }).isRenderTarget === true) {
      count += 1;
    }
  }
  return count;
}
