/**
 * The vitals system (order 75): the render edge of US2. Every decision lives in
 * `src/combat/`; this file applies 006's damage, closes `run-state.ts`'s gate the
 * frame health reaches zero, presents the prompt, binds restart dead or alive, and
 * publishes into `__diag.combat` (FR-009..FR-012). 001's glob discovery finds it, so
 * `src/main.ts` is not edited. Order 75 is after enemies (60) and combat (70), which
 * resolves the simultaneous death: kills score *before* damage applies, so a guard
 * killed on the tick its shot killed the player still scores (US2-S5, S10).
 */
import { defineSystem, type GameContext } from '../../boot/registry';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { installResetAdapters, syncPlayerDiag } from '../../combat/reset-adapters';
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

/** Not a player *command*, so not behind the gate death closes — which is what
 *  makes restart issuable dead (FR-011). */
export const RESTART_KEY_CODES = ['KeyR'] as const;

export const RESTART_PROMPT_ID = 'restart-prompt';

const RESTART_PROMPT_TEXT = 'YOU DIED - press R to restart';

/** The scripted-input seam, in the shape 003's `__playerDrive` established (FR-019). */
export interface CombatHarness {
  /** Applies `amount` exactly as a resolved guard shot would, clamp and all. */
  damage(amount: number): number;
  /** Issued now, serviced at the top of the next frame. */
  restart(): void;
  /** A DOM fact `__diag` has no field for. */
  promptVisible(): boolean;
  /** The spawn snapshot and the one from the last completed reset (US2-S8). */
  firstFrame(): RunSnapshot | null;
  restartFrame(): RunSnapshot | null;
  exempt(): readonly string[];
}

declare global {
  interface Window {
    __combat?: CombatHarness;
  }
}

/** The live vitals and score, and the republish that puts them back into
 *  `__diag.combat` (FR-018). The handle US3's pickups heal and pay through, in the
 *  shape `getFireControl()` and `getKeyRunState()` already established: a health or
 *  treasure pickup must move *this* run's numbers, and a second copy of them here
 *  would be a second opinion of the player's health. */
export interface VitalsRunState {
  readonly vitals: PlayerVitals;
  readonly score: ScoreState;
  readonly publish: () => void;
}

export function getVitalsRunState(): VitalsRunState | null {
  return vitals == null || score == null ? null : { vitals, score, publish };
}

let context: GameContext | null = null;
let combat: CombatDiagnostics | null = null;
let vitals: PlayerVitals | null = null;
let score: ScoreState | null = null;
let prompt: HTMLElement | null = null;

/** So one guard's death pays once (FR-012). */
let scoredKills = 0;

// SC-002's two readings, taken in the page rather than by a harness racing the
// render loop (US2-S8). Both at the same simulation age — zero: one at setup, one on
// the frame the reset completed. Equal age is what makes a difference mean "the
// restart leaked". "One frame" is not an age: guards step on a fixed 50ms
// accumulator, so a frame is zero ticks when frames are quick and up to
// `MAX_TICKS_PER_FRAME` when they are slow, and reading either a frame later would
// fail on a slow machine over 006's behaviour rather than a leak.
let firstSnapshot: RunSnapshot | null = null;
let restartSnapshot: RunSnapshot | null = null;

function setPromptVisible(visible: boolean): void {
  if (prompt != null) prompt.style.display = visible ? 'block' : 'none';
}

/** Constitution II: no font file, no named system family. */
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

/** This story's own reset (FR-011). Cross-spec state is `reset-adapters.ts`'s; the
 *  session counters are nobody's to clear (US2-S8). */
function resetVitalsRun(): void {
  if (vitals != null) resetVitals(vitals);
  if (score != null) resetScore(score);
  scoredKills = 0;
  // Reopened, so a run restarted from death moves and fires again.
  resetRunState();
  setPromptVisible(false);
}

/** Guards put down since the last frame, at the table's rate — read from the
 *  published count, so this file holds no second opinion of a kill. */
function scoreKills(): void {
  if (combat == null || score == null) return;
  const killed = combat.kills - scoredKills;
  if (killed <= 0) return;
  scoredKills = combat.kills;
  addScore(score, SCORE_TABLE.guardKill * killed);
}

/** One frame's guard damage, from 006's tick report unchanged — the falloff was
 *  the attack module's to compute (FR-009). */
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
    // Coalesced by `restart.ts`: two presses are one reset.
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

    // This story's reset first, so the gate is open before another spec's adapter
    // reads anything that depends on it.
    registerResettable('vitals', resetVitalsRun);
    installResetAdapters(ctx.diag);

    bindRestart();
    installHarness();
    publish();

    // The spawn reading. 003 places the player in its setup (order 34) but
    // publishes from `update()`, so `__diag.player` reads zeroes here; the sync a
    // reset performs makes this the spawn values. Every other publisher sets up
    // ahead of order 75.
    syncPlayerDiag(ctx.diag);
    firstSnapshot = snapshotRunState(ctx.diag);
  },

  update() {
    if (combat == null || vitals == null || score == null) return;

    // Serviced at the top of the frame, so a restart issued on the frame of
    // death lands before this frame's damage — of which there is none.
    const outcome = serviceRestart();

    // Read immediately, while the reset is all that has touched the run this
    // frame: every adapter republished its `__diag` fields as it reset them, so
    // this is the whole run at its spawn values, unstepped.
    if (outcome.performed) {
      publish();
      if (context != null) restartSnapshot = snapshotRunState(context.diag);
    }

    scoreKills();
    takeGuardDamage();
    publish();
  },
});
