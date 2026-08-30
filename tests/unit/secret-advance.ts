// Shared stepping helpers for the secret suite: a push-wall is advanced the way a
// frame loop would, in ticks of a stated size, so a test names a wall-clock
// duration rather than a frame count. Mirrors `door-advance.ts`; not a test file,
// because vitest collects only `*.test.ts`.

import { stepSecret, type Secret } from '../../src/interaction/secret';
import { stepSecrets, type SecretField } from '../../src/interaction/secret-field';

export function advanceSecret(secret: Secret, totalMs: number, tickMs = 100): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const step = Math.min(tickMs, remaining);
    stepSecret(secret, step);
    remaining -= step;
  }
}

export function advanceField(field: SecretField, totalMs: number, tickMs = 100): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const step = Math.min(tickMs, remaining);
    stepSecrets(field, step);
    remaining -= step;
  }
}
