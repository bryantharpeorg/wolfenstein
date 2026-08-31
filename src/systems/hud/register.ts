/**
 * The HUD system (order 90): the render edge of US4 (FR-016, FR-017, FR-018).
 * Every decision lives in `src/hud/` and is tested without a page; this file
 * composites the readouts into one texture, drives the view-model and the muzzle
 * flash from the shots the combat system resolved, and publishes `muzzleFlash` and
 * `hudReady` into `__diag.combat`. 001's glob discovery finds it, so neither
 * `src/main.ts` nor `src/diag/diag.ts` is edited by this story.
 *
 * Order 90 is last, and for one reason: every value the HUD shows must be *this*
 * frame's. Combat publishes ammo and the active weapon at 70, pickups at 74 and
 * vitals health and score at 75, so reading `__diag` here reads what those systems
 * wrote a moment ago rather than what they wrote a frame ago (US4-S3). The same
 * ordering is what makes the flash begin on the frame its shot resolved: the shot
 * counter this file watches was incremented twenty units of order earlier, in the
 * same frame (US4-S6).
 *
 * The flash is driven by `combat.shotsFired`, which the fire control increments
 * only for a shot that actually left the barrel. A trigger held while out of ammo,
 * mid-switch or dead moves that counter not at all, so it lights nothing — the
 * flash follows shots and not the fire key, structurally (US4-S7).
 *
 * Three objects are added to the scene graph, all parented to the camera: the HUD
 * quad, the view-model, and the flash inside it. That is two draw calls at rest and
 * three with the flash lit, against a budget of twenty (FR-018, SC-006).
 */
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { ensureCombatDiag, type CombatDiagnostics } from '../../combat/combat-diag';
import { registerResettable } from '../../combat/restart';
import {
  HUD_CANVAS_HEIGHT,
  HUD_CANVAS_WIDTH,
  createHudSurface,
  drawHud,
  type HudSurface,
} from '../../hud/compose';
import {
  createFlashState,
  flashIntensity,
  igniteFlash,
  resetFlash,
  stepFlash,
  type FlashState,
} from '../../hud/flash';
import { portraitIndexForHealth } from '../../hud/portrait';
import { createWeaponViewModel, type WeaponViewModel } from '../../hud/viewmodel';

const MILLISECONDS_PER_SECOND = 1000;

/** How far in front of the camera the HUD quad sits. Well inside the near plane's
 *  0.1, and nearer than the view-model, though render order rather than depth is
 *  what actually decides the two — both draw with depth testing off. */
const HUD_DISTANCE = 0.2;

/** Above the view-model's, so the bar is never drawn through by the gun. */
const HUD_RENDER_ORDER = 1000;

const DEGREES_TO_RADIANS = Math.PI / 180;

let combat: CombatDiagnostics | null = null;
let surface: HudSurface | null = null;
let texture: CanvasTexture | null = null;
let quad: Mesh | null = null;
let viewModel: WeaponViewModel | null = null;
let flash: FlashState = createFlashState();

/** The published shot count this file has already lit a flash for. Assigned every
 *  frame rather than only when it rises, so a restart's return to zero rebases it
 *  instead of swallowing the next shot. */
let lastShotsFired = 0;

/** True once every value the HUD displays has a defined source (FR-018, Edge
 *  Cases). The harness waits on it, so it must not go true over a half-built page. */
let ready = false;

/** Scales the quad to span the viewport's width at `HUD_DISTANCE` and sit on its
 *  bottom edge. Recomputed on resize, so the bar keeps its proportions rather than
 *  its pixel size. */
function fitQuad(ctx: GameContext): void {
  if (quad == null) return;
  const viewHeight = 2 * HUD_DISTANCE * Math.tan((ctx.camera.fov * DEGREES_TO_RADIANS) / 2);
  const width = viewHeight * ctx.camera.aspect;
  const height = (width * HUD_CANVAS_HEIGHT) / HUD_CANVAS_WIDTH;
  quad.scale.set(width, height, 1);
  quad.position.set(0, -viewHeight / 2 + height / 2, -HUD_DISTANCE);
}

/**
 * Whether every readout has a source. Health, weapon, ammo and score come from
 * `__diag.combat` and the key counts from `__diag.interaction`; the other two
 * checks are the Edge Case the spec names — the HUD must not be asserted against
 * while the guards or the pickups are still being instantiated, so `hudReady` waits
 * for the systems that publish them to have run their setup.
 */
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

/** What the HUD draws this frame, read from live state and held nowhere. */
function readout(ctx: GameContext) {
  const live = combat!;
  const keys = ctx.diag.interaction!.keys;
  return {
    health: live.health,
    weapon: live.weapon,
    ammo: live.ammo[live.weapon],
    keys,
    score: live.score,
    portraitIndex: portraitIndexForHealth(live.health),
  };
}

/** US2's restart (FR-011): the flash goes dark with the run it belonged to. */
function resetHudRun(): void {
  resetFlash(flash);
  lastShotsFired = 0;
  if (combat != null) combat.muzzleFlash = 0;
  viewModel?.setFireMotion(0);
}

defineSystem({
  name: 'hud',
  order: 90,

  setup(ctx) {
    combat = ensureCombatDiag(ctx.diag);
    flash = createFlashState();

    // The camera is the parent of everything this system draws, so it has to be
    // in the graph the renderer walks. `main.ts` never added it, and adding it
    // here rather than there is the whole point of the system registry.
    if (ctx.camera.parent == null) ctx.scene.add(ctx.camera);

    surface = createHudSurface();
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
      quad.renderOrder = HUD_RENDER_ORDER;
      quad.frustumCulled = false;
      ctx.camera.add(quad);
      fitQuad(ctx);
    }

    viewModel = createWeaponViewModel(combat.weapon);
    ctx.camera.add(viewModel.object);

    registerResettable('hud', resetHudRun);
  },

  update(ctx, deltaMs) {
    if (combat == null) return;

    // The flash is stepped before this frame's shots are counted, so a shot that
    // resolved this frame reads at full intensity on the frame it resolved.
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
    if (drawHud(surface!, readout(ctx)) && texture != null) texture.needsUpdate = true;

    // Only now: the harness never reads a HUD that has not yet composited every
    // value it reports (Edge Cases).
    ready = true;
    combat.hudReady = ready;
  },

  resize(ctx) {
    fitQuad(ctx);
  },
});
