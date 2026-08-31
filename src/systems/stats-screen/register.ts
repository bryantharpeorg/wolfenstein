/**
 * The stats-screen system (order 95): the render edge of US2 (FR-005..FR-008). Every
 * decision lives in `src/run/stats.ts`, `src/run/rating.ts` and `src/run/completions.ts`
 * and is asserted without a page; this file composites those strings into one texture,
 * publishes `__diag.run`, and binds restart to 007's command. 001's glob discovery finds
 * it, so neither `src/main.ts` nor `src/diag/diag.ts` is edited by this story.
 *
 * Order 95 is after the HUD's 90 and after everything that publishes a counter: combat
 * at 70, vitals at 75, the elevator at 80. So the figures this frame reports are *this*
 * frame's, and the `complete` transition the elevator made at 80 is counted at 95 in the
 * same frame it happened.
 *
 * Three properties are load-bearing.
 *
 * The screen and `__diag.run` are drawn from one `RunStats` value per frame (FR-006), so
 * there is no path by which the canvas and the harness disagree — US2-S2 is true by
 * construction rather than by two reads that happen to match.
 *
 * Every mark is a stroke from 007's `glyphs.ts`, drawn through `compose.ts`'s one text
 * renderer. There is no second text renderer, no canvas text API and no font file
 * (US2-S5); a character with no entry in that table draws nothing, and `run-stats.test.ts`
 * asserts the screen's whole vocabulary is in it.
 *
 * Restart calls `requestRestart()` from `src/combat/restart.ts` and nothing else
 * (FR-007). No second reset path, no fields put back here: the run timer returns to zero
 * because the elevator system registered `resetRunTimeline` as a resettable, and every
 * other field returns because 007's registry already knew about it.
 */
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { requestRestart } from '../../combat/restart';
import { drawGlyphText } from '../../hud/compose';
import { textWidth } from '../../hud/glyphs';
import { ensureInteractionDiag, type InteractionDiagnostics } from '../../interaction/interaction-diag';
import { countCompletion } from '../../run/completions';
import { ensureRunDiag, publishRunDiagnostics, type RunDiagnostics } from '../../run/diag';
import { ratingFor } from '../../run/rating';
import {
  STATS_RESTART_PROMPT,
  STATS_TITLE,
  projectRunStats,
  statsScreenLines,
  type RunStats,
  type StatsLine,
} from '../../run/stats';
import { currentRunState } from '../../run/state';
import { getLastRunTransition, getRunTimeline } from '../elevator/register';

const SCREEN_CANVAS_WIDTH = 1024, SCREEN_CANVAS_HEIGHT = 640;

/** In front of the HUD's 0.2 and above its render order, so a completed run reads over
 *  the readout rather than under it (Edge Cases). */
const SCREEN_DISTANCE = 0.15, SCREEN_RENDER_ORDER = 1100;

const DEGREES_TO_RADIANS = Math.PI / 180;

const TITLE_SIZE = 64, LABEL_SIZE = 40, VALUE_SIZE = 40, PROMPT_SIZE = 28;
const BACKGROUND = 'rgba(8,9,13,0.88)';
const TITLE_INK = '#e8c14a', LABEL_INK = '#8a94a8', VALUE_INK = '#e8e2c8', PROMPT_INK = '#cfd6e0';
const TITLE_ROW = 72, FIRST_ROW = 200, ROW_HEIGHT = 62, PROMPT_ROW = 570;
const LABEL_COLUMN = 190, VALUE_COLUMN = 560;

/** The key the screen offers. 007 binds the same code to the same command already; this
 *  is the stats screen's own affordance for it, and `requestRestart` coalesces, so a
 *  press seen by both bindings is still one reset (FR-007). */
const RESTART_KEY_CODE = 'KeyR';

interface Surface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  signature: string | null;
}

let combat: CombatDiagnostics | null = null;
let interaction: InteractionDiagnostics | null = null;
let runDiag: RunDiagnostics | null = null;
let surface: Surface | null = null;
let texture: CanvasTexture | null = null;
let quad: Mesh | null = null;

/** What the screen last composited, so the harness can read as text what a texture
 *  cannot give back — in the shape `window.__hud` established (US2-S1, US2-S2). */
export interface RunHarness {
  /** 007's restart command, issued exactly as the screen's own key issues it. */
  restart(): void;
  /** Whether the screen is drawn this frame. */
  visible(): boolean;
  /** The lines last composited, label and value, or null before the first one. */
  lines(): readonly StatsLine[] | null;
}

declare global {
  interface Window {
    __run?: RunHarness;
  }
}

let drawn: readonly StatsLine[] | null = null;

function createSurface(): Surface | null {
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_CANVAS_WIDTH;
  canvas.height = SCREEN_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  return context == null ? null : { canvas, context, signature: null };
}

function fitQuad(ctx: GameContext): void {
  if (quad == null) return;
  const viewHeight = 2 * SCREEN_DISTANCE * Math.tan((ctx.camera.fov * DEGREES_TO_RADIANS) / 2);
  const width = viewHeight * ctx.camera.aspect;
  const height = (width * SCREEN_CANVAS_HEIGHT) / SCREEN_CANVAS_WIDTH;
  quad.scale.set(width, Math.min(height, viewHeight), 1);
  quad.position.set(0, 0, -SCREEN_DISTANCE);
}

/** Composites the screen and reports whether the canvas changed, so a screen left on
 *  the page re-uploads no texture per frame. */
function drawScreen(target: Surface, lines: readonly StatsLine[]): boolean {
  const signature = lines.map((line) => `${line.label}=${line.value}`).join('|');
  if (signature === target.signature) return false;
  target.signature = signature;

  const context = target.context;
  context.clearRect(0, 0, SCREEN_CANVAS_WIDTH, SCREEN_CANVAS_HEIGHT);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, SCREEN_CANVAS_WIDTH, SCREEN_CANVAS_HEIGHT);

  const title = (SCREEN_CANVAS_WIDTH - textWidth(STATS_TITLE, TITLE_SIZE)) / 2;
  drawGlyphText(context, STATS_TITLE, title, TITLE_ROW, TITLE_SIZE, TITLE_INK);

  lines.forEach((line, index) => {
    const row = FIRST_ROW + index * ROW_HEIGHT;
    drawGlyphText(context, line.label, LABEL_COLUMN, row, LABEL_SIZE, LABEL_INK);
    drawGlyphText(context, line.value, VALUE_COLUMN, row, VALUE_SIZE, VALUE_INK);
  });

  const prompt = (SCREEN_CANVAS_WIDTH - textWidth(STATS_RESTART_PROMPT, PROMPT_SIZE)) / 2;
  drawGlyphText(context, STATS_RESTART_PROMPT, prompt, PROMPT_ROW, PROMPT_SIZE, PROMPT_INK);
  return true;
}

/**
 * This frame's counters, read from the objects that own them and copied into nothing
 * else (FR-006).
 *
 * `guardsTotal` is the length of the roster 006 publishes rather than a constant read
 * from the level: the total the screen reports has to be the total the kill counter is
 * counting against, and 006's roster is that.
 */
function readCounters(ctx: GameContext): RunStats {
  const run = getRunTimeline();
  return projectRunStats({
    elapsedMs: run?.elapsedMs ?? 0,
    kills: combat?.kills ?? 0,
    guardsTotal: ctx.diag.enemies.length,
    secretsFound: interaction?.secretsFound ?? 0,
    secretsTotal: interaction?.secretsTotal ?? 0,
    treasureFound: combat?.treasureFound ?? 0,
    treasureTotal: combat?.treasureTotal ?? 0,
    score: combat?.score ?? 0,
  });
}

function bindRestart(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code !== RESTART_KEY_CODE) return;
    // Only from the screen: elsewhere this press is 007's to answer, and answering it
    // twice here would be this story holding an opinion about restart while alive.
    if (currentRunState() !== 'complete') return;
    event.preventDefault();
    requestRestart();
  });
}

defineSystem({
  name: 'stats-screen',
  order: 95,

  setup(ctx) {
    combat = ensureCombatDiag(ctx.diag);
    interaction = ensureInteractionDiag(ctx.diag);
    runDiag = ensureRunDiag(ctx.diag);

    if (ctx.camera.parent == null) ctx.scene.add(ctx.camera);

    surface = createSurface();
    if (surface != null) {
      texture = new CanvasTexture(surface.canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;

      quad = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }),
      );
      quad.renderOrder = SCREEN_RENDER_ORDER;
      quad.frustumCulled = false;
      // Hidden until the run completes: a screen nobody is looking at still costs a
      // draw call, and 002's budget is not this story's to spend (SC-006).
      quad.visible = false;
      ctx.camera.add(quad);
      fitQuad(ctx);
    }

    bindRestart();

    window.__run = {
      restart: requestRestart,
      visible: () => quad?.visible === true,
      lines: () => drawn,
    };
  },

  update(ctx) {
    if (runDiag == null) return;

    // The `complete` arrival the elevator system made at order 80 this frame, counted
    // once and only here (FR-007, US2-S8).
    const completions = countCompletion(getLastRunTransition());

    const state = currentRunState();
    const stats = readCounters(ctx);
    const rating = ratingFor(stats.killPercent, stats.secretPercent, stats.treasurePercent);

    // One projection, published and drawn — the displayed values and the reported ones
    // have one source (FR-006, FR-008, US2-S2).
    publishRunDiagnostics(runDiag, state, stats, rating, completions);

    const complete = state === 'complete';
    if (quad != null) quad.visible = complete;
    if (!complete || surface == null) {
      drawn = null;
      return;
    }

    const lines = statsScreenLines(stats, rating);
    if (drawScreen(surface, lines) && texture != null) texture.needsUpdate = true;
    drawn = lines;
  },

  resize(ctx) {
    fitQuad(ctx);
  },
});
