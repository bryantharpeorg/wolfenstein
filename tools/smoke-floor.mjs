/**
 * Single named FPS floor for the smoke harness. Set low enough that a headless
 * Chromium pass using SwiftShader software rendering still clears it, so the gate
 * measures "the frame loop is running" rather than "the GPU is fast today".
 */
export const SMOKE_FPS_FLOOR = 5;
