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
import { DEFAULT_WEAPON } from '../../combat/weapons';
import { HUD_RENDER_ORDER } from '../hud/register';
import {
  CROSSHAIR_ARM_LENGTH_PX, CROSSHAIR_CANVAS_PX, CROSSHAIR_COLOUR,
  CROSSHAIR_REDRAW_EPSILON_PX, CROSSHAIR_SPAN_PX, CROSSHAIR_STROKE_WEIGHT_PX,
} from '../../hud/crosshair-constants';
import { CROSSHAIR_STROKE_COORDS, CROSSHAIR_STROKE_BUFFER_SIZE, fillCrosshairStrokes } from '../../hud/crosshair';
import {
  createCrosshairSpreadState, restingGapPx, stepCrosshairSpread,
  type CrosshairSpreadState,
} from '../../hud/crosshair-spread';
import { DELTA_CLAMP_MS } from '../../player/params';
import { ensureCrosshairDiag, type CrosshairDiagnostics } from '../../hud/crosshair-diag';

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
/** The 2D drawing surface the strokes are recomputed into. Created here, not in
 *  `src/hud/`, because this is the file that touches the DOM. */
let surface: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;

/** The stroke set is recomputed into this buffer rather than allocated per
 *  frame (T006): order 92 runs every frame, and 005 established per-frame
 *  derivation as the cost that matters on this project. */
const strokes = new Float64Array(CROSSHAIR_STROKE_BUFFER_SIZE);

/** The gap last drawn. The strokes are recomputed only when the gap moves — a
 *  weapon switch in this story — so a still reticle costs no canvas work. */
let drawnGap = -1;

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

/** Draws the current stroke set into the canvas. One canvas pixel per screen
 *  pixel across the span, so a declared pixel length is the length drawn. */
function drawStrokes(gapPx: number): void {
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
      drawStrokes(resting);
      drawnGap = resting;
      diag.gap = resting;
      if (texture != null) texture.needsUpdate = true;
      diag.composites += 1;
    }

    diag.renderOrder = RETICLE_RENDER_ORDER;
    diag.hidden = false;
    diag.armLengthPx = CROSSHAIR_ARM_LENGTH_PX;

    window.__crosshair = {
      centre: () => ({ x: diag?.centreXPx ?? 0, y: diag?.centreYPx ?? 0 }),
      span: () => diag?.spanPx ?? 0,
      uuid: () => quad?.uuid ?? '',
      overlayUuids: () => (quad == null ? [] : overlayUuids(ctx, quad.uuid)),
      redraws: () => diag?.composites ?? 0,
    };
  },

  update(ctx, deltaMs) {
    if (combat == null || diag == null || spread == null) return;
    // The sources the reticle reads (US2): the combat diagnostics for the
    // active weapon and the shot counter, the player diagnostics for the
    // measured speed. When either has not published yet the reticle holds the
    // resting gap of the default weapon rather than throwing, and says so.
    const combatSource = ctx.diag.combat;
    const playerSource = ctx.diag.player;
    diag.sourcesDefined = combatSource != null && playerSource != null;
    const seconds = Math.min(Math.max(deltaMs, 0), DELTA_CLAMP_MS) / 1000;
    const gap = combatSource == null || spread == null
      ? restingGapPx(DEFAULT_WEAPON)
      : stepCrosshairSpread(spread, {
        weapon: combatSource.weapon,
        speed: playerSource?.speed ?? 0,
        shotsFired: combatSource.shotsFired,
        elapsedSeconds: seconds,
      });
    // The gap breathes continuously, so the strokes are recomputed only when
    // it has moved further than the declared epsilon: a reticle at rest costs
    // no canvas work, and a breathing one is never more than that behind.
    if (Math.abs(gap - drawnGap) > CROSSHAIR_REDRAW_EPSILON_PX) {
      drawStrokes(gap);
      drawnGap = gap;
      if (texture != null) texture.needsUpdate = true;
      diag.composites += 1;
    }
    diag.gap = gap;
    diag.hidden = quad == null || quad.visible === false;
  },

  resize(ctx, width, height) {
    fitQuad(ctx, width, height);
  },
});