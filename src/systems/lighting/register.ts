// US4's one file that knows a renderer exists: `rig.ts`'s plan becomes shadow-
// mapped `PointLight`s, the declared ambient and the scene's fog (FR-012,
// FR-013), through a renderer cast local to this file. Where the backend cannot
// cast them the level ships lit but unshadowed, and says so (FR-014).
import {
  AmbientLight, Color, Fog, Mesh, OrthographicCamera, PointLight, WebGLRenderTarget,
  type Object3D, type Scene,
} from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import type { Diagnostics } from '../../diag/diag';
import { FLOOR_Y } from '../../level';
import * as C from '../../lighting/constants';
import { planLighting, tileCenter, type LightingPlan, type Tile } from '../../lighting/rig';
import {
  attachMaterialDiagnostics, publishMaterialDiagnostics, recordFallback,
} from '../../materials/diagnostics';

const ORDER = 70;
const PIXELS = 32;
const HEIGHT = 1.2;
const EXTENT = 0.35;

interface LightingRenderer {
  render(scene: Scene, camera: OrthographicCamera): void;
  shadowMap?: { enabled: boolean };
  setRenderTarget?(t: WebGLRenderTarget | null): void;
  readRenderTargetPixelsAsync?(t: WebGLRenderTarget, x: number, y: number, w: number, h: number,
    b: Uint8Array): Promise<unknown>;
}

const facts = (plan: LightingPlan, casters: number, on: boolean) => ({
  pointLights: plan.lights.length,
  shadowCastingLights: casters,
  shadowsEnabled: on,
  shadowMapSize: C.SHADOW_MAP_SIZE,
  ambientIntensity: C.AMBIENT_INTENSITY,
  fog: { color: C.FOG_COLOR, near: C.FOG_NEAR, far: C.FOG_FAR },
  longestSightLine: plan.longestSightLine,
});

declare module '../../diag/diag' {
  interface Diagnostics { lighting?: ReturnType<typeof facts> }
}

function meanLuminance(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum += 0.2126 * b[i]! + 0.7152 * b[i + 1]! + 0.0722 * b[i + 2]!;
  const v = sum / (b.length / 4) / 255;
  return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
}

/** `shadowsEnabled: true` proves nothing, so `__lightingProbe()` renders the
 * floor tile a wall stands in front of shadowed then unshadowed, and the tile
 * no lamp reaches (US4-S2, US4-S3). */
function installProbe(
  ctx: GameContext, r: LightingRenderer, plan: LightingPlan, casters: PointLight[], shadowsEnabled: boolean,
): void {
  const camera = new OrthographicCamera(-EXTENT, EXTENT, EXTENT, -EXTENT, 0.05, HEIGHT + 1);
  camera.up.set(0, 0, -1);
  let target: WebGLRenderTarget | null = null;
  const buffer = new Uint8Array(PIXELS * PIXELS * 4);

  async function sample(tile: Tile): Promise<number> {
    const c = tileCenter(tile);
    camera.position.set(c.x, HEIGHT, c.z);
    camera.lookAt(c.x, FLOOR_Y, c.z);
    r.setRenderTarget!(target);
    r.render(ctx.scene, camera);
    r.setRenderTarget!(null);
    const read = await r.readRenderTargetPixelsAsync!(target!, 0, 0, PIXELS, PIXELS, buffer);
    return meanLuminance(read instanceof Uint8Array ? read : buffer);
  }

  (window as unknown as Record<string, unknown>).__lightingProbe = async () => {
    const reason = r.setRenderTarget == null || r.readRenderTargetPixelsAsync == null
      ? 'the renderer cannot read a target back'
      : plan.shadow == null ? 'no floor tile is occluded from a mapped lamp' : null;
    if (reason != null || plan.shadow == null) return { supported: false, reason, shadowsEnabled };
    target ??= new WebGLRenderTarget(PIXELS, PIXELS);
    const occluded = await sample(plan.shadow.tile);
    // The same tile with that wall no longer casting: the difference between
    // the two samples is the shadow itself (US4-S2).
    for (const l of casters) l.castShadow = false;
    const unoccluded = await sample(plan.shadow.tile);
    for (const l of casters) l.castShadow = true;
    return { supported: true, shadowsEnabled, occluded, unoccluded, corner: await sample(plan.dark.tile) };
  };
}

defineSystem({
  name: 'lighting',
  order: ORDER,
  setup(ctx: GameContext) {
    const renderer = ctx.renderer as unknown as LightingRenderer;
    const plan = planLighting();
    const map = renderer.shadowMap;
    // FR-014: with no shadow map the level still ships; only casting stops.
    const refused = map == null || typeof map.enabled !== 'boolean'
      ? 'the active renderer exposes no shadow map' : null;
    if (refused == null) map!.enabled = true;
    else recordFallback({ name: 'lighting', map: 'shadow', reason: `shadows off: ${refused}` });

    for (const o of ctx.scene.children.filter((c) => (c as { isLight?: boolean }).isLight === true)) {
      ctx.scene.remove(o);
    }
    ctx.scene.fog = new Fog(C.FOG_COLOR, C.FOG_NEAR, C.FOG_FAR);
    ctx.scene.background = new Color(C.FOG_COLOR);
    ctx.scene.add(new AmbientLight(C.AMBIENT_COLOR, C.AMBIENT_INTENSITY));

    const casters: PointLight[] = [];
    for (const p of plan.lights) {
      const light = new PointLight(C.LIGHT_COLOR, C.LIGHT_INTENSITY, C.LIGHT_DISTANCE, C.LIGHT_DECAY);
      light.position.set(p.x, p.y, p.z);
      light.castShadow = refused == null && p.castsShadow;
      if (light.castShadow) casters.push(light);
      light.shadow.mapSize.set(C.SHADOW_MAP_SIZE, C.SHADOW_MAP_SIZE);
      light.shadow.bias = C.SHADOW_BIAS;
      light.shadow.camera.far = C.LIGHT_DISTANCE;
      ctx.scene.add(light);
    }
    ctx.scene.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    publishMaterialDiagnostics({ lights: plan.lights.length, shadowsEnabled: refused == null });
    attachMaterialDiagnostics(ctx.diag);
    (ctx.diag as Diagnostics).lighting = facts(plan, casters.length, refused == null);
    installProbe(ctx, renderer, plan, casters, refused == null);
  },
});
