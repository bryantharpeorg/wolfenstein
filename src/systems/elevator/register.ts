/**
 * The elevator system (order 80): the DOM edge of US1. Every decision lives in
 * `src/run/` and is asserted without a page; this file resolves the press, steps
 * the run and registers the reset (FR-001, FR-002, FR-003). Neither `src/main.ts`
 * nor `src/diag/diag.ts` is edited — 001's glob discovery finds this file, and the
 * run is not yet legible from outside, which is US2's to publish.
 *
 * On 004's FR-005 this installs a second *listener*, not a second command path,
 * exactly as the secrets system does: both key codes still resolve through the one
 * table in `bindings.ts`, and only a press that actually found the `E` tile speaks
 * for the level — otherwise the doors system's own answer, `no-target` included,
 * is the reason the press had.
 *
 * Order 80 is after enemies (60), combat (70) and vitals (75), so the press reads
 * this frame's health and the run is stepped once everything that could end it has
 * run.
 */
import { defineSystem, type GameContext } from '../../boot/registry';
import { commandForEvent } from '../../interaction/bindings';
import {
  ensureInteractionDiag,
  recordOutcome,
  type InteractionDiagnostics,
} from '../../interaction/interaction-diag';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { registerResettable } from '../../combat/restart';
import { resolveElevator } from '../../run/elevator';
import {
  beginElevatorExit,
  createRun,
  resetRunTimeline,
  setLiveRun,
  setRunDead,
  stepRun,
  type RunTimeline,
  type RunTransition,
} from '../../run/state';

let run: RunTimeline | null = null;
// The transition this frame's `stepRun` returned, held rather than announced: the machine
// returns it precisely so a later story can observe `complete` (008 FR-007).
let lastTransition: RunTransition | null = null;
let interaction: InteractionDiagnostics | null = null;
let combat: CombatDiagnostics | null = null;

/** The live run, or null before setup. US2 reads the state, the timer and the
 *  lift's progress through this rather than keeping a second copy of them. */
export function getRunTimeline(): RunTimeline | null {
  return run;
}

/** This frame's transition, or null. Read by the stats-screen system, which runs after
 *  this one, so a `complete` arrival is seen on the frame it happened, exactly once. */
export function getLastRunTransition(): RunTransition | null {
  return lastTransition;
}

/** 007's restart (FR-011), applied to this spec's run: back to `playing` with the
 *  elevator closed and the travel that was pending discarded (Edge Cases). */
export function resetElevatorRun(): void {
  if (run != null) resetRunTimeline(run);
  // A transition from the run that just ended is not the new run's to report.
  lastTransition = null;
}

function playerPosition(ctx: GameContext): { x: number; z: number } {
  const player = ctx.diag.player;
  return player == null
    ? { x: ctx.camera.position.x, z: ctx.camera.position.z }
    : { x: player.x, z: player.z };
}

/** One press, resolved through `src/run/elevator.ts` and nowhere else. */
function pressUse(ctx: GameContext): void {
  if (run == null) return;
  const position = playerPosition(ctx);
  const resolution = resolveElevator({
    playerX: position.x,
    playerZ: position.z,
    health: combat?.health ?? 0,
    state: run.state,
  });

  // A press that found no elevator is not this system's to answer for.
  if (resolution.exit == null) return;

  if (resolution.outcome === 'exit-used') beginElevatorExit(run);
  if (interaction != null) recordOutcome(interaction, resolution.outcome);
}

defineSystem({
  name: 'elevator',
  order: 80,

  setup(ctx) {
    run = createRun();
    // Published as the one run every gate consults, so 006's and 007's systems
    // read a phase rather than importing this file.
    setLiveRun(run);
    interaction = ensureInteractionDiag(ctx.diag);
    combat = ensureCombatDiag(ctx.diag);

    registerResettable('run', resetElevatorRun);

    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (commandForEvent(event) == null) return;
      event.preventDefault();
      pressUse(ctx);
    });
  },

  update(_ctx, deltaMs) {
    if (run == null) return;
    // 007 owns the player's health; this follows it rather than deciding it, so
    // a run that ended in a corridor is `dead` and one in the lift is not.
    setRunDead(run, combat?.dead === true);
    // The frame delta, unclamped: the run timer is wall-clock (FR-004), and the
    // travel splits a delta at its arrival rather than skipping past it.
    lastTransition = stepRun(run, deltaMs);
  },
});
