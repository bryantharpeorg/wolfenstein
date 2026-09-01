import { describe, it, expect, beforeEach } from 'vitest';
import { MAPS_PER_MATERIAL, textureBytes } from '../../src/materials/maps';
import { MATERIAL_NAMES } from '../../src/materials/table';
import { TEXTURE_SIZE } from '../../src/materials/constants';
import { resetMaterialDiagnostics } from '../../src/materials/diagnostics';
import { buildMaterialMaps } from '../../src/materials/maps';
import {
  PREVIEW_TEXTURE_SIZE,
  STAGES_PER_MATERIAL,
  completeRamp,
  rampBytes,
  rampGeneratedMs,
  rampMaps,
  rampPending,
  rampReports,
  startRamp,
  stepRamp,
} from '../../src/systems/materials/derivation-ramp';

// FR-011 / US4-S6. Deriving five 512px materials in one go is a third of a
// second of blocked main thread. The ramp skins the level from a cheap preview
// set, then spends the full derivation one stage of one material per frame, so
// no frame the page owes the render loop ever carries the whole build.

/** Small full size so the ramp's *shape* is asserted without paying for five
 * 512px derivations in a unit test. */
const FULL = 32;
const PREVIEW = 8;

describe('the derivation ramp (US4-S6)', () => {
  beforeEach(() => {
    resetMaterialDiagnostics();
  });

  it('skins from a preview set that is ready before the first frame', () => {
    const maps = startRamp(PREVIEW, FULL);
    expect(Object.keys(maps).sort()).toEqual([...MATERIAL_NAMES].sort());
    for (const name of MATERIAL_NAMES) {
      expect(maps[name].size).toBe(PREVIEW);
      // Every material has a real albedo from frame one: nothing is untextured
      // while the sharp set is still being derived (US3-S2 stays intact).
      expect(maps[name].albedo.length).toBe(PREVIEW * PREVIEW * 4);
    }
    expect(rampPending()).toBe(MATERIAL_NAMES.length);
  });

  it('declares a preview cheaper than the full set by a wide margin', () => {
    expect(PREVIEW_TEXTURE_SIZE).toBeLessThan(TEXTURE_SIZE);
    // Generation cost is per texel, so the preview pass must be at least an
    // order of magnitude cheaper or it is just the same stall, earlier.
    const ratio = (TEXTURE_SIZE * TEXTURE_SIZE) / (PREVIEW_TEXTURE_SIZE * PREVIEW_TEXTURE_SIZE);
    expect(ratio).toBeGreaterThanOrEqual(16);
  });

  it('finishes at most one material per step, never the whole set', () => {
    startRamp(PREVIEW, FULL);
    let steps = 0;
    let finished = 0;
    while (rampPending() > 0) {
      const done = stepRamp();
      steps += 1;
      if (done != null) {
        finished += 1;
        expect(done.size).toBe(FULL);
      }
      // The invariant that matters: after any number of steps, no more than one
      // material has been finished per step, so a frame cannot carry the set.
      expect(finished).toBeLessThanOrEqual(steps);
      expect(steps).toBeLessThanOrEqual(MATERIAL_NAMES.length * STAGES_PER_MATERIAL);
    }
    expect(finished).toBe(MATERIAL_NAMES.length);
    expect(steps).toBe(MATERIAL_NAMES.length * STAGES_PER_MATERIAL);
  });

  it('splits each material across more than one step', () => {
    // One material per frame is still ~90ms of derivation in a browser. The
    // generate half and the derive half are separate steps for that reason.
    expect(STAGES_PER_MATERIAL).toBeGreaterThan(1);
    startRamp(PREVIEW, FULL);
    expect(stepRamp()).toBeNull();
  });

  it('leaves every material at full resolution when the ramp is spent', () => {
    startRamp(PREVIEW, FULL);
    while (rampPending() > 0) stepRamp();

    const maps = rampMaps();
    expect(maps).not.toBeNull();
    for (const name of MATERIAL_NAMES) {
      expect(maps![name].size).toBe(FULL);
    }
    expect(rampBytes()).toBe(textureBytes(FULL, MATERIAL_NAMES.length * MAPS_PER_MATERIAL));
    expect(rampReports()).toHaveLength(MATERIAL_NAMES.length);
    for (const report of rampReports()) {
      expect(report.hasNormal).toBe(true);
      expect(report.hasRoughness).toBe(true);
    }
  });

  it('does no work once it is spent, so a steady frame costs nothing', () => {
    startRamp(PREVIEW, FULL);
    while (rampPending() > 0) stepRamp();
    const bytes = rampBytes();
    expect(stepRamp()).toBeNull();
    expect(rampPending()).toBe(0);
    expect(rampBytes()).toBe(bytes);
  });

  it('accepts a set derived elsewhere and drops that material from the queue', () => {
    // The worker path derives off the main thread entirely; the ramp is still
    // the one place that knows which materials are outstanding.
    startRamp(PREVIEW, FULL);
    const before = rampPending();
    const msBefore = rampGeneratedMs();

    completeRamp(buildMaterialMaps('wood', FULL), 42);

    expect(rampPending()).toBe(before - 1);
    expect(rampMaps()!['wood'].size).toBe(FULL);
    // Time spent off the main thread is still generation time the page paid for.
    expect(rampGeneratedMs()).toBeGreaterThanOrEqual(msBefore + 42);
    // And the stepped fallback never re-derives what already arrived.
    while (rampPending() > 0) stepRamp();
    expect(rampMaps()!['wood'].size).toBe(FULL);
  });

  it('is spent once every material has been completed from elsewhere', () => {
    startRamp(PREVIEW, FULL);
    for (const name of MATERIAL_NAMES) completeRamp(buildMaterialMaps(name, FULL), 1);
    expect(rampPending()).toBe(0);
    expect(stepRamp()).toBeNull();
    expect(rampBytes()).toBe(textureBytes(FULL, MATERIAL_NAMES.length * MAPS_PER_MATERIAL));
  });
});
