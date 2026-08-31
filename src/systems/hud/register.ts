// The HUD system (order 90): the render edge of US4 (FR-016, FR-017, FR-018). Every decision
// lives in `src/hud/` and is tested without a page; this file composites the readouts into
// one texture, drives the view-model and the flash from the shots combat resolved, and
// publishes `muzzleFlash` and `hudReady`. 001's glob discovery finds it, so neither
// `main.ts` nor `diag.ts` is edited by this story. Order 90 is last because every value it
// shows must be *this* frame's: combat publishes at 70 and vitals at 75 (US4-S3), and the
// shot counter the flash watches moved in this same frame (US4-S6) -- a counter that moves
// only for a shot that left the barrel, so a trigger held while dead or empty lights
// nothing (US4-S7).
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { registerResettable } from '../../combat/restart';
import { HUD_CANVAS_HEIGHT, HUD_CANVAS_WIDTH, createHudSurface, drawHud, type HudReadout,
  type HudSurface } from '../../hud/compose';
import { createFlashState, flashIntensity, igniteFlash, resetFlash, stepFlash,
  type FlashState } from '../../hud/flash';
import { portraitIndexForHealth } from '../../hud/portrait';
import { VIEWMODEL_REST, createWeaponViewModel, type WeaponViewModel } from '../../hud/viewmodel';

const MILLISECONDS_PER_SECOND = 1000, DEGREES_TO_RADIANS = Math.PI / 180;
const HUD_DISTANCE = 0.2, HUD_RENDER_ORDER = 1000;

let combat: CombatDiagnostics | null = null;
let surface: HudSurface | null = null;
let texture: CanvasTexture | null = null;
let quad: Mesh | null = null;
let viewModel: WeaponViewModel | null = null;
let flash: FlashState = createFlashState();

let lastShotsFired = 0;

function fitQuad(ctx: GameContext): void {
  if (quad == null) return;
  const viewHeight = 2 * HUD_DISTANCE * Math.tan((ctx.camera.fov * DEGREES_TO_RADIANS) / 2);
  const width = viewHeight * ctx.camera.aspect;
  const height = (width * HUD_CANVAS_HEIGHT) / HUD_CANVAS_WIDTH;
  quad.scale.set(width, height, 1);
  quad.position.set(0, -viewHeight / 2 + height / 2, -HUD_DISTANCE);
}

function sourcesReady(ctx: GameContext): boolean {
  return (
    combat != null &&
    surface != null &&
    ctx.diag.interaction != null &&
    ctx.diag.player != null &&
    ctx.diag.pickupErrors !== undefined &&
    Array.isArray(ctx.diag.enemies)
  );
}

/** What the HUD displays lives in a texture the harness cannot read back as text, so the
 *  values it was composited from are published here (US4-S2, US4-S3). */
export interface HudHarness {
  drawn(): HudReadout | null;
  composites(): number;
  /** Where the view-model is, whether its flash is drawn, and the rest pose it must
   *  return to — so US4-S6 is read off the mesh, not off the arithmetic. */
  viewModel(): { pose: { x: number; y: number; z: number; pitch: number; flashVisible: boolean };
    rest: { x: number; y: number; z: number } } | null;
}

declare global {
  interface Window {
    __hud?: HudHarness;
  }
}

let drawn: HudReadout | null = null, composites = 0;

/** This frame's readout, held nowhere; keys by copy, since `drawn()` must be what was
 *  *composited* (US4-S3). */
function readout(ctx: GameContext): HudReadout {
  const live = combat!;
  const keys = ctx.diag.interaction!.keys;
  return {
    health: live.health,
    weapon: live.weapon,
    ammo: live.ammo[live.weapon],
    keys: { silver: keys.silver, gold: keys.gold },
    score: live.score,
    portraitIndex: portraitIndexForHealth(live.health),
  };
}

function resetHudRun(): void {
  resetFlash(flash);
  lastShotsFired = 0;
  drawn = null;
  if (combat != null) combat.muzzleFlash = 0;
  viewModel?.setFireMotion(0);
}

defineSystem({
  name: 'hud',
  order: 90,

  setup(ctx) {
    combat = ensureCombatDiag(ctx.diag);
    flash = createFlashState();

    if (ctx.camera.parent == null) ctx.scene.add(ctx.camera);

    surface = createHudSurface();
    if (surface != null) {
      texture = new CanvasTexture(surface.canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;

      quad = new Mesh(new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
      quad.renderOrder = HUD_RENDER_ORDER;
      quad.frustumCulled = false;
      ctx.camera.add(quad);
      fitQuad(ctx);
    }

    viewModel = createWeaponViewModel(combat.weapon);
    ctx.camera.add(viewModel.object);

    registerResettable('hud', resetHudRun);

    window.__hud = {
      drawn: () => drawn,
      composites: () => composites,
      viewModel: () => (viewModel == null ? null : { pose: viewModel.pose(), rest: { ...VIEWMODEL_REST } }),
    };
  },

  update(ctx, deltaMs) {
    if (combat == null) return;

    stepFlash(flash, deltaMs / MILLISECONDS_PER_SECOND);
    if (combat.shotsFired > lastShotsFired) igniteFlash(flash);
    lastShotsFired = combat.shotsFired;

    const intensity = flashIntensity(flash);
    combat.muzzleFlash = intensity;

    if (viewModel != null) {
      viewModel.setKind(combat.weapon);
      viewModel.setFireMotion(intensity);
    }

    if (!sourcesReady(ctx)) return;

    // Read afresh every frame and never kept: what was drawn *is* the live state,
    // which is the whole of US4-S3.
    const values = readout(ctx);
    if (drawHud(surface!, values)) {
      composites += 1;
      if (texture != null) texture.needsUpdate = true;
    }
    drawn = values;

    // Only now: `hudReady` goes true once a composite has been drawn, and only from values
    // that every one of which has a source (FR-018, Edge Cases).
    combat.hudReady = true;
  },

  resize(ctx) {
    fitQuad(ctx);
  },
});
