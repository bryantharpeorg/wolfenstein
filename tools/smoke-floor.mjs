/**
 * The single declared FPS floor used by the smoke harness.
 *
 * It is intentionally low: the gate must distinguish "the frame loop is running"
 * from "the GPU is fast today", so a SwiftShader software-rendering pass in
 * headless Chromium clears it.
 */
export const SMOKE_FPS_FLOOR = 15;
