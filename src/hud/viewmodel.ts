// T038 (US4-S6, US4-S8): the weapon view-model and its muzzle flash, both
// procedural geometry per Constitution II — boxes merged into one mesh, and a quad
// for the flash. No sprite, no imported model, no image. The requirement these two
// scenarios come from is stated in full at the head of `flash.ts`, which owns the
// decay; this file reads the weapon table, and `weapons.test.ts` scans every
// importer of that table for a line restating one of its numbers — of which the
// requirement's own tag is, read as digits, one.
//
// **This module is not the origin of any ray, and cannot become one.** It imports
// nothing from `src/combat/hitscan.ts` or `src/combat/spread.ts`, exports no
// position and no direction, and the object it builds is parented to the camera as
// decoration. The shot ray leaves the camera centre in `systems/combat/register.ts`
// and always did; drawing a gun barrel at the bottom-right of the screen must not
// move it, which is exactly what US4-S8 asks to be true (Clarifications).
//
// The fire motion rides the clock in `flash.ts` rather than a second timer of its own,
// so "returns to rest within the flash decay" is not a coincidence of two tuned
// durations — it is one duration, and at zero intensity the model is at *exact*
// rest rather than near it.
//
// One merged mesh and one quad: two draw calls with the flash lit, one without,
// which is what leaves room inside the budget of twenty for the HUD (SC-006).

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPON_KINDS, type WeaponKind } from '../combat/weapons';
import { fireMotion } from './flash';

/** Where the model sits when nothing has been fired: low and to the right, out of
 *  the way of the crosshair the ray actually leaves from. */
export const VIEWMODEL_REST = { x: 0.17, y: -0.112, z: -0.38 } as const;

/** A slight cant, so the model reads as held rather than as floating. */
const REST_PITCH = 0.045;
const REST_YAW = -0.09;

/** Drawn over the world: the model is decoration in front of the camera, and a
 *  wall the player is standing against must not clip through it. */
export const VIEWMODEL_RENDER_ORDER = 900;

const GUNMETAL = 0x6b7280;
const SHADOW = 0x3f4550;
const HIGHLIGHT = 0x9aa3b0;
const BRASS = 0xb08d3f;

const FLASH_COLOR = 0xffdf8a;
const FLASH_SIZE = 0.075;

/** The burst's points and how far its notches fall between them. */
const FLASH_POINTS = 8;
const FLASH_NOTCH = 0.38;

/** The model is declared at a comfortable size to read as boxes and then drawn
 *  smaller, so the silhouette stays out of the middle of the screen. */
const MODEL_SCALE = 0.8;

interface Part {
  readonly size: readonly [number, number, number];
  readonly at: readonly [number, number, number];
  readonly color: number;
}

/** One box, coloured into its own vertices so the whole model is one material and
 *  therefore one draw call. */
function part({ size, at, color }: Part): BufferGeometry {
  const geometry = new BoxGeometry(size[0], size[1], size[2]);
  geometry.translate(at[0], at[1], at[2]);
  const position = geometry.getAttribute('position');
  const tint = new Color(color);
  const colors = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    colors[vertex * 3] = tint.r;
    colors[vertex * 3 + 1] = tint.g;
    colors[vertex * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Each weapon's silhouette, declared as boxes. The barrel points down -Z, so the
 *  muzzle is the most negative Z the parts reach. */
const SILHOUETTES: Readonly<Record<WeaponKind, readonly Part[]>> = {
  pistol: [
    { size: [0.062, 0.088, 0.165], at: [0, 0, 0], color: GUNMETAL },
    { size: [0.032, 0.032, 0.18], at: [0, 0.021, -0.17], color: HIGHLIGHT },
    { size: [0.058, 0.128, 0.072], at: [0, -0.092, 0.041], color: SHADOW },
  ],
  smg: [
    { size: [0.072, 0.092, 0.235], at: [0, 0, 0], color: GUNMETAL },
    { size: [0.031, 0.031, 0.2], at: [0, 0.018, -0.215], color: HIGHLIGHT },
    { size: [0.052, 0.155, 0.062], at: [0, -0.105, -0.02], color: SHADOW },
    { size: [0.058, 0.12, 0.072], at: [0, -0.082, 0.088], color: SHADOW },
    { size: [0.05, 0.062, 0.1], at: [0, 0.008, 0.16], color: GUNMETAL },
  ],
  chaingun: [
    { size: [0.108, 0.112, 0.26], at: [0, 0, 0], color: GUNMETAL },
    { size: [0.038, 0.038, 0.3], at: [0, 0, -0.28], color: HIGHLIGHT },
    { size: [0.032, 0.032, 0.3], at: [0.035, -0.008, -0.28], color: SHADOW },
    { size: [0.032, 0.032, 0.3], at: [-0.035, -0.008, -0.28], color: SHADOW },
    { size: [0.135, 0.135, 0.085], at: [0, -0.015, 0.09], color: BRASS },
    { size: [0.058, 0.118, 0.075], at: [0, -0.09, 0.135], color: SHADOW },
  ],
};

/** Where each weapon's flash sits — the end of its own barrel. Cosmetic: it is
 *  where a quad is drawn, never where a shot is traced from (US4-S8). */
const MUZZLES: Readonly<Record<WeaponKind, readonly [number, number, number]>> = {
  pistol: [0, 0.021, -0.27],
  smg: [0, 0.018, -0.325],
  chaingun: [0, 0, -0.44],
};

/** The flash itself: a star drawn as a triangle fan, white at the centre and
 *  black at every tip. Under additive blending black adds nothing, so the burst
 *  fades out at its edges without a texture — which is the only way to have a soft
 *  flash at all when Constitution II forbids the image one would otherwise sample. */
function burstGeometry(): BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const colors: number[] = [1, 1, 1];
  const indices: number[] = [];
  const spokes = FLASH_POINTS * 2;

  for (let step = 0; step < spokes; step += 1) {
    const angle = (step * Math.PI * 2) / spokes;
    const radius = step % 2 === 0 ? 1 : FLASH_NOTCH;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    colors.push(0, 0, 0);
    indices.push(0, step + 1, ((step + 1) % spokes) + 1);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface WeaponViewModel {
  /** Parented to the camera by the HUD system; nothing else touches it. */
  readonly object: Group;
  /** Swaps the silhouette. Built once per kind at load, so this costs nothing. */
  setKind(kind: WeaponKind): void;
  /** Places the model and the flash for this frame's intensity. Zero is rest. */
  setFireMotion(intensity: number): void;
  /** Where the model actually is. A reading, not a control: the harness asserts
   *  the fire motion happened and returned to rest, which it cannot do against a
   *  mesh it has no way to look at (US4-S6). */
  pose(): { x: number; y: number; z: number; pitch: number; flashVisible: boolean };
  dispose(): void;
}

/** Builds the view-model and its flash quad. Everything is generated here at load
 *  time; the module reads no file and loads no asset. */
export function createWeaponViewModel(kind: WeaponKind = WEAPON_KINDS[0]!): WeaponViewModel {
  const geometries = new Map<WeaponKind, BufferGeometry>();
  for (const weapon of WEAPON_KINDS) {
    const merged = mergeGeometries(SILHOUETTES[weapon].map(part));
    if (merged != null) geometries.set(weapon, merged);
  }

  const material = new MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false });
  const mesh = new Mesh(geometries.get(kind) ?? geometries.get(WEAPON_KINDS[0]!)!, material);
  mesh.renderOrder = VIEWMODEL_RENDER_ORDER;
  mesh.frustumCulled = false;

  const flashMaterial = new MeshBasicMaterial({
    color: FLASH_COLOR,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  const flashGeometry = burstGeometry();
  const flash = new Mesh(flashGeometry, flashMaterial);
  flash.renderOrder = VIEWMODEL_RENDER_ORDER + 1;
  flash.frustumCulled = false;
  flash.visible = false;

  const object = new Group();
  object.add(mesh);
  object.add(flash);
  object.rotation.set(REST_PITCH, REST_YAW, 0);
  object.position.set(VIEWMODEL_REST.x, VIEWMODEL_REST.y, VIEWMODEL_REST.z);
  object.scale.setScalar(MODEL_SCALE);

  let current = kind;
  const placeFlash = (): void => {
    const muzzle = MUZZLES[current];
    flash.position.set(muzzle[0], muzzle[1], muzzle[2]);
  };
  placeFlash();

  return {
    object,

    setKind(next: WeaponKind): void {
      if (next === current) return;
      const geometry = geometries.get(next);
      if (geometry == null) return;
      current = next;
      mesh.geometry = geometry;
      placeFlash();
    },

    setFireMotion(intensity: number): void {
      const motion = fireMotion(intensity);
      // Rest is reached exactly, because `fireMotion(0)` is exactly zero.
      object.position.set(
        VIEWMODEL_REST.x,
        VIEWMODEL_REST.y - motion.drop,
        VIEWMODEL_REST.z + motion.back,
      );
      object.rotation.x = REST_PITCH - motion.pitch;

      const lit = motion.back > 0;
      flash.visible = lit;
      if (!lit) return;
      const eased = Math.min(1, Math.max(0, intensity));
      flashMaterial.opacity = eased;
      // Bigger at the instant of the shot, shrinking as it fades.
      const size = FLASH_SIZE * (0.55 + 0.45 * eased);
      flash.scale.set(size, size, 1);
      // A fixed cant, not a random one: the flash must look the same on every
      // run for the same reason the portraits must.
      flash.rotation.z = REST_YAW;
    },

    pose() {
      return {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
        pitch: object.rotation.x,
        flashVisible: flash.visible,
      };
    },

    dispose(): void {
      for (const geometry of geometries.values()) geometry.dispose();
      flashGeometry.dispose();
      material.dispose();
      flashMaterial.dispose();
      object.clear();
    },
  };
}
