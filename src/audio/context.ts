// The only WebAudio-aware file in the project (FR-009, FR-012, FR-013): the graph, the
// autoplay policy and the failure vocabulary, everything else being decided in
// `sound-table.ts`, `synth.ts` and `voice-pool.ts`. Startup never awaits audio (US3-S5)
// — the context is built synchronously in a guard and left suspended, so a gate that
// never gestures is a pass. A sound that cannot be built is silent, not fatal (US3-S9)
// — a failure is a `fallbacks` line, never an `__diag.errors` entry. And no voice
// switches gain (US3-S8): envelopes are baked in, and an evicted voice ramps down.

import { SOUND_IDS, soundSpec, type SoundId } from './sound-table';
import { renderSound } from './synth';
import {
  MASTER_GAIN_CEILING, clearVoices, createVoicePool, endVoice, liveVoices, masterGain,
  startVoice, type VoicePool,
} from './voice-pool';

export type AudioContextState = 'unavailable' | 'suspended' | 'running' | 'closed';

interface AudioGlobals {
  AudioContext?: new () => AudioContext;
  webkitAudioContext?: new () => AudioContext; // the one prefixed platform still shipping
}

interface VoiceNodes {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly releaseSeconds: number;
  readonly durationMs: number;
  readonly loop: boolean;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Guarded: a recorded reason rather than a throw, because a machine with no audio
 *  device is a silent game, not a broken one (US3-S9). */
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

/** Every declared sound in a buffer of its own; one that will not render costs that
 *  sound and nothing else (FR-013, US3-S9). */
function buildBuffers(
  context: AudioContext,
  inventory: SoundId[],
  fallbacks: string[],
): Map<SoundId, AudioBuffer> {
  const buffers = new Map<SoundId, AudioBuffer>();
  for (const id of SOUND_IDS) {
    try {
      const samples = renderSound(soundSpec(id), context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      buffers.set(id, buffer);
      inventory.push(id);
    } catch (error) {
      fallbacks.push(`${id}: not synthesized (${reason(error)}), that event is silent`);
    }
  }
  return buffers;
}

/** The engine the audio system drives: every method is safe to call at any time,
 *  including with no context at all, which is what makes the fallback a fallback
 *  rather than a branch every call site repeats. */
export type AudioEngine = ReturnType<typeof createAudioEngine>;

/** Builds the engine (FR-012). Synchronous and total: an engine comes back whether or
 *  not a context does, it never throws, and the context is left suspended — asked to
 *  suspend even when the platform hands one back running, so US3-S5's reading is a
 *  fact about this module rather than about an autoplay policy. */
export function createAudioEngine() {
  const fallbacks: string[] = [];
  const inventory: SoundId[] = [];
  const context = constructContext(fallbacks);
  const buffers =
    context == null ? new Map<SoundId, AudioBuffer>() : buildBuffers(context, inventory, fallbacks);

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
    if (context.state === 'running') void Promise.resolve(context.suspend()).catch(() => {});
  }

  const rebalance = (): void => {
    if (context == null || master == null) return;
    const value = masterGain(pool);
    try {
      master.gain.setTargetAtTime(value, context.currentTime, 0.01);
    } catch {
      master.gain.value = value;
    }
  };

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
    } catch { /* a source that already ended throws on stop, and is already silent */ }
  };

  const retire = (id: number): void => {
    if (!endVoice(pool, id)) return;
    if (droneVoice === id) droneVoice = null;
    stopVoice(id);
    rebalance();
  };

  const start = (sound: SoundId, atMs: number): number | null => {
    const buffer = buffers.get(sound);
    if (context == null || master == null || context.state !== 'running' || buffer == null) return null;

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
      source, gain,
      releaseSeconds: spec.envelope.releaseSeconds,
      durationMs: spec.durationSeconds * 1000,
      loop: spec.loop,
    });
    source.onended = () => retire(grant.voice.id);
    rebalance();
    return grant.voice.id;
  };

  return {
    inventory: inventory as readonly SoundId[],
    fallbacks: fallbacks as readonly string[],
    state(): AudioContextState {
      if (context == null) return 'unavailable';
      const state = context.state;
      return state === 'running' || state === 'closed' ? state : 'suspended';
    },
    voices: (): number => liveVoices(pool),
    started: (): number => started,
    resume(): void {
      gestured = true;
      if (context == null || context.state === 'closed') return;
      // A browser that refuses to resume leaves the game playable and silent with no
      // uncaught exception (FR-012, US3-S6), whether it rejects or throws outright.
      try {
        void Promise.resolve(context.resume()).catch(() => {});
      } catch { /* thrown synchronously by some implementations */ }
    },
    suspend(): void {
      if (context == null || context.state !== 'running') return;
      try {
        void Promise.resolve(context.suspend()).catch(() => {});
      } catch { /* as above; a bed left playing is benign */ }
    },
    play: (sound: SoundId, atMs: number): boolean => start(sound, atMs) != null,
    startDrone(atMs: number): boolean {
      if (droneVoice != null || !gestured) return false;
      droneVoice = start('drone', atMs);
      return droneVoice != null;
    },
    droneRunning: (): boolean => droneVoice != null,
    update(atMs: number): void {
      if (context == null) return;
      if (context.state === 'closed') {
        for (const voice of clearVoices(pool)) stopVoice(voice.id);
        droneVoice = null;
        return;
      }
      for (const voice of [...pool.voices]) {
        const held = nodes.get(voice.id);
        if (held == null || held.loop) continue;
        if (atMs - voice.startedAtMs >= held.durationMs) retire(voice.id);
      }
    },
  };
}
