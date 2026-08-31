// T040 (FR-014, FR-016; US4-S1, US4-S2, US4-S8): the one place the post chain's shape is
// declared. Which four effects exist, whether each starts on, which key flips it and how
// each is tuned all live in `POST_EFFECTS` -- so retuning bloom is not a renderer edit,
// and a default cannot drift between the chain that builds a pass and the diagnostics
// that report it, because there is only one copy.
//
// The module builds nothing. It imports no renderer, names no DOM global and holds no
// module-level state, so every claim US4-S1, US4-S2 and US4-S8 make about defaults,
// independence and fallbacks is asserted under `npm run test` without a page.
//
// Two words that are deliberately not synonyms. **Requested** is what the player asked
// for; **supported** is whether the active backend can run it at all. `enabled` is the
// conjunction, and it is what `__diag.post` reports -- an effect the backend cannot build
// must never read `true` merely because a key was pressed for it (FR-016).

/** Exactly four, in the order FR-014 names them, and the order the chain applies them. */
export const POST_EFFECT_IDS = ['bloom', 'ssao', 'motionBlur', 'filmGrain'] as const;

export type PostEffectId = (typeof POST_EFFECT_IDS)[number];

/** Which renderer a fallback was taken on, in 001's vocabulary. */
export type PostBackend = 'webgpu' | 'webgl';

export interface PostEffectDeclaration {
  readonly id: PostEffectId;
  /** The default state FR-014 requires be declared in one place. This is that place. */
  readonly enabledByDefault: boolean;
  /** The declared runtime binding: a `KeyboardEvent.code`, as 007's weapon select uses. */
  readonly keyCode: string;
  /** Everything the chain needs to build the pass, so `chain.ts` invents no number. */
  readonly tuning: Readonly<Record<string, number>>;
}

/**
 * The declared table. Digits 5-8 are free: 007 took 1-3 for weapon select, 001's perf
 * overlay took F1, and 004 and US2 took E and R.
 *
 * Two on and two off, and the split is not arbitrary. Bloom and film grain are cheap --
 * a blur pyramid at a quarter of the viewport and one full-screen pass -- and they look
 * the same on either backend, so they are what the game ships looking like. Ambient
 * occlusion is the most expensive of the four per pixel by a wide margin *and* is the one
 * effect this chain cannot offer on WebGPU at all (see `chain.ts`), so defaulting it on
 * would mean the default game looked different depending on which renderer 001 selected;
 * it is opt-in instead, and a WebGPU player is told through `fallbacks` why opting in
 * does nothing. Motion blur is opt-in because an accumulation smear on a fast turn reads
 * as a dropped frame to anyone who did not ask for it.
 */
export const POST_EFFECTS = {
  bloom: {
    id: 'bloom',
    enabledByDefault: true,
    keyCode: 'Digit5',
    // Threshold above the level's lit walls and below the muzzle flash's additive core,
    // so what blooms is the flash rather than every corridor (US4-S6).
    tuning: { strength: 0.7, radius: 0.4, threshold: 0.82 },
  },
  ssao: {
    id: 'ssao',
    enabledByDefault: false,
    keyCode: 'Digit6',
    // Radius in world units, and a tile is one unit: a quarter of a tile darkens the
    // wall-floor seam without shading a whole corridor.
    tuning: { radius: 0.25, minDistance: 0.002, maxDistance: 0.1 },
  },
  motionBlur: {
    id: 'motionBlur',
    enabledByDefault: false,
    keyCode: 'Digit7',
    // How much of the previous frame survives into this one. Above ~0.85 a fast turn
    // leaves a trail that outlives the turn.
    tuning: { damp: 0.72 },
  },
  filmGrain: {
    id: 'filmGrain',
    enabledByDefault: true,
    keyCode: 'Digit8',
    tuning: { intensity: 0.22 },
  },
} as const satisfies Readonly<Record<PostEffectId, PostEffectDeclaration>>;

/** The declared binding, resolved. `null` for every key that is not one of the four. */
export function postEffectForKeyCode(code: string): PostEffectId | null {
  for (const id of POST_EFFECT_IDS) {
    if (POST_EFFECTS[id].keyCode === code) return id;
  }
  return null;
}

export interface PostState {
  /** What has been asked for, by default or by a toggle. */
  readonly requested: Record<PostEffectId, boolean>;
  /** What the active backend can actually run; false once an effect has been disabled. */
  readonly supported: Record<PostEffectId, boolean>;
  /** One line per effect that could not be built, in `postFallbackLine` form (FR-016). */
  readonly fallbacks: string[];
}

function defaults(): Record<PostEffectId, boolean> {
  const states = {} as Record<PostEffectId, boolean>;
  for (const id of POST_EFFECT_IDS) states[id] = POST_EFFECTS[id].enabledByDefault;
  return states;
}

/** A fresh state at the declared defaults: a new record each call, so two chains never
 *  share one. */
export function createPostState(): PostState {
  const supported = {} as Record<PostEffectId, boolean>;
  for (const id of POST_EFFECT_IDS) supported[id] = true;
  return { requested: defaults(), supported, fallbacks: [] };
}

/** Requested *and* supported: the only reading `__diag.post` publishes. */
export function postEffectEnabled(state: PostState, id: PostEffectId): boolean {
  return state.requested[id] && state.supported[id];
}

/** Every effect's enabled state, in one object, keyed by the declared ids and nothing
 *  else — what `__diag.post.effects` is copied from (US4-S1). */
export function postEffectStates(state: PostState): Record<PostEffectId, boolean> {
  const states = {} as Record<PostEffectId, boolean>;
  for (const id of POST_EFFECT_IDS) states[id] = postEffectEnabled(state, id);
  return states;
}

/** Requests a state and answers what it actually became. Idempotent: setting `true`
 *  twice is one state, not two flips. */
export function setPostEffect(state: PostState, id: PostEffectId, on: boolean): boolean {
  state.requested[id] = on;
  return postEffectEnabled(state, id);
}

/** Flips one effect and answers its new enabled state. Touches no other effect, which is
 *  the whole of US4-S2. */
export function togglePostEffect(state: PostState, id: PostEffectId): boolean {
  return setPostEffect(state, id, !postEffectEnabled(state, id));
}

/** The declared fallback vocabulary, shared by `__diag.post.fallbacks` and the line
 *  `DECISIONS.md` records, so the two cannot disagree (FR-016, US4-S8). */
export function postFallbackLine(id: PostEffectId, backend: PostBackend, reason: string): string {
  return `${id}: ${backend}, ${reason}`;
}

/**
 * Records that an effect cannot run here. It stops being enabled whatever was requested,
 * and it says why — an effect that is merely dark is the failure mode US4-S3 exists to
 * forbid. Recording the same effect twice adds no second line, so a chain rebuilt on
 * every toggle does not grow the list without bound.
 */
export function disablePostEffect(
  state: PostState,
  id: PostEffectId,
  backend: PostBackend,
  reason: string,
): void {
  const line = postFallbackLine(id, backend, reason);
  state.supported[id] = false;
  if (!state.fallbacks.some((entry) => entry.startsWith(`${id}:`))) state.fallbacks.push(line);
}

/** All four asked for. The cost windows key on the request rather than on what was
 *  built, so an unsupported effect does not make "all four enabled" unreachable. */
export function allPostEffectsRequested(state: PostState): boolean {
  return POST_EFFECT_IDS.every((id) => state.requested[id]);
}

/** None asked for: the baseline window, and the state US4-S5's floor is read in. */
export function noPostEffectsRequested(state: PostState): boolean {
  return POST_EFFECT_IDS.every((id) => !state.requested[id]);
}

/** Whether the chain has anything to do this frame. */
export function anyPostEffectEnabled(state: PostState): boolean {
  return POST_EFFECT_IDS.some((id) => postEffectEnabled(state, id));
}
