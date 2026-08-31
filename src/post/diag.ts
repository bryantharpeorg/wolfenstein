// T046 (FR-018; US4-S1, US4-S4, US4-S8): the `__diag.post` shape, attached to 001's
// `Diagnostics` by module augmentation from this file rather than by editing the shared module
// — the seam `run/diag.ts` and `audio/diag.ts` use. Additive over 001-007, and deliberately
// reportable while dark: "off because it was toggled off" (`effects`) is separate from "off
// because it could not be built here" (`fallbacks`).

import type { Diagnostics } from '../diag/diag';
import { POST_EFFECTS, mapPostEffects, type PostBackend, type PostEffectId } from './state';

export interface PostDiagnostics {
  backend: PostBackend;
  effects: Record<PostEffectId, boolean>;
  defaults: Record<PostEffectId, boolean>;
  active: boolean;
  /** The cost against the all-disabled baseline; null until both 120-frame windows have been
   *  measured, so it is a measurement and not a field that happens to hold a number
   *  (FR-017, US4-S4). */
  frameCostMs: number | null;
  costSamples: { enabled: number; disabled: number };
  /** The whole frame's calls, chain passes included; `__diag.drawCalls` keeps 001's meaning —
   *  the scene's own — so its budget survives a composer (US4-S10). */
  drawCalls: number;
  renderTargets: number;
  viewport: { width: number; height: number };
  resizes: number;
  fallbacks: string[];
}

declare module '../diag/diag' {
  interface Diagnostics {
    post?: PostDiagnostics;
  }
}

export function createPostDiagnostics(backend: PostBackend = 'webgl'): PostDiagnostics {
  return {
    backend,
    effects: mapPostEffects((id) => POST_EFFECTS[id].enabledByDefault),
    defaults: mapPostEffects((id) => POST_EFFECTS[id].enabledByDefault),
    active: false,
    frameCostMs: null,
    costSamples: { enabled: 0, disabled: 0 },
    drawCalls: 0,
    renderTargets: 0,
    viewport: { width: 0, height: 0 },
    resizes: 0,
    fallbacks: [],
  };
}

export function ensurePostDiag(diag: Diagnostics, backend: PostBackend = 'webgl'): PostDiagnostics {
  diag.post ??= createPostDiagnostics(backend);
  return diag.post;
}
