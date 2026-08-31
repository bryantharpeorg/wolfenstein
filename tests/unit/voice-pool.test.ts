import { describe, it, expect } from 'vitest';
import {
  MASTER_GAIN_CEILING,
  MAX_VOICES,
  createVoicePool,
  endVoice,
  liveVoices,
  masterGain,
  startVoice,
  summedGain,
} from '../../src/audio/voice-pool';
import { soundSpec } from '../../src/audio/sound-table';

// T026 (FR-013, US3-S7). The cap is declared, eviction is oldest-first, and the
// master gain is what keeps a held chaingun below the declared ceiling. All of it
// is bookkeeping over numbers, so none of it needs a graph to be asserted.

const gainOf = (id: Parameters<typeof soundSpec>[0]): number => soundSpec(id).gain;

describe('the voice pool', () => {
  it('declares a cap and a ceiling', () => {
    expect(MAX_VOICES).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_VOICES)).toBe(true);
    expect(MASTER_GAIN_CEILING).toBeGreaterThan(0);
    expect(MASTER_GAIN_CEILING).toBeLessThanOrEqual(1);
  });

  it('starts empty at the declared cap', () => {
    const pool = createVoicePool();
    expect(pool.cap).toBe(MAX_VOICES);
    expect(liveVoices(pool)).toBe(0);
    expect(summedGain(pool)).toBe(0);
  });

  it('holds voices up to the cap without evicting any', () => {
    const pool = createVoicePool();
    for (let i = 0; i < MAX_VOICES; i += 1) {
      const grant = startVoice(pool, 'footstep', i, gainOf('footstep'));
      expect(grant.evicted).toEqual([]);
      expect(liveVoices(pool)).toBe(i + 1);
    }
  });

  it('stops the oldest voices so the live count never exceeds the cap (US3-S7)', () => {
    const pool = createVoicePool();
    const started = [];
    // Every trigger lands on one frame: same millisecond, so the tie-break is
    // the order they were granted in, which is what "oldest" means here.
    for (let i = 0; i < MAX_VOICES + 5; i += 1) {
      const grant = startVoice(pool, 'gunfire-chaingun', 0, gainOf('gunfire-chaingun'));
      started.push(grant.voice);
      expect(liveVoices(pool)).toBeLessThanOrEqual(pool.cap);
    }
    expect(liveVoices(pool)).toBe(MAX_VOICES);

    // The five still live are the five most recent; the first five are gone.
    const live = new Set(pool.voices.map((voice) => voice.id));
    for (let i = 0; i < 5; i += 1) expect(live.has(started[i]!.id)).toBe(false);
    for (let i = 5; i < started.length; i += 1) expect(live.has(started[i]!.id)).toBe(true);
  });

  it('reports the voices it stopped, oldest first', () => {
    const pool = createVoicePool();
    const first = startVoice(pool, 'door', 100, gainOf('door')).voice;
    const second = startVoice(pool, 'door', 50, gainOf('door')).voice;
    for (let i = 0; i < MAX_VOICES - 2; i += 1) startVoice(pool, 'footstep', 200, gainOf('footstep'));

    const grant = startVoice(pool, 'footstep', 300, gainOf('footstep'));
    // Started later but timed earlier: the oldest by start time goes first.
    expect(grant.evicted.map((voice) => voice.id)).toEqual([second.id]);
    expect(pool.voices.some((voice) => voice.id === first.id)).toBe(true);
  });

  it('evicts as many as one frame overran the cap by', () => {
    const pool = createVoicePool(3);
    startVoice(pool, 'footstep', 0, 0.3);
    startVoice(pool, 'footstep', 1, 0.3);
    startVoice(pool, 'footstep', 2, 0.3);
    const grant = startVoice(pool, 'footstep', 3, 0.3);
    expect(grant.evicted.length).toBe(1);
    expect(liveVoices(pool)).toBe(3);
  });

  it('keeps the summed signal below the declared ceiling however many fire', () => {
    const pool = createVoicePool();
    const loudest = gainOf('gunfire-pistol');
    for (let i = 0; i < MAX_VOICES * 4; i += 1) {
      startVoice(pool, 'gunfire-pistol', i, loudest);
      expect(summedGain(pool) * masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING + 1e-12);
    }
    // A held chaingun is the worst case: the cap's worth of the loudest voice.
    expect(liveVoices(pool)).toBe(MAX_VOICES);
    expect(summedGain(pool)).toBeGreaterThan(MASTER_GAIN_CEILING);
    expect(masterGain(pool)).toBeLessThan(1);
  });

  it('never boosts a quiet pool above the ceiling', () => {
    const pool = createVoicePool();
    expect(masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING);
    startVoice(pool, 'footstep', 0, 0.01);
    expect(masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING);
    expect(summedGain(pool) * masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING);
  });

  it('releases a voice once, and reports a second release as nothing to do', () => {
    const pool = createVoicePool();
    const voice = startVoice(pool, 'door', 0, gainOf('door')).voice;
    expect(endVoice(pool, voice.id)).toBe(true);
    expect(liveVoices(pool)).toBe(0);
    expect(endVoice(pool, voice.id)).toBe(false);
  });

  it('gives every voice a distinct id', () => {
    const pool = createVoicePool();
    const ids = new Set<number>();
    for (let i = 0; i < MAX_VOICES * 3; i += 1) {
      ids.add(startVoice(pool, 'footstep', i, 0.2).voice.id);
    }
    expect(ids.size).toBe(MAX_VOICES * 3);
  });

  it('carries the sound and start time on the voice it grants', () => {
    const pool = createVoicePool();
    const { voice } = startVoice(pool, 'drone', 1234, gainOf('drone'));
    expect(voice.sound).toBe('drone');
    expect(voice.startedAtMs).toBe(1234);
    expect(voice.gain).toBe(gainOf('drone'));
  });
});
