// T040 (FR-014, FR-016; US4-S1, US4-S2, US4-S8): the one place the chain's shape is declared —
// which four effects exist, whether each starts on, which key flips it, how each is tuned. Pure:
// no renderer, no DOM, no module state. *Requested* is what the player asked for, *supported*
// whether the backend can run it, and `enabled` — what `__diag.post` reports — is the
// conjunction, so a refused effect never reads true because a key was pressed (FR-016).

export const POST_EFFECT_IDS = ['bloom', 'ssao', 'motionBlur', 'filmGrain'] as const;

export type PostEffectId = (typeof POST_EFFECT_IDS)[number];

export type PostBackend = 'webgpu' | 'webgl';

export interface PostEffectDeclaration {
  readonly id: PostEffectId;
  readonly enabledByDefault: boolean;
  readonly keyCode: string;
  readonly tuning: Readonly<Record<string, number>>;
}

/** Digits 5-8 are free: 007 took 1-3, 001's overlay F1, 004 and US2 E and R. Bloom's threshold
 *  sits above the lit walls and below the flash's additive core, so what blooms is the flash
 *  (US4-S6).
 *
 *  All four start off, which is FR-017 read literally: the floor is promised *with all four
 *  disabled*, and 001's harness asserts that same floor against the page's defaults, so the
 *  two agree only when the defaults are the disabled state. It is also the story's own first
 *  clause — effects are for hardware that has the budget for them — and it makes the frame the
 *  player is handed byte-for-byte the frame 007 shipped. Each is one key away. See
 *  `DECISIONS.md`. */
export const POST_EFFECTS = {
  bloom: { id: 'bloom', enabledByDefault: false, keyCode: 'Digit5',
    tuning: { strength: 0.7, radius: 0.4, threshold: 0.82 } },
  ssao: { id: 'ssao', enabledByDefault: false, keyCode: 'Digit6',
    tuning: { radius: 0.25, minDistance: 0.002, maxDistance: 0.1 } },
  motionBlur: { id: 'motionBlur', enabledByDefault: false, keyCode: 'Digit7',
    tuning: { damp: 0.72 } },
  filmGrain: { id: 'filmGrain', enabledByDefault: false, keyCode: 'Digit8',
    tuning: { intensity: 0.22 } },
} as const satisfies Readonly<Record<PostEffectId, PostEffectDeclaration>>;

export function postEffectForKeyCode(code: string): PostEffectId | null {
  for (const id of POST_EFFECT_IDS) {
    if (POST_EFFECTS[id].keyCode === code) return id;
  }
  return null;
}

export interface PostState {
  readonly requested: Record<PostEffectId, boolean>;
  readonly supported: Record<PostEffectId, boolean>;
  /** One line per effect that could not be built, in `postFallbackLine` form (FR-016). */
  readonly fallbacks: string[];
}

export function mapPostEffects<T>(pick: (id: PostEffectId) => T): Record<PostEffectId, T> {
  const map = {} as Record<PostEffectId, T>;
  for (const id of POST_EFFECT_IDS) map[id] = pick(id);
  return map;
}

export function createPostState(): PostState {
  return {
    requested: mapPostEffects((id) => POST_EFFECTS[id].enabledByDefault),
    supported: mapPostEffects(() => true),
    fallbacks: [],
  };
}

export function postEffectEnabled(state: PostState, id: PostEffectId): boolean {
  return state.requested[id] && state.supported[id];
}

export function postEffectStates(state: PostState): Record<PostEffectId, boolean> {
  return mapPostEffects((id) => postEffectEnabled(state, id));
}

export function setPostEffect(state: PostState, id: PostEffectId, on: boolean): boolean {
  state.requested[id] = on;
  return postEffectEnabled(state, id);
}

export function togglePostEffect(state: PostState, id: PostEffectId): boolean {
  return setPostEffect(state, id, !postEffectEnabled(state, id));
}

export function postFallbackLine(id: PostEffectId, backend: PostBackend, reason: string): string {
  return `${id}: ${backend}, ${reason}`;
}

/** Records that an effect cannot run here: it stops being enabled whatever was requested, and
 *  says why, because merely dark is what US4-S3 forbids. The same effect twice adds no second
 *  line, so a chain rebuilt on every toggle does not grow the list. */
export function disablePostEffect(
  state: PostState, id: PostEffectId, backend: PostBackend, reason: string,
): void {
  state.supported[id] = false;
  if (!state.fallbacks.some((entry) => entry.startsWith(`${id}:`))) {
    state.fallbacks.push(postFallbackLine(id, backend, reason));
  }
}

/** The cost windows key on the *request*, so an unsupported effect does not make "all four
 *  enabled" unreachable; none requested is the baseline window and US4-S5's floor. */
export function allPostEffectsRequested(state: PostState): boolean {
  return POST_EFFECT_IDS.every((id) => state.requested[id]);
}

export function noPostEffectsRequested(state: PostState): boolean {
  return POST_EFFECT_IDS.every((id) => !state.requested[id]);
}

export function anyPostEffectEnabled(state: PostState): boolean {
  return POST_EFFECT_IDS.some((id) => postEffectEnabled(state, id));
}
