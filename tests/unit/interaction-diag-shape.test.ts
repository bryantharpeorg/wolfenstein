import { describe, it, expect } from 'vitest';
import { createDiagnostics, type Diagnostics } from '../../src/diag/diag';
import {
  ensureInteractionDiag,
  recordOutcome,
  setDoorCounts,
  setKeyConsumed,
  setKeyCounts,
  setSecretCounts,
} from '../../src/interaction/interaction-diag';
import { INTERACT_OUTCOMES } from '../../src/interaction/outcomes';
import { LEVEL_GRID } from '../../src/level';
import { SECRET_TRAVEL_MS } from '../../src/interaction/secret';
import {
  buildSecretField,
  interactWithSecrets,
  publishSecretCounts,
  secretsFound,
  secretsTotal,
} from '../../src/interaction/secret-field';
import { advanceField, pushFrom } from './secret-support';

// The fields 001 and 002 own: FR-017 is additive over both contracts, so this
// list is what "no existing field renamed, removed or repurposed" means.
const OWNED_BY_001 = ['ready', 'renderer', 'fps', 'frameTimeMs', 'drawCalls', 'errors'] as const;
const OWNED_BY_002 = ['level'] as const;

// FR-017's whole field set, in one place, so a missing field names itself.
const FR_017_FIELDS = [
  'doorsTotal',
  'doorsOpen',
  'secretsFound',
  'secretsTotal',
  'keys',
  'lastReason',
  'lastRefusalKeyKind',
  'keyConsumed',
] as const;

/** The diagnostics object as the page publishes it: 001's, with the interaction
 * object every system ensures. */
function published(): Diagnostics {
  const diag = createDiagnostics('webgl');
  ensureInteractionDiag(diag);
  return diag;
}

describe('__diag.interaction carries FR-017 in full (US3-S8)', () => {
  it('carries every declared field after the first frame, typed as the harness reads it', () => {
    const interaction = published().interaction!;
    for (const field of FR_017_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(interaction, field)).toBe(true);
    }
    // The zero-initialised object is exactly FR-017's set; the running page adds
    // `secretRemainingTiles`, which US3 declares by augmentation and nothing else.
    expect(Object.keys(interaction).sort()).toEqual([...FR_017_FIELDS].sort());
    expect(Number.isInteger(interaction.doorsTotal)).toBe(true);
    expect(Number.isInteger(interaction.doorsOpen)).toBe(true);
    expect(Number.isInteger(interaction.secretsFound)).toBe(true);
    expect(Number.isInteger(interaction.secretsTotal)).toBe(true);
    expect(interaction.keys).toEqual({ silver: 0, gold: 0 });
    expect(interaction.lastReason).toBeNull();
    expect(interaction.lastRefusalKeyKind).toBeNull();
    expect(interaction.keyConsumed).toBe(false);
  });

  it('is stable in shape across reads and across every setter', () => {
    const diag = published();
    const shape = Object.keys(diag.interaction!).sort();
    setDoorCounts(diag.interaction!, 5, 2);
    setSecretCounts(diag.interaction!, 1, 2);
    setKeyCounts(diag.interaction!, { silver: 1, gold: 0 });
    setKeyConsumed(diag.interaction!, false);
    for (const outcome of INTERACT_OUTCOMES) recordOutcome(diag.interaction!, outcome, 'silver');
    expect(Object.keys(diag.interaction!).sort()).toEqual(shape);
    expect(ensureInteractionDiag(diag)).toBe(diag.interaction);
    expect(Object.keys(diag.interaction!).sort()).toEqual(shape);
  });

  it('leaves every field 001 and 002 own intact beside it', () => {
    const snapshot = JSON.stringify(createDiagnostics('webgl'));
    const diag = createDiagnostics('webgl');
    ensureInteractionDiag(diag);
    setSecretCounts(diag.interaction!, 2, 2);
    setDoorCounts(diag.interaction!, 5, 5);
    for (const field of [...OWNED_BY_001, ...OWNED_BY_002]) {
      expect(Object.prototype.hasOwnProperty.call(diag, field)).toBe(true);
    }
    const { interaction, ...rest } = diag;
    expect(interaction).not.toBeUndefined();
    expect(JSON.stringify(rest)).toBe(snapshot);
    // `interaction` is the only key 001's object gained.
    const bare = Object.keys(createDiagnostics('webgl')).sort();
    expect(Object.keys(diag).sort()).toEqual([...bare, 'interaction'].sort());
  });

  it('names `lastReason` only from the declared outcome set', () => {
    const diag = published();
    for (const outcome of INTERACT_OUTCOMES) {
      recordOutcome(diag.interaction!, outcome);
      expect(INTERACT_OUTCOMES).toContain(diag.interaction!.lastReason);
    }
  });
});

describe('secretsFound never exceeds secretsTotal (US3-S5, US3-S8, FR-018)', () => {
  it('holds at every observation while the shipped secrets are pushed', () => {
    const interaction = published().interaction!;
    const field = buildSecretField(LEVEL_GRID);
    publishSecretCounts(interaction, field);
    expect(interaction.secretsTotal).toBe(secretsTotal(field));
    expect(interaction.secretsFound).toBe(0);

    let previous = interaction.secretsFound;
    for (let pass = 0; pass < 3; pass += 1) {
      for (const secret of field.secrets) {
        interactWithSecrets(field, ...pushFrom(field, secret.x, secret.z));
        advanceField(field, SECRET_TRAVEL_MS / 3);
        publishSecretCounts(interaction, field);
        expect(interaction.secretsFound).toBeGreaterThanOrEqual(previous);
        expect(interaction.secretsFound).toBeLessThanOrEqual(interaction.secretsTotal);
        expect(Number.isInteger(interaction.secretsFound)).toBe(true);
        previous = interaction.secretsFound;
      }
    }
    expect(interaction.secretsFound).toBe(interaction.secretsTotal);
    expect(interaction.secretsFound).toBe(secretsFound(field));
  });
});

