// The lighting system: the one file in US4 that knows a renderer exists. It
// turns `rig.ts`'s plan into shadow-mapped `PointLight`s, the declared ambient
// term and the scene's fog (FR-012, FR-013), reaching the renderer's shadow map
// through a cast local to this file rather than widening `GameContext` in the
// shared `src/boot/registry.ts`. Where those lights cannot be made to work on
// the active backend the level still ships -- ambient, fog and every texture
// stay, `shadowsEnabled` reads false, and the reason is recorded through
// `recordFallback()` (FR-014, US4-S6).
import {
  AmbientLight, Color, Fog, Mesh, OrthographicCamera, PointLight, WebGLRenderTarget,
  type Object3D, type PerspectiveCamera, type Scene,
} from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import type { Diagnostics } from '../../diag/diag';
import { FLOOR_Y } from '../../level';
import * as C from '../../lighting/constants';
import { planLighting, tileCenter, type LightingPlan, type Tile } from '../../lighting/rig';
import {
  attachMaterialDiagnostics, publishMaterialDiagnostics, recordFallback,
} from '../../materials/diagnostics';

/** After 002's level (40), 004's doors and secrets (45-47) and US3's materials
 * (60): every mesh that needs a shadow flag exists by now. */
const SYSTEM_ORDER = 70;
/** Edge of the offscreen target the probe reads back. Small on purpose: this is
 * a mean over one floor patch, not a screenshot. */
const PROBE_PIXELS = 32;
/** Probe camera height, under the ceiling so the ceiling is behind it. */
const PROBE_HEIGHT = 1.2;
/** Half-edge of the floor patch sampled, inside one tile so the sample cannot
 * spill onto a neighbouring tile's shading. */
const PROBE_EXTENT = 0.35;
/** A mesh this tall occludes; the floor and ceiling are flat and stay visible,
 * or the probe would read the void rather than a lit floor. */
const OCCLUDER_MIN_HEIGHT = 0.5;

/** `__diag.lighting`: attached by module augmentation rather than by editing
 * `src/diag/diag.ts`, so no existing field is renamed, removed or repurposed.
 * FR-015's own list belongs to `__diag.materials` and US2 owns that file, so
 * the shadow-map size, the bias and the fog range -- which US4-S1 and US4-S4
 * need readable off the page -- live here instead. */
export interface LightingDiagnostics {
  readonly pointLights: number;
  readonly shadowCastingLights: number;
  readonly shadowsEnabled: boolean;
  readonly shadowMapSize: number;
  readonly shadowBias: number;
  readonly shadowNormalBias: number;
  readonly ambient: { readonly color: number; readonly intensity: number };
  readonly fog: { readonly color: number; readonly near: number; readonly far: number } | null;
  readonly longestSightLine: number;
  readonly fogFactorAtSightLine: number;
  readonly exitSightLine: number | null;
  readonly fogFactorAtExit: number | null;
  readonly fallbacks: readonly string[];
}

declare module '../../diag/diag' {
  interface Diagnostics { lighting?: LightingDiagnostics }
}

interface ShadowMapState { enabled: boolean; autoUpdate: boolean; needsUpdate: boolean }

/** What US4 needs of the renderer, declared here rather than in the shared
 * `GameContext`: a shadow map to switch on, and an offscreen target it can read
 * pixels back from. The cast that produces one is local to this story. */
interface LightingRenderer {
  render(scene: Scene, camera: PerspectiveCamera | OrthographicCamera): void;
  shadowMap?: ShadowMapState;
  setRenderTarget?(target: WebGLRenderTarget | null): void;
  readRenderTargetPixels?(t: WebGLRenderTarget, x: number, y: number, w: number, h: number, b: Uint8Array): void;
  readRenderTargetPixelsAsync?(t: WebGLRenderTarget, x: number, y: number, w: number, h: number, b: Uint8Array): Promise<ArrayBufferView>;
}

const isMesh = (o: Object3D): o is Mesh => (o as { isMesh?: boolean }).isMesh === true;
const isLight = (o: Object3D): boolean => (o as { isLight?: boolean }).isLight === true;

function applyShadowFlags(root: Object3D): void {
  root.traverse((o) => {
    if (!isMesh(o)) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

/** Switches the renderer's shadow map on, or names why it could not be.
 * `?noshadows=1` forces the refusal, so FR-014's degraded build is reachable
 * from the smoke harness instead of only from a backend nobody has. */
function enableShadowMap(renderer: LightingRenderer): { on: boolean; reason: string | null } {
  if (new URLSearchParams(window.location.search).has('noshadows')) {
    return { on: false, reason: 'shadow-mapped point lights disabled by ?noshadows=1' };
  }
  const map = renderer.shadowMap;
  if (map == null || typeof map.enabled !== 'boolean') {
    return { on: false, reason: 'the active renderer exposes no shadow map' };
  }
  try {
    map.enabled = true;
    // The level is static but for 004's doors, so six cube faces per lamp are
    // re-rendered on an interval rather than every frame (FR-016, US4-S5).
    map.autoUpdate = false;
    map.needsUpdate = true;
  } catch (error) {
    return { on: false, reason: `enabling the shadow map threw: ${String(error)}` };
  }
  return { on: map.enabled === true, reason: null };
}

/** three writes a non-XR render target in the linear working space, never in
 * the output space it gives the canvas, so the bytes read back are linear. The
 * transfer function is applied here instead: "not pure black" and "measurably
 * darker" are claims about what a player sees, and both would be decided on the
 * wrong scale against raw linear bytes. */
function meanLuminance(buffer: Uint8Array): number {
  const srgb = (channel: number): number => {
    const v = channel / 255;
    return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
  };
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 4) {
    sum += 0.2126 * srgb(buffer[i]!) + 0.7152 * srgb(buffer[i + 1]!) + 0.0722 * srgb(buffer[i + 2]!);
  }
  return sum / (buffer.length / 4);
}

/** Installs `__lightingProbe()`; nothing in the game ever calls it.
 * `shadowsEnabled: true` proves nothing -- a bias that erases every shadow
 * passes it -- so this renders the planned floor tile straight down into a
 * small offscreen target twice, occluders shown and hidden, and returns both
 * mean luminances plus a sample of the tile no lamp reaches (US4-S2, US4-S3). */
function installProbe(
  ctx: GameContext,
  renderer: LightingRenderer,
  plan: LightingPlan,
  shadowsEnabled: boolean,
): void {
  const camera = new OrthographicCamera(
    -PROBE_EXTENT, PROBE_EXTENT, PROBE_EXTENT, -PROBE_EXTENT, 0.05, PROBE_HEIGHT + 1,
  );
  // Looking straight down, so the camera's up vector must not be the view
  // direction: -Z is image-up, which keeps `lookAt` well defined.
  camera.up.set(0, 0, -1);
  let target: WebGLRenderTarget | null = null;
  const buffer = new Uint8Array(PROBE_PIXELS * PROBE_PIXELS * 4);

  const unsupported = (reason: string) => ({
    supported: false, reason, shadowsEnabled, occluded: null, unoccluded: null,
    corner: null, occludedTile: plan.shadowProbe?.tile ?? null, cornerTile: plan.darkTile.tile,
  });

  async function sample(tile: Tile): Promise<number> {
    const c = tileCenter(tile);
    camera.position.set(c.x, PROBE_HEIGHT, c.z);
    camera.lookAt(c.x, FLOOR_Y, c.z);
    camera.updateProjectionMatrix();
    if (renderer.shadowMap != null) renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget!(target);
    renderer.render(ctx.scene, camera);
    renderer.setRenderTarget!(null);
    if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
      const read = await renderer.readRenderTargetPixelsAsync(target!, 0, 0, PROBE_PIXELS, PROBE_PIXELS, buffer);
      return meanLuminance(read instanceof Uint8Array ? read : buffer);
    }
    renderer.readRenderTargetPixels!(target!, 0, 0, PROBE_PIXELS, PROBE_PIXELS, buffer);
    return meanLuminance(buffer);
  }

  (window as unknown as Record<string, unknown>).__lightingProbe = async () => {
    if (typeof renderer.setRenderTarget !== 'function') {
      return unsupported('the active renderer exposes no offscreen render target');
    }
    if (typeof renderer.readRenderTargetPixels !== 'function'
      && typeof renderer.readRenderTargetPixelsAsync !== 'function') {
      return unsupported('the active renderer cannot read a render target back');
    }
    if (plan.shadowProbe == null) {
      return unsupported('no floor tile in the shipped level is occluded from a lamp');
    }
    if (target == null) {
      target = new WebGLRenderTarget(PROBE_PIXELS, PROBE_PIXELS);
      target.texture.generateMipmaps = false;
    }
    const tile = plan.shadowProbe.tile;
    const occluded = await sample(tile);
    // The same region with the walls removed. Every vertical mesh goes, so the
    // comparison isolates occlusion rather than one hand-picked wall.
    const hidden: Mesh[] = [];
    ctx.scene.traverse((o) => {
      if (!isMesh(o) || !o.visible) return;
      if (o.geometry.boundingBox == null) o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox;
      if (box != null && box.max.y - box.min.y >= OCCLUDER_MIN_HEIGHT) hidden.push(o);
    });
    for (const mesh of hidden) mesh.visible = false;
    let unoccluded: number;
    try {
      unoccluded = await sample(tile);
    } finally {
      for (const mesh of hidden) mesh.visible = true;
      if (renderer.shadowMap != null) renderer.shadowMap.needsUpdate = true;
    }
    const corner = await sample(plan.darkTile.tile);
    return {
      supported: true, reason: null, shadowsEnabled, occluded, unoccluded, corner,
      occludedTile: tile, cornerTile: plan.darkTile.tile, occluderCount: hidden.length,
    };
  };
}

// Frame counter and scene-graph watermark for the shadow-refresh interval, kept
// in the module so the `System` shape 001 declared needs no extra field.
let frames = 0;
let childCount = -1;
let shadowsOn = false;

defineSystem({
  name: 'lighting',
  order: SYSTEM_ORDER,
  setup(ctx: GameContext) {
    const renderer = ctx.renderer as unknown as LightingRenderer;
    const plan = planLighting();
    const fallbacks: string[] = [];

    // 002 lit the level with a placeholder ambient and a key light. Leaving
    // them would mean the ambient the page renders is not the one FR-013
    // declares, and a shadowless fill would wash out the contrast US4-S2
    // measures -- so lighting is taken over here, not by editing 002's system.
    for (const light of ctx.scene.children.filter(isLight)) ctx.scene.remove(light);

    // Fog first, with the background taking the same colour, so a sight-line
    // fades into the value the far wall fades into instead of onto a seam.
    ctx.scene.fog = new Fog(C.FOG_COLOR, C.FOG_NEAR, C.FOG_FAR);
    ctx.scene.background = new Color(C.FOG_COLOR);
    ctx.scene.add(new AmbientLight(C.AMBIENT_COLOR, C.AMBIENT_INTENSITY));

    const shadows = enableShadowMap(renderer);
    if (!shadows.on) {
      // FR-014: the epic degrades rather than stalling. Ambient, fog and every
      // texture stay; only the casting stops, and the reason is on the page.
      const reason = shadows.reason ?? 'shadow-mapped point lights unavailable';
      fallbacks.push(reason);
      recordFallback({ name: 'lighting', map: 'shadow', reason: `shadows off: ${reason}` });
    }

    for (const placement of plan.lights) {
      const light = new PointLight(C.LIGHT_COLOR, C.LIGHT_INTENSITY, C.LIGHT_DISTANCE, C.LIGHT_DECAY);
      light.position.set(placement.x, placement.y, placement.z);
      light.castShadow = shadows.on && placement.castsShadow;
      light.shadow.mapSize.set(C.SHADOW_MAP_SIZE, C.SHADOW_MAP_SIZE);
      light.shadow.bias = C.SHADOW_BIAS;
      light.shadow.normalBias = C.SHADOW_NORMAL_BIAS;
      light.shadow.camera.near = C.SHADOW_CAMERA_NEAR;
      // The shadow camera stops where the lamp does: no depth precision spent
      // on geometry the light cannot reach anyway.
      light.shadow.camera.far = C.LIGHT_DISTANCE;
      ctx.scene.add(light);
    }
    applyShadowFlags(ctx.scene);

    let pointLights = 0;
    let shadowCastingLights = 0;
    ctx.scene.traverse((o) => {
      if ((o as { isPointLight?: boolean }).isPointLight !== true) return;
      pointLights += 1;
      if (o.castShadow) shadowCastingLights += 1;
    });

    publishMaterialDiagnostics({ lights: pointLights, shadowsEnabled: shadows.on });
    attachMaterialDiagnostics(ctx.diag);
    (ctx.diag as Diagnostics).lighting = {
      pointLights,
      shadowCastingLights,
      shadowsEnabled: shadows.on,
      shadowMapSize: C.SHADOW_MAP_SIZE,
      shadowBias: C.SHADOW_BIAS,
      shadowNormalBias: C.SHADOW_NORMAL_BIAS,
      ambient: { color: C.AMBIENT_COLOR, intensity: C.AMBIENT_INTENSITY },
      fog: { color: C.FOG_COLOR, near: C.FOG_NEAR, far: C.FOG_FAR },
      longestSightLine: plan.longestSightLine.length,
      fogFactorAtSightLine: plan.fogFactorAtSightLine,
      exitSightLine: plan.exitSightLine?.length ?? null,
      fogFactorAtExit: plan.fogFactorAtExit,
      fallbacks,
    };

    installProbe(ctx, renderer, plan, shadows.on);
    shadowsOn = shadows.on;
    childCount = ctx.scene.children.length;
  },

  update(ctx: GameContext) {
    frames += 1;
    // A mesh added after setup -- a door leaf, a pickup -- still casts and
    // receives, without traversing the whole scene every frame.
    if (ctx.scene.children.length !== childCount) {
      childCount = ctx.scene.children.length;
      applyShadowFlags(ctx.scene);
      frames = C.SHADOW_REFRESH_FRAMES;
    }
    const map = (ctx.renderer as unknown as LightingRenderer).shadowMap;
    if (shadowsOn && map != null && frames % C.SHADOW_REFRESH_FRAMES === 0) map.needsUpdate = true;
  },
});
