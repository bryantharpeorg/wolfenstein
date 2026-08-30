/**
 * The minimum FPS the smoke harness requires the running page to maintain.
 *
 * This floor is deliberately low: it must be cleared by headless Chromium using
 * SwiftShader software rendering. The constant is the single place the threshold
 * is declared, so software-rendered CI runs can be told apart from real
 * regressions by changing only this value (see spec.md Edge Cases, SC-005).
 */
export const SMOKE_FPS_FLOOR = 5;
