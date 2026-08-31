import { describe, it, expect } from 'vitest';
import {
  MASTER_GAIN_CEILING, MAX_VOICES, createVoicePool, endVoice, liveVoices, masterGain,
  startVoice, summedGain,
} from '../../src/audio/voice-pool';
import { soundSpec } from '../../src/audio/sound-table';

// T026 (FR-013, US3-S7). The cap is declared, eviction is oldest-first, and the master
// gain is what keeps a held chaingun below the declared ceiling — all bookkeeping over
// numbers, so none of it needs a graph to be asserted.

const gainOf = (id: Parameters<typeof soundSpec>[0]): number => soundSpec(id).gain;

describe('the voice pool', () => {
  it('holds voices to the cap, then stops the oldest so it never exceeds it (US3-S7)', () => {
    expect(Number.isInteger(MAX_VOICES)).toBe(true);
    expect(MAX_VOICES).toBeGreaterThan(0);
    expect(MASTER_GAIN_CEILING).toBeGreaterThan(0);
    expect(MASTER_GAIN_CEILING).toBeLessThanOrEqual(1);

    const pool = createVoicePool();
    expect(pool.cap).toBe(MAX_VOICES);
    expect(liveVoices(pool)).toBe(0);
    expect(summedGain(pool)).toBe(0);
    const started = [];
    // Every trigger lands on one frame — the same millisecond — so the tie-break is
    // the order they were granted in, which is what "oldest" means here.
    for (let i = 0; i < MAX_VOICES + 5; i += 1) {
      const grant = startVoice(pool, 'gunfire-chaingun', 0, gainOf('gunfire-chaingun'));
      expect(grant.evicted.length).toBe(i < MAX_VOICES ? 0 : 1);
      expect(liveVoices(pool)).toBeLessThanOrEqual(pool.cap);
      started.push(grant.voice);
    }
    expect(liveVoices(pool)).toBe(MAX_VOICES);

    const live = new Set(pool.voices.map((voice) => voice.id));
    for (let i = 0; i < started.length; i += 1) expect(live.has(started[i]!.id)).toBe(i >= 5);
  });

  it('evicts by start time rather than by grant order', () => {
    const pool = createVoicePool();
    const first = startVoice(pool, 'door', 100, gainOf('door')).voice;
    const second = startVoice(pool, 'door', 50, gainOf('door')).voice;
    for (let i = 0; i < MAX_VOICES - 2; i += 1) startVoice(pool, 'footstep', 200, gainOf('footstep'));
    // Started later but timed earlier: the oldest by start time goes first.
    expect(startVoice(pool, 'footstep', 300, gainOf('footstep')).evicted.map((v) => v.id))
      .toEqual([second.id]);
    expect(pool.voices.some((voice) => voice.id === first.id)).toBe(true);
  });

  it('keeps the summed signal below the declared ceiling, and never boosts past it', () => {
    const pool = createVoicePool();
    expect(masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING);
    const loudest = gainOf('gunfire-pistol');
    for (let i = 0; i < MAX_VOICES * 4; i += 1) {
      startVoice(pool, 'gunfire-pistol', i, loudest);
      expect(summedGain(pool) * masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING + 1e-12);
      expect(masterGain(pool)).toBeLessThanOrEqual(MASTER_GAIN_CEILING);
    }
    expect(summedGain(pool)).toBeGreaterThan(MASTER_GAIN_CEILING);
    expect(masterGain(pool)).toBeLessThan(1);
  });

  it('releases a voice once, and grants distinct ids carrying sound, start and gain', () => {
    const pool = createVoicePool();
    const { voice } = startVoice(pool, 'drone', 1234, gainOf('drone'));
    expect(voice.sound).toBe('drone');
    expect(voice.startedAtMs).toBe(1234);
    expect(voice.gain).toBe(gainOf('drone'));
    expect(endVoice(pool, voice.id)).toBe(true);
    expect(liveVoices(pool)).toBe(0);
    expect(endVoice(pool, voice.id)).toBe(false);

    const ids = new Set<number>();
    for (let i = 0; i < MAX_VOICES * 3; i += 1) ids.add(startVoice(pool, 'footstep', i, 0.2).voice.id);
    expect(ids.size).toBe(MAX_VOICES * 3);
  });
});
