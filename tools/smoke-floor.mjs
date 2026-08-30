/**
 * Single declared FPS floor for the headless smoke harness. Set low enough that a
 * software-rendered SwiftShader pass clears it, so the gate measures "is the frame
 * loop running" rather than "is the GPU fast today".
 */
export const SMOKE_FPS_FLOOR = 5;
