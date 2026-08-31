// T038 (FR-014, FR-016; US4-S1, US4-S2, US4-S8). Three claims about the one place the
// post chain's shape is declared. *Exactly four effects*, named and ordered, each with a
// default and a binding read from `POST_EFFECTS` rather than restated here — a fifth
// effect, a renamed one or a default moved to a second file fails this file first.
// *Independence*: a toggle moves one effect and leaves the other three where they were.
// *A disabled effect says so*: an effect the backend cannot run is recorded in
// `fallbacks` and cannot be toggled back on, because "on" would be a lie about a pass
// that does not exist.
//
// Purity is asserted too: `state.ts` builds nothing and imports no renderer, which is
// what lets every claim above be made without a page.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  POST_EFFECTS,
  POST_EFFECT_IDS,
  allPostEffectsRequested,
  anyPostEffectEnabled,
  createPostState,
  disablePostEffect,
  noPostEffectsRequested,
  postEffectEnabled,
  postEffectForKeyCode,
  postEffectStates,
  postFallbackLine,
  setPostEffect,
  togglePostEffect,
  type PostEffectId,
} from '../../src/post/state';

/** The claim is about code, not prose: a comment that says "window" is not a DOM access. */
const codeOf = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const others = (id: PostEffectId): PostEffectId[] => POST_EFFECT_IDS.filter((each) => each !== id);

describe('the declared post-effect table (FR-014, US4-S1)', () => {
  it('lists exactly bloom, ssao, motionBlur and filmGrain, once each', () => {
    expect([...POST_EFFECT_IDS]).toEqual(['bloom', 'ssao', 'motionBlur', 'filmGrain']);
    expect(new Set(POST_EFFECT_IDS).size).toBe(4);
    expect(Object.keys(POST_EFFECTS).sort()).toEqual([...POST_EFFECT_IDS].sort());
  });

  it('declares a boolean default, a distinct binding and tuning for each, in one place', () => {
    const codes = new Set<string>();
    for (const id of POST_EFFECT_IDS) {
      const declared = POST_EFFECTS[id];
      expect(declared.id).toBe(id);
      expect(typeof declared.enabledByDefault).toBe('boolean');
      expect(declared.keyCode).toMatch(/^\w+$/);
      codes.add(declared.keyCode);
      // Tuning is declared beside the default rather than inside the chain, so a
      // retuned effect is not a renderer edit.
      const tuning = Object.entries(declared.tuning);
      expect(tuning.length).toBeGreaterThan(0);
      for (const [name, value] of tuning) {
        expect(Number.isFinite(value), `${id}.${name}`).toBe(true);
      }
    }
    expect(codes.size).toBe(POST_EFFECT_IDS.length);
    for (const id of POST_EFFECT_IDS) {
      expect(postEffectForKeyCode(POST_EFFECTS[id].keyCode)).toBe(id);
    }
    expect(postEffectForKeyCode('KeyW')).toBeNull();
  });

  it('starts a fresh state at the declared defaults, supported and with no fallbacks', () => {
    const state = createPostState();
    for (const id of POST_EFFECT_IDS) {
      expect(postEffectEnabled(state, id), id).toBe(POST_EFFECTS[id].enabledByDefault);
    }
    expect(state.fallbacks).toEqual([]);
    // The published shape is the table's own keys, so a reader cannot see a fifth field.
    expect(Object.keys(postEffectStates(state)).sort()).toEqual([...POST_EFFECT_IDS].sort());
  });
});

describe('toggling one effect (FR-014, US4-S2)', () => {
  it('flips that effect and leaves the other three exactly where they were', () => {
    for (const id of POST_EFFECT_IDS) {
      const state = createPostState();
      const before = postEffectStates(state);
      const after = togglePostEffect(state, id);

      expect(after).toBe(!before[id]);
      expect(postEffectEnabled(state, id)).toBe(after);
      for (const other of others(id)) {
        expect(postEffectEnabled(state, other), `${id} moved ${other}`).toBe(before[other]);
      }
      // And back, so a toggle is its own inverse rather than a one-way switch.
      expect(togglePostEffect(state, id)).toBe(before[id]);
      expect(postEffectStates(state)).toEqual(before);
    }
  });

  it('sets a requested state directly, and setting it twice is not two flips', () => {
    const state = createPostState();
    for (const id of POST_EFFECT_IDS) {
      expect(setPostEffect(state, id, true)).toBe(true);
      expect(setPostEffect(state, id, true)).toBe(true);
      expect(setPostEffect(state, id, false)).toBe(false);
      expect(setPostEffect(state, id, false)).toBe(false);
    }
  });

  it('answers whether all four or none are requested, which is what the cost windows key on', () => {
    const state = createPostState();
    for (const id of POST_EFFECT_IDS) setPostEffect(state, id, false);
    expect(noPostEffectsRequested(state)).toBe(true);
    expect(allPostEffectsRequested(state)).toBe(false);
    expect(anyPostEffectEnabled(state)).toBe(false);

    for (const id of POST_EFFECT_IDS) setPostEffect(state, id, true);
    expect(allPostEffectsRequested(state)).toBe(true);
    expect(noPostEffectsRequested(state)).toBe(false);
    expect(anyPostEffectEnabled(state)).toBe(true);

    setPostEffect(state, 'bloom', false);
    expect(allPostEffectsRequested(state)).toBe(false);
    expect(noPostEffectsRequested(state)).toBe(false);
  });
});

describe('an effect the backend cannot run (FR-016, US4-S8)', () => {
  it('is disabled, recorded in fallbacks by effect and backend, and cannot be turned on', () => {
    const state = createPostState();
    setPostEffect(state, 'ssao', true);
    disablePostEffect(state, 'ssao', 'webgpu', 'no MRT normal pass');

    expect(postEffectEnabled(state, 'ssao')).toBe(false);
    expect(state.fallbacks).toEqual([postFallbackLine('ssao', 'webgpu', 'no MRT normal pass')]);
    expect(state.fallbacks[0]).toContain('ssao');
    expect(state.fallbacks[0]).toContain('webgpu');
    expect(state.fallbacks[0]).toContain('no MRT normal pass');

    // Requested is still honoured as a *request*; enabled is the answer, and it is no.
    expect(setPostEffect(state, 'ssao', true)).toBe(false);
    expect(togglePostEffect(state, 'ssao')).toBe(false);
    expect(postEffectEnabled(state, 'ssao')).toBe(false);

    // And the other three are untouched by one effect's failure (US4-S8).
    for (const other of others('ssao')) {
      expect(postEffectEnabled(state, other), other).toBe(POST_EFFECTS[other].enabledByDefault);
    }
  });

  it('records one line per effect, and a second failure of the same effect adds none', () => {
    const state = createPostState();
    disablePostEffect(state, 'bloom', 'webgl', 'half-float targets unavailable');
    disablePostEffect(state, 'bloom', 'webgl', 'half-float targets unavailable');
    disablePostEffect(state, 'motionBlur', 'webgl', 'accumulation target failed');
    expect(state.fallbacks).toHaveLength(2);
    expect(state.fallbacks.filter((line) => line.startsWith('bloom'))).toHaveLength(1);
  });
});

describe('the state module is pure (Constitution III)', () => {
  it('imports no renderer and names no DOM global, so every claim above needs no page', () => {
    const source = codeOf('../../src/post/state.ts');
    expect(source).not.toMatch(/from\s+['"]three/);
    expect(source).not.toMatch(/\b(window|document|navigator|requestAnimationFrame|HTMLCanvasElement)\b/);
    expect(source).not.toMatch(/EffectComposer|WebGLRenderer|WebGPURenderer/);
  });
});
