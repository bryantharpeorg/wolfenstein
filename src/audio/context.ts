// The only WebAudio-aware file in the project (FR-009, FR-012, FR-013). Everything
// it decides was decided already: the inventory is `sound-table.ts`, the samples
// are `synth.ts`, the cap and the ceiling are `voice-pool.ts`. What is left here is
// the graph, the autoplay policy and the failure vocabulary.
//
// Three rules shape it, and each answers a way a WebAudio story fails silently.
//
// *Startup never awaits audio* (FR-012, US3-S5). The context is constructed
// synchronously inside a guard and left suspended; nothing in the load path
// returns a promise this module made. A gate run in headless Chromium never
// gestures, so it never resumes, and that is a pass.
//
// *A sound that cannot be built is silent, not fatal* (FR-013, US3-S9). Each
// buffer is rendered in its own try, so one bad spec costs one sound. A context
// that cannot be constructed at all costs every sound and nothing else — the game
// stays playable, and the omission is a `fallbacks` line rather than an
// `__diag.errors` entry, which is the difference between a declared outcome and a
// defect.
//
// *No voice switches gain* (US3-S8). The envelope is baked into the buffer, so a
// sound that plays out ramps at both edges by construction; a voice the cap
// evicts is ramped down over its declared release before it is stopped, so
// eviction is the one path that could click and does not.

import {
  SOUND_IDS,
  soundSpec,
  type SoundId,
} from './sound-table';
import { renderSound } from './synth';
import {
  MASTER_GAIN_CEILING,
  clearVoices,
  createVoicePool,
  endVoice,
  liveVoices,
  masterGain,
  startVoice,
  type VoicePool,
} from './voice-pool';

/** What `__diag.audio.contextState` reports. `unavailable` is this module's own
 *  word for "there is no context", which the platform has no state for. */
export type AudioContextState = 'unavailable' | 'suspended' | 'running' | 'closed';

/** The engine the audio system drives. Every method is safe to call at any time,
 *  including when there is no context at all — that is what makes the fallback a
 *  fallback rather than a branch every call site repeats. */
export interface AudioEngine {
  state(): AudioContextState;
  /** The sounds that were synthesized, in table order. */
  readonly inventory: readonly SoundId[];
  /** One line per omission (FR-013, US3-S9); empty on a complete build. */
  readonly fallbacks: readonly string[];
  voices(): number;
  /** Voices actually started since load, monotonic. The one runtime fact that
   *  distinguishes "this event made a sound" from "this event was refused", which
   *  a suspended graph reports identically (FR-011, FR-018). */
  started(): number;
  /** The first user gesture (FR-012). Never awaited: the promise is handled here
   *  so a browser that refuses leaves no rejection anywhere else. */
  resume(): void;
  /** A hidden tab. The drone is not stopped, so returning does not restart it. */
  suspend(): void;
  /** Plays a synthesized sound under the cap. False when nothing was played —
   *  no context, no buffer, or a context that is not running (US3-S6). */
  play(sound: SoundId, atMs: number): boolean;
  /** The ambient bed, started at most once however often this is called. */
  startDrone(atMs: number): boolean;
  droneRunning(): boolean;
  /** Retires voices whose sounds have finished, so the live count is truthful. */
  update(atMs: number): void;
}

/** The window fields a context is constructed from, without widening `Window`. */
interface AudioGlobals {
  AudioContext?: new () => AudioContext;
  webkitAudioContext?: new () => AudioContext;
}

/** A live voice's nodes, held so eviction can ramp and stop them. */
interface VoiceNodes {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly releaseSeconds: number;
  readonly durationMs: number;
  readonly loop: boolean;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Construction, guarded. Returns null and the reason rather than throwing: a
 *  machine with no audio device is a silent game, not a broken one (US3-S9). */
function constructContext(fallbacks: string[]): AudioContext | null {
  const globals = globalThis as unknown as AudioGlobals;
  const Constructor = globals.AudioContext ?? globals.webkitAudioContext;
  if (Constructor == null) {
    fallbacks.push('context: no WebAudio in this browser, every sound is silent');
    return null;
  }
  try {
    return new Constructor();
  } catch (error) {
    fallbacks.push(`context: could not be constructed (${reason(error)}), every sound is silent`);
    return null;
  }
}

/** Every sound the table declares, rendered into a buffer of its own. One that
 *  will not render costs one sound (FR-013, US3-S9). */
function buildBuffers(
  context: AudioContext,
  inventory: SoundId[],
  fallbacks: string[],
): Map<SoundId, AudioBuffer> {
  const buffers = new Map<SoundId, AudioBuffer>();
  for (const id of SOUND_IDS) {
    try {
      const spec = soundSpec(id);
      const samples = renderSound(spec, context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      // `set` rather than `copyToChannel`: the same write, without a typed-array
      // generic that pins this file to one TypeScript minor.
      buffer.getChannelData(0).set(samples);
      buffers.set(id, buffer);
      inventory.push(id);
    } catch (error) {
      fallbacks.push(`${id}: not synthesized (${reason(error)}), that event is silent`);
    }
  }
  return buffers;
}

/**
 * Builds the engine (FR-012). Synchronous and total: it returns an engine whether
 * or not a context exists, and it never throws. The context is left suspended —
 * asked to suspend even when the platform handed one back running, so US3-S5's
 * reading is a fact about this module rather than about an autoplay policy.
 */
export function createAudioEngine(): AudioEngine {
  const fallbacks: string[] = [];
  const inventory: SoundId[] = [];
  const context = constructContext(fallbacks);
  const buffers = context == null ? new Map<SoundId, AudioBuffer>() : buildBuffers(context, inventory, fallbacks);

  const pool: VoicePool = createVoicePool();
  const nodes = new Map<number, VoiceNodes>();
  let master: GainNode | null = null;
  let gestured = false;
  let droneVoice: number | null = null;
  let started = 0;

  if (context != null) {
    try {
      master = context.createGain();
      master.gain.value = MASTER_GAIN_CEILING;
      master.connect(context.destination);
    } catch (error) {
      fallbacks.push(`master: no gain bus (${reason(error)}), every sound is silent`);
      master = null;
    }
    // Nothing awaits this: a promise that never settles must not hold up startup.
    if (context.state === 'running') void Promise.resolve(context.suspend()).catch(() => {});
  }

  const playable = (): boolean => context != null && master != null && context.state === 'running';

  /** The bus gain for the pool as it stands, so a pile-up divides the budget
   *  rather than summing past it (FR-013, US3-S7). */
  const rebalance = (): void => {
    if (context == null || master == null) return;
    const value = masterGain(pool);
    // A ramp, not a switch: the bus moves whenever a voice starts or ends, and a
    // stepped bus gain is a click on every other sound (US3-S8).
    try {
      master.gain.setTargetAtTime(value, context.currentTime, 0.01);
    } catch {
      master.gain.value = value;
    }
  };

  /** Ramps a voice down over its declared release and stops it. */
  const stopVoice = (id: number): void => {
    const held = nodes.get(id);
    nodes.delete(id);
    if (held == null || context == null) return;
    const now = context.currentTime;
    try {
      held.gain.gain.cancelScheduledValues(now);
      held.gain.gain.setValueAtTime(held.gain.gain.value, now);
      held.gain.gain.linearRampToValueAtTime(0, now + held.releaseSeconds);
      held.source.stop(now + held.releaseSeconds);
    } catch {
      // A source that already ended throws on stop; it is already silent.
    }
  };

  const retire = (id: number): void => {
    if (!endVoice(pool, id)) return;
    if (droneVoice === id) droneVoice = null;
    stopVoice(id);
    rebalance();
  };

  /** Starts one voice and returns its id, or null when nothing was played. */
  const start = (sound: SoundId, atMs: number): number | null => {
    if (context == null || master == null || !playable()) return null;
    const buffer = buffers.get(sound);
    if (buffer == null) return null;

    const spec = soundSpec(sound);
    let source: AudioBufferSourceNode;
    let gain: GainNode;
    try {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = spec.loop;
      gain = context.createGain();
      gain.gain.value = spec.gain;
      source.connect(gain);
      gain.connect(master);
      source.start();
    } catch (error) {
      fallbacks.push(`${sound}: not played (${reason(error)}), that event is silent`);
      return null;
    }

    started += 1;
    const grant = startVoice(pool, sound, atMs, spec.gain);
    for (const voice of grant.evicted) {
      if (droneVoice === voice.id) droneVoice = null;
      stopVoice(voice.id);
    }
    nodes.set(grant.voice.id, {
      source,
      gain,
      releaseSeconds: spec.envelope.releaseSeconds,
      durationMs: spec.durationSeconds * 1000,
      loop: spec.loop,
    });
    source.onended = () => retire(grant.voice.id);
    rebalance();
    return grant.voice.id;
  };

  return {
    inventory,
    fallbacks,
    state(): AudioContextState {
      if (context == null) return 'unavailable';
      const state = context.state;
      return state === 'running' || state === 'closed' ? state : 'suspended';
    },
    voices: () => liveVoices(pool),
    started: () => started,
    resume(): void {
      gestured = true;
      if (context == null || context.state === 'closed') return;
      // A browser that refuses to resume leaves the game playable and silent with
      // no uncaught exception (FR-012, US3-S6): the rejection is swallowed here.
      try {
        void Promise.resolve(context.resume()).catch(() => {});
      } catch {
        // Some implementations throw synchronously rather than rejecting.
      }
    },
    suspend(): void {
      if (context == null || context.state !== 'running') return;
      try {
        void Promise.resolve(context.suspend()).catch(() => {});
      } catch {
        // As above: a refusal to suspend leaves the bed playing, which is benign.
      }
    },
    play: (sound, atMs) => start(sound, atMs) != null,
    startDrone(atMs: number): boolean {
      // At most once per engine: a tab suspended and resumed must not stack a
      // second bed on the first (Edge Cases).
      if (droneVoice != null || !gestured) return false;
      droneVoice = start('drone', atMs);
      return droneVoice != null;
    },
    droneRunning: () => droneVoice != null,
    update(atMs: number): void {
      if (context == null) return;
      if (context.state === 'closed') {
        for (const voice of clearVoices(pool)) stopVoice(voice.id);
        droneVoice = null;
        return;
      }
      // `onended` is the primary retirement; this is the backstop for a suspended
      // context, where a finished source may never fire it.
      for (const voice of [...pool.voices]) {
        const held = nodes.get(voice.id);
        if (held == null || held.loop) continue;
        if (atMs - voice.startedAtMs >= held.durationMs) retire(voice.id);
      }
    },
  };
}
