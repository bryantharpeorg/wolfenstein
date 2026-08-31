/**
 * The stats-screen system (order 95): the render edge of US2 (FR-005..FR-008). Every
 * decision lives in `src/run/stats.ts`, `rating.ts` and `completions.ts` and is asserted
 * without a page; this file composites those strings, publishes `__diag.run` and binds
 * restart to 007's command. 001's glob discovery finds it, so no shared file is edited.
 *
 * Order 95 is after the HUD's 90 and after every counter — combat 70, vitals 75, elevator
 * 80 — so the `complete` transition made at 80 is counted at 95 in the frame it happened.
 * Screen and `__diag.run` come from one `RunStats` per frame (FR-006), so US2-S2 holds by
 * construction. Every mark is a stroke from 007's `glyphs.ts` through `compose.ts`'s one
 * text renderer: no second renderer, no canvas text API, no font file (US2-S5).
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

/** 007 binds the same code to the same command, and `requestRestart` coalesces, so a
 *  press both bindings see is still one reset (FR-007). */
const RESTART_KEY_CODE = 'KeyR';

let combat: CombatDiagnostics | null = null;
let interaction: InteractionDiagnostics | null = null;
let runDiag: RunDiagnostics | null = null;
let context: CanvasRenderingContext2D | null = null;
/** What was last composited, so a screen left up re-uploads no texture per frame. */
let signature: string | null = null;
let texture: CanvasTexture | null = null;
let quad: Mesh | null = null;

/** What the screen last composited, so the harness reads as text what a texture cannot
 *  give back, in the shape `window.__hud` established (US2-S1, US2-S2). */
export interface RunHarness {
  /** 007's restart command, issued exactly as the screen's own key issues it. */
  restart(): void;
  visible(): boolean;
  /** The lines last composited, or null before the first one. */
  lines(): readonly StatsLine[] | null;
}

declare global {
  interface Window {
    __run?: RunHarness;
  }
}

let drawn: readonly StatsLine[] | null = null;

function fitQuad(ctx: GameContext): void {
  if (quad == null) return;
  const viewHeight = 2 * SCREEN_DISTANCE * Math.tan((ctx.camera.fov * DEGREES_TO_RADIANS) / 2);
  const width = viewHeight * ctx.camera.aspect;
  const height = (width * SCREEN_CANVAS_HEIGHT) / SCREEN_CANVAS_WIDTH;
  quad.scale.set(width, Math.min(height, viewHeight), 1);
  quad.position.set(0, 0, -SCREEN_DISTANCE);
}

/** Composites the screen, reporting whether the canvas changed. */
function drawScreen(context: CanvasRenderingContext2D, lines: readonly StatsLine[]): boolean {
  const drawing = lines.map((line) => `${line.label}=${line.value}`).join('|');
  if (drawing === signature) return false;
  signature = drawing;

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

/** This frame's counters, read from the objects that own them (FR-006). `guardsTotal` is
 *  006's roster, which is what the kill counter counts against. */
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
    // Only from the screen: elsewhere this press is 007's to answer.
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

    const surface = document.createElement('canvas');
    surface.width = SCREEN_CANVAS_WIDTH;
    surface.height = SCREEN_CANVAS_HEIGHT;
    context = surface.getContext('2d');
    if (context != null) {
      texture = new CanvasTexture(surface);
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
      // Hidden until the run completes: an unseen screen still costs a draw call (SC-006).
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

    // The elevator's `complete` arrival this frame, counted once and only here (FR-007).
    const completions = countCompletion(getLastRunTransition());

    const state = currentRunState();
    const stats = readCounters(ctx);
    const rating = ratingFor(stats.killPercent, stats.secretPercent, stats.treasurePercent);

    publishRunDiagnostics(runDiag, state, stats, rating, completions);

    const complete = state === 'complete';
    if (quad != null) quad.visible = complete;
    if (!complete || context == null) {
      drawn = null;
      return;
    }

    const lines = statsScreenLines(stats, rating);
    if (drawScreen(context, lines) && texture != null) texture.needsUpdate = true;
    drawn = lines;
  },

  resize(ctx) {
    fitQuad(ctx);
  },
});
