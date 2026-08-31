/**
 * The vitals system (order 75): the render edge of US2. Every decision lives in
 * `src/combat/`; this file applies 006's already-computed damage, closes
 * `run-state.ts`'s gate the frame health reaches zero, presents the prompt, binds
 * restart dead or alive, and publishes `health`, `score`, `dead`, `deaths` and
 * `restarts` into `__diag.combat` (FR-009..FR-012). `src/main.ts` is not edited:
 * 001's glob discovery finds this file.
 *
 * Order 75 is after enemies (60), so this frame's shots are this frame's damage,
 * and after combat (70), so a guard the player killed is already counted in
 * `__diag.combat.kills`. That ordering resolves the simultaneous death: kills
 * score *before* damage applies, so a guard killed on the tick its shot killed
 * the player still scores, and the one-way transition counts that death once
 * (Edge Cases, US2-S5, US2-S10).
 */
import { defineSystem, type GameContext } from '../../boot/registry';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { installResetAdapters } from '../../combat/reset-adapters';
import {
  RESTART_EXEMPT_FIELDS,
  registerResettable,
  requestRestart,
  restartCount,
  serviceRestart,
  snapshotRunState,
  type RunSnapshot,
} from '../../combat/restart';
import { resetRunState, setCommandsResolve } from '../../combat/run-state';
import { addScore, createScore, resetScore, SCORE_TABLE, type ScoreState } from '../../combat/score';
import {
  applyDamage,
  createVitals,
  isDead,
  resetVitals,
  type PlayerVitals,
} from '../../combat/vitals';
import { getLastTickReport } from '../enemies/register';

/** Bound to restart (FR-011). Not a player *command*, so deliberately not behind
 *  the run-state gate death closes — that is what makes it issuable dead. */
export const RESTART_KEY_CODES = ['KeyR'] as const;

/** The id the prompt element carries. */
export const RESTART_PROMPT_ID = 'restart-prompt';

const RESTART_PROMPT_TEXT = 'YOU DIED - press R to restart';

/** The scripted-input seam, in the shape 003's `__playerDrive` established: an
 *  input for the smoke gate, not a gameplay path (FR-019). */
export interface CombatHarness {
  /** Applies `amount` exactly as a resolved guard shot would, clamp and all. */
  damage(amount: number): number;
  /** Issued now, serviced at the top of the next frame. */
  restart(): void;
  /** A DOM fact `__diag` has no field for; health, score and `dead` are read
   *  from `__diag.combat` instead. */
  promptVisible(): boolean;
  /** The first frame's snapshot and the one after the last completed reset, each
   *  null until taken (US2-S8). */
  firstFrame(): RunSnapshot | null;
  restartFrame(): RunSnapshot | null;
  /** The exempt field names, read rather than restated (FR-019). */
  exempt(): readonly string[];
}

declare global {
  interface Window {
    __combat?: CombatHarness;
  }
}

let context: GameContext | null = null;
let combat: CombatDiagnostics | null = null;
let vitals: PlayerVitals | null = null;
let score: ScoreState | null = null;
let prompt: HTMLElement | null = null;

/** Kills already scored, so one guard's death pays once (FR-012). */
let scoredKills = 0;

// SC-002's two readings, taken in the page rather than by a harness racing the
// render loop: one frame after setup and one frame after a completed reset, so
// each has seen the same simulation and a difference is a leak rather than a
// timing artefact (US2-S8, FR-019).
let firstSnapshot: RunSnapshot | null = null;
let restartSnapshot: RunSnapshot | null = null;
let captureNextFrame = false;

function setPromptVisible(visible: boolean): void {
  if (prompt != null) prompt.style.display = visible ? 'block' : 'none';
}

/** Per Constitution II: no font file and no named system family. A prompt, not a
 *  measured readout — US4's HUD strokes its own glyphs. */
function createPrompt(): HTMLElement {
  const element = document.createElement('div');
  element.id = RESTART_PROMPT_ID;
  element.textContent = RESTART_PROMPT_TEXT;
  element.style.cssText =
    'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);' +
    'padding:0.6rem 1rem;color:#f33;background:rgba(0,0,0,0.7);' +
    'letter-spacing:0.1em;pointer-events:none;z-index:1001;display:none';
  document.body.appendChild(element);
  return element;
}

function publish(): void {
  if (combat == null || vitals == null || score == null) return;
  combat.health = vitals.health;
  combat.score = score.points;
  combat.dead = isDead(vitals);
  combat.deaths = vitals.deaths;
  combat.restarts = restartCount();
}

/** This story's own reset (FR-011): health, score, the gate and the prompt. The
 *  cross-spec state is `reset-adapters.ts`'s; the session counters are nobody's
 *  to clear (US2-S8). */
function resetVitalsRun(): void {
  if (vitals != null) resetVitals(vitals);
  if (score != null) resetScore(score);
  scoredKills = 0;
  // Reopened, so a run restarted from death moves and fires again.
  resetRunState();
  setPromptVisible(false);
}

/** Guards put down since the last frame, paid at the table's rate. Read from the
 *  published count, so this file holds no second opinion of what a kill is. */
function scoreKills(): void {
  if (combat == null || score == null) return;
  const killed = combat.kills - scoredKills;
  if (killed <= 0) return;
  scoredKills = combat.kills;
  addScore(score, SCORE_TABLE.guardKill * killed);
}

/** One frame's guard damage, from 006's tick report unchanged: the falloff was
 *  the attack module's to compute, never recomputed here (FR-009). */
function takeGuardDamage(): void {
  if (vitals == null) return;
  const report = applyDamage(vitals, getLastTickReport().damageToPlayer);
  if (!report.died) return;

  // Health reached zero (FR-010): the gate shuts, so movement and firing stop
  // resolving while the render loop carries on.
  setCommandsResolve(false);
  setPromptVisible(true);
}

function bindRestart(): void {
  const codes = new Set<string>(RESTART_KEY_CODES);
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!codes.has(event.code)) return;
    event.preventDefault();
    // Coalesced by `restart.ts`: two presses are one reset (Edge Cases).
    requestRestart();
  });
}

function installHarness(): void {
  window.__combat = {
    damage(amount) {
      if (vitals == null) return 0;
      const report = applyDamage(vitals, amount);
      if (report.died) {
        setCommandsResolve(false);
        setPromptVisible(true);
      }
      publish();
      return vitals.health;
    },
    restart: requestRestart,
    promptVisible: () => prompt?.style.display === 'block',
    firstFrame: () => firstSnapshot,
    restartFrame: () => restartSnapshot,
    exempt: () => RESTART_EXEMPT_FIELDS,
  };
}

defineSystem({
  name: 'vitals',
  order: 75,

  setup(ctx: GameContext) {
    context = ctx;
    combat = ensureCombatDiag(ctx.diag);
    vitals = createVitals();
    score = createScore();
    prompt = createPrompt();

    // This story's own reset first, so the gate is open again before another
    // spec's adapter reads anything that depends on it.
    registerResettable('vitals', resetVitalsRun);
    installResetAdapters();

    bindRestart();
    installHarness();
    publish();
  },

  update() {
    if (combat == null || vitals == null || score == null) return;

    // Serviced at the top of the frame, so a restart issued on the frame of
    // death lands before this frame's damage — of which there is none.
    const outcome = serviceRestart();

    scoreKills();
    takeGuardDamage();
    publish();

    if (context == null) return;
    const taken = snapshotRunState(context.diag);
    firstSnapshot ??= taken;
    if (captureNextFrame) {
      restartSnapshot = taken;
      captureNextFrame = false;
    }
    // Set after the capture, so a reset performed this frame is read on the
    // next one.
    if (outcome.performed) captureNextFrame = true;
  },
});
