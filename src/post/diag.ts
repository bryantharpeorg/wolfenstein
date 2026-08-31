// T046 (FR-018; US4-S1, US4-S4, US4-S8): the `__diag.post` shape, attached to 001's
// `Diagnostics` by module augmentation from this file rather than by editing
// `src/diag/diag.ts` -- the seam `combat-diag.ts`, `run/diag.ts` and `audio/diag.ts`
// already use, so four stories of one epic do not queue up in one shared interface.
// Additive over 001-007: nothing declared there is renamed, removed or repurposed.
//
// It is deliberately reportable while dark. A post chain's characteristic failure is a
// black screen that compiles, type-checks and reports a healthy frame rate, so this
// object separates "off because it was toggled off" (`effects`) from "off because it
// could not be built here" (`fallbacks`), and reports what the chain costs
// (`frameCostMs`) and what it holds (`renderTargets`) rather than leaving both to a
// screenshot.

import type { Diagnostics } from '../diag/diag';
import {
  POST_EFFECTS,
  POST_EFFECT_IDS,
  type PostBackend,
  type PostEffectId,
} from './state';

export interface PostDiagnostics {
  /** The backend the chain was built for, from 001's selection. */
  backend: PostBackend;
  /** Exactly the four declared effects, each with a boolean enabled state (US4-S1). */
  effects: Record<PostEffectId, boolean>;
  /** The defaults, republished from the one place they are declared, so a harness can
   *  compare what it is reading against what was declared rather than against a copy. */
  defaults: Record<PostEffectId, boolean>;
  /** Each effect's declared runtime binding (FR-014). */
  bindings: Record<PostEffectId, string>;
  /** Whether the frame is currently going through the chain at all. */
  active: boolean;
  /** The chain's cost against its own all-disabled baseline; null until both 120-frame
   *  windows have been measured (FR-017, US4-S4). */
  frameCostMs: number | null;
  enabledFrameMs: number | null;
  baselineFrameMs: number | null;
  /** How full each window is, so a harness waits for a measurement instead of guessing. */
  costSamples: { enabled: number; disabled: number };
  /** The whole frame's draw calls, chain passes included. `__diag.drawCalls` keeps 001's
   *  meaning -- the scene's own calls -- so its budget survives a composer (US4-S10). */
  drawCalls: number;
  /** Render targets the chain holds right now: the baseline is zero with everything off,
   *  so a toggle that leaks is a number rather than a slow death (US4-S9). */
  renderTargets: number;
  /** What the targets were last sized to, and how many resizes have been applied. */
  viewport: { width: number; height: number };
  resizes: number;
  /** One line per effect that could not be built here (FR-016, US4-S8). */
  fallbacks: string[];
}

/** One list to check the published object against, as `RUN_DIAGNOSTIC_FIELDS` does. */
export const POST_DIAGNOSTIC_FIELDS = [
  'backend', 'effects', 'defaults', 'bindings', 'active', 'frameCostMs', 'enabledFrameMs',
  'baselineFrameMs', 'costSamples', 'drawCalls', 'renderTargets', 'viewport', 'resizes',
  'fallbacks',
] as const satisfies readonly (keyof PostDiagnostics)[];

declare module '../diag/diag' {
  interface Diagnostics {
    post?: PostDiagnostics;
  }
}

function declaredMap<T>(pick: (id: PostEffectId) => T): Record<PostEffectId, T> {
  const map = {} as Record<PostEffectId, T>;
  for (const id of POST_EFFECT_IDS) map[id] = pick(id);
  return map;
}

export function createPostDiagnostics(backend: PostBackend = 'webgl'): PostDiagnostics {
  return {
    backend,
    effects: declaredMap((id) => POST_EFFECTS[id].enabledByDefault),
    defaults: declaredMap((id) => POST_EFFECTS[id].enabledByDefault),
    bindings: declaredMap((id) => POST_EFFECTS[id].keyCode),
    active: false,
    frameCostMs: null,
    enabledFrameMs: null,
    baselineFrameMs: null,
    costSamples: { enabled: 0, disabled: 0 },
    drawCalls: 0,
    renderTargets: 0,
    viewport: { width: 0, height: 0 },
    resizes: 0,
    fallbacks: [],
  };
}

/** Idempotent, so a second reader may ensure it without clearing the first's writes. */
export function ensurePostDiag(diag: Diagnostics, backend: PostBackend = 'webgl'): PostDiagnostics {
  diag.post ??= createPostDiagnostics(backend);
  return diag.post;
}
