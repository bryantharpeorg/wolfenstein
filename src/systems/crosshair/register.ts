// The crosshair system (order 92, US1, FR-003, FR-004, FR-005): the render edge
// of the reticle. Every decision lives in `src/hud/` and is tested without a
// page; this file composites the strokes onto one quad, keeps that quad centred
// with arms of constant pixel length across resizes, and publishes the
// diagnostics. 001's glob discovery finds it, so neither `main.ts` nor
// `diag.ts` is edited by this story.
//
// Order 92 is deliberate: after the HUD at 90, so the two composite in a
// defined order and the reticle reads the same frame's combat values, and
// before the stats screen at 1100, which draws over everything when the run
// ends. `HUD_RENDER_ORDER` itself is what 008's post chain keys overlays on —
// at or above it, the chain composites the quad over the effects rather than
// through them, so nothing blooms, blurs or colour-grades the reticle (FR-004).
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry,
  SRGBColorSpace, Vector3 } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { registerResettable } from '../../combat/restart';
import { DEFAULT_WEAPON } from '../../combat/weapons';
import { currentRunState } from '../../run/state';
import { HUD_RENDER_ORDER } from '../hud/register';
import {
  CROSSHAIR_ARM_LENGTH_PX, CROSSHAIR_CANVAS_PX, CROSSHAIR_COLOUR,
  CROSSHAIR_REDRAW_EPSILON_PX, CROSSHAIR_SPAN_PX, CROSSHAIR_STROKE_WEIGHT_PX,
} from '../../hud/crosshair-constants';
import {
  CROSSHAIR_STROKE_COORDS, CROSSHAIR_STROKE_BUFFER_SIZE, FEEDBACK_MARK_BUFFER_SIZE,
  fillCrosshairStrokes, fillFeedbackMarkStrokes,
} from '../../hud/crosshair';
import {
  NO_MARK, stepFeedbackMark, type FeedbackMark, type FeedbackMarkKind,
} from '../../hud/crosshair-feedback';
import {
  createCrosshairSpreadState, restingGapPx, stepCrosshairSpread,
  type CrosshairSpreadState,
} from '../../hud/crosshair-spread';
import { DELTA_CLAMP_MS } from '../../player/params';
import { ensureCrosshairDiag, type CrosshairDiagnostics } from '../../hud/crosshair-diag';
import {
  crosshairCommandForEvent, toggleCrosshairHidden,
} from '../../hud/crosshair-bindings';

const DEGREES_TO_RADIANS = Math.PI / 180;
/** Distance from the camera the reticle's quad sits at: the HUD's own, so the
 *  two readouts live on one depth plane. */
const RETICLE_DISTANCE = 0.2;
/** Drawn after the HUD bar, before the stats screen; at or above the HUD's
 *  order is what 008's chain composites over rather than through. */
const RETICLE_RENDER_ORDER = HUD_RENDER_ORDER + 1;

let combat: CombatDiagnostics | null = null;
let diag: CrosshairDiagnostics | null = null;
/** The spread stepper's state (US2): owned here, updated in place each frame. */
let spread: CrosshairSpreadState | null = null;
let texture: CanvasTexture | null = null;
let quad: Mesh | null = null;
/** The display preference US4 toggles (FR-014). Deliberately not a
 *  `registerResettable` and deliberately not touched by `resetCrosshairRun`: a
 *  display preference is not run state, and `007`'s restart must leave it as
 *  the player left it (US4-S4). */
let hidden = false;
/** The 2D drawing surface the strokes are recomputed into. Created here, not in
 *  `src/hud/`, because this is the file that touches the DOM. */
let surface: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;

/** The stroke set is recomputed into this buffer rather than allocated per
 *  frame (T006): order 92 runs every frame, and 005 established per-frame
 *  derivation as the cost that matters on this project. */
const strokes = new Float64Array(CROSSHAIR_STROKE_BUFFER_SIZE);
/** The active mark's strokes, in the same buffer shape — written by
 *  `fillFeedbackMarkStrokes` when the mark changes, never per frame. */
const markStrokes = new Float64Array(FEEDBACK_MARK_BUFFER_SIZE);

// --- US3 (T018): the mark state machine, held at the render edge. The
// previous counters move every frame regardless of the gate, so a rise consumed
// while the run is not being played lights nothing on the frame it happened or
// the frame after; the mark itself is cleared the frame the gate closes, and
// reset — with the gap — on 007's restart.

let currentMark: FeedbackMark = NO_MARK;
let prevHits = 0;
let prevKills = 0;

/** The gap last drawn. The strokes are recomputed only when the gap has moved
 *  further than the declared epsilon, so a reticle at rest — and one easing by
 *  less than a pixel's fraction — costs no canvas work. */
let drawnGap = -1;

/** The mark kind last drawn, so an igniting or expiring mark is the only other
 *  thing that recomputes the canvas: the decay runs on its own clock and the
 *  drawn mark is constant until it does. */
let drawnMark: FeedbackMarkKind = 'none';

/** The viewport height the geometry was last fitted to, so a resize is the only
 *  thing that repositions the quad. */
let viewportHeightPx = 0;

/** Reused, never allocated per frame, for projecting the quad's centre. */
const projected = new Vector3();

/** The size, in world units, of a span of `spanPx` screen pixels held at
 *  `RETICLE_DISTANCE` from a camera with the given vertical fov. At that
 *  distance one world unit spans `viewportHeightPx / viewHeight` screen pixels,
 *  so the quad's world height shrinks as the viewport grows — which is what
 *  keeps the arms a constant pixel length across resizes and aspect changes
 *  (US1-S4) instead of stretching with the view. */
function worldHeightFor(viewportHeight: number): number {
  const viewHeight = 2 * RETICLE_DISTANCE * Math.tan((fovDegrees() * DEGREES_TO_RADIANS) / 2);
  return viewHeight * (CROSSHAIR_SPAN_PX / Math.max(1, viewportHeight));
}

let cameraFov = 0;
function fovDegrees(): number {
  return cameraFov;
}

/** Recomputes the quad's world size and screen centre. Called from setup and
 *  from resize — the only two events that move either. The pixel dimensions are
 *  arguments, the same ones `main.ts` hands every system's resize. */
function fitQuad(ctx: GameContext, viewportWidth: number, viewportHeight: number): void {
  if (quad == null) return;
  cameraFov = ctx.camera.fov;
  viewportHeightPx = viewportHeight;
  const viewHeight = 2 * RETICLE_DISTANCE * Math.tan((cameraFov * DEGREES_TO_RADIANS) / 2);
  quad.scale.set(
    viewHeight * (CROSSHAIR_SPAN_PX / Math.max(1, viewportHeight)),
    worldHeightFor(viewportHeight),
    1,
  );
  quad.position.set(0, 0, -RETICLE_DISTANCE);
  if (diag != null) {
    diag.spanPx = CROSSHAIR_SPAN_PX;
    quad.getWorldPosition(projected);
    projected.project(ctx.camera);
    // NDC to pixels: x right, y up.
    diag.centreXPx = ((projected.x + 1) / 2) * Math.max(1, viewportWidth);
    diag.centreYPx = ((1 - projected.y) / 2) * Math.max(1, viewportHeight);
  }
}

/** Draws the current stroke set — the reticle's arms and, when one is lit, the
 *  active mark beside them — into the canvas. One canvas pixel per screen pixel
 *  across the span, so a declared pixel length is the length drawn. Nothing
 *  from the weapon table is restated here: the gap arrives already derived,
 *  from `crosshair-spread.ts`'s read of the table's own accessor (FR-007). */
function drawStrokes(gapPx: number, mark: FeedbackMarkKind): void {
  if (context == null) return;
  const size = CROSSHAIR_CANVAS_PX;
  const centre = size / 2;
  context.clearRect(0, 0, size, size);
  context.strokeStyle = CROSSHAIR_COLOUR;
  context.lineWidth = CROSSHAIR_STROKE_WEIGHT_PX;
  context.lineCap = 'butt';
  context.beginPath();
  const count = fillCrosshairStrokes(
    { gapPx, armLengthPx: CROSSHAIR_ARM_LENGTH_PX, viewport: { heightPx: viewportHeightPx } },
    strokes,
  );
  for (let index = 0; index < count; index += 1) {
    const base = index * CROSSHAIR_STROKE_COORDS;
    context.moveTo(centre + strokes[base]!, centre + strokes[base + 1]!);
    context.lineTo(centre + strokes[base + 2]!, centre + strokes[base + 3]!);
  }
  const markCount = fillFeedbackMarkStrokes(mark, markStrokes);
  for (let index = 0; index < markCount; index += 1) {
    const base = index * CROSSHAIR_STROKE_COORDS;
    context.moveTo(centre + markStrokes[base]!, centre + markStrokes[base + 1]!);
    context.lineTo(centre + markStrokes[base + 2]!, centre + markStrokes[base + 3]!);
  }
  context.stroke();
}

/** What the harness drives, in the shape `window.__hud` and `window.__post`
 *  established: a texture cannot be read back, so the facts a claim needs are
 *  read off the objects that drew it. */
export interface CrosshairHarness {
  /** Where the quad's centre lands on screen, in pixels. */
  centre(): { x: number; y: number };
  /** Screen pixels the canvas covers, edge to edge. */
  span(): number;
  /** The quad's identity, so the smoke check can tell it from the HUD bar's. */
  uuid(): string;
  /** Every other overlay quad on the camera — the HUD bar's among them. */
  overlayUuids(): string[];
  /** How many times the stroke set has been recomputed. */
  redraws(): number;
}

declare global {
  interface Window {
    __crosshair?: CrosshairHarness;
  }
}

function overlayUuids(ctx: GameContext, own: string): string[] {
  const found: string[] = [];
  for (const child of ctx.camera.children) {
    if (child.uuid !== own && child.renderOrder >= HUD_RENDER_ORDER) found.push(child.uuid);
  }
  return found;
}

/** 007's restart (US3-S7): no mark active, and a `drawnGap` of -1 so the first
 *  frame after it recomputes the canvas at the starting weapon's resting gap.
 *  The toggle preference US4 adds is deliberately not here: a display preference
 *  is not run state, and the restart must not touch it. */
function resetCrosshairRun(): void {
  currentMark = NO_MARK;
  prevHits = 0;
  prevKills = 0;
  drawnMark = 'none';
  drawnGap = -1;
  // The gap is run state too (US2): a restart returns the reticle to the
  // starting weapon's resting gap with no recoil owed and no shots counted.
  // `DEFAULT_WEAPON` rather than `combat.weapon`, because the resettables run
  // in registration order and combat's own reset may not have landed yet.
  spread = createCrosshairSpreadState(DEFAULT_WEAPON);
  if (diag != null) diag.mark = 'none';
}

/** The toggle (US4, FR-014): the command comes from the one binding table in
 *  `src/hud/crosshair-bindings.ts` — this file maps no key code itself
 *  (US4-S5). A held key repeats, and `008` already established that a repeat is
 *  not a press, so one press is one toggle. */
function bindToggle(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (crosshairCommandForEvent(event) == null) return;
    hidden = toggleCrosshairHidden(hidden);
  });
}

defineSystem({
  name: 'crosshair',
  order: 92,

  setup(ctx) {
    combat = ensureCombatDiag(ctx.diag);
    diag = ensureCrosshairDiag(ctx.diag);
    spread = createCrosshairSpreadState(combat.weapon);

    surface = document.createElement('canvas');
    surface.width = CROSSHAIR_CANVAS_PX;
    surface.height = CROSSHAIR_CANVAS_PX;
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
      quad.renderOrder = RETICLE_RENDER_ORDER;
      quad.frustumCulled = false;
      ctx.camera.add(quad);
      fitQuad(ctx, window.innerWidth, window.innerHeight);
      const resting = restingGapPx(combat.weapon);
      drawStrokes(resting, 'none');
      drawnGap = resting;
      diag.gap = resting;
      if (texture != null) texture.needsUpdate = true;
      diag.composites += 1;
    }

    diag.renderOrder = RETICLE_RENDER_ORDER;
    diag.hidden = false;
    diag.armLengthPx = CROSSHAIR_ARM_LENGTH_PX;
    diag.mark = 'none';

    registerResettable('crosshair', resetCrosshairRun);
    bindToggle();

    window.__crosshair = {
      centre: () => ({ x: diag?.centreXPx ?? 0, y: diag?.centreYPx ?? 0 }),
      span: () => diag?.spanPx ?? 0,
      uuid: () => quad?.uuid ?? '',
      overlayUuids: () => (quad == null ? [] : overlayUuids(ctx, quad.uuid)),
      redraws: () => diag?.composites ?? 0,
    };
  },

  update(ctx, deltaMs) {
    if (combat == null || diag == null) return;
    // Hidden means absent, not transparent (FR-015, US4-S3): the quad leaves the
    // camera, so the frame it is hidden on costs no draw call — a transparent
    // quad would still spend one. Crossing either way forces a recomposite, so
    // the canvas never shows a gap the reticle breathed to while it was away.
    if (quad != null) {
      if (hidden && quad.parent != null) {
        ctx.camera.remove(quad);
        drawnGap = -1;
      } else if (!hidden && quad.parent == null) {
        ctx.camera.add(quad);
        drawnGap = -1;
      }
    }
    diag.hidden = hidden;
    // The sources the reticle reads (US2): the combat diagnostics for the
    // active weapon and the shot counter, the player diagnostics for the
    // measured speed. When either has not published yet the reticle holds the
    // resting gap of the default weapon rather than throwing, and says so.
    const combatSource = ctx.diag.combat;
    const playerSource = ctx.diag.player;
    diag.sourcesDefined = combatSource != null && playerSource != null;

    // The run state arrives through `currentRunState()` rather than through
    // `ctx.diag.run.state`: the stats screen publishes that field at order 95,
    // *after* this system runs, so the accessor is the same-frame source of the
    // fact the published field carries — the same reason the HUD at 90 reads
    // combat's counters instead of waiting for a later system's publish.
    currentMark = stepFeedbackMark(currentMark, {
      prevHits,
      hits: combat.hits,
      prevKills,
      kills: combat.kills,
      runState: currentRunState(),
      dead: combat.dead,
    }, deltaMs / 1000);
    prevHits = combat.hits;
    prevKills = combat.kills;
    diag.mark = currentMark.kind;

    // The frame's own delta, clamped the way 003 clamps locomotion's, so a
    // tab-restore-sized frame opens the reticle no further than a long one.
    const seconds = Math.min(Math.max(deltaMs, 0), DELTA_CLAMP_MS) / 1000;
    const gap = combatSource == null || spread == null
      ? restingGapPx(DEFAULT_WEAPON)
      : stepCrosshairSpread(spread, {
        weapon: combatSource.weapon,
        speed: playerSource?.speed ?? 0,
        shotsFired: combatSource.shotsFired,
        elapsedSeconds: seconds,
      });
    // The gap breathes continuously, so the strokes are recomputed only when it
    // has moved further than the declared epsilon — or when the mark ignites or
    // expires, which is the other thing the canvas carries: a reticle at rest
    // costs no canvas work, and a breathing one is never more than that behind.
    // A hidden one costs neither: the strokes are not recomputed at all, and
    // re-showing forced a recomposite above.
    if (!hidden
      && (Math.abs(gap - drawnGap) > CROSSHAIR_REDRAW_EPSILON_PX
        || currentMark.kind !== drawnMark)) {
      drawStrokes(gap, currentMark.kind);
      drawnGap = gap;
      drawnMark = currentMark.kind;
      if (texture != null) texture.needsUpdate = true;
      diag.composites += 1;
    }
    diag.gap = gap;
  },

  resize(ctx, width, height) {
    fitQuad(ctx, width, height);
  },
});