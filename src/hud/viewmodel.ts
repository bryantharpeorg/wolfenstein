// T038 (US4-S6, US4-S8): the weapon view-model and its muzzle flash, both procedural per
// Constitution II. **This module is not the origin of any ray, and cannot become one**: it
// imports nothing from `hitscan.ts` or `spread.ts`, exports no position and no direction,
// and what it builds is parented to the camera as decoration -- the ray leaves the camera
// centre in `systems/combat/register.ts` and always did (US4-S8). The fire motion rides
// `flash.ts`'s clock, so rest comes within the decay and at zero it is *exact*.

import { AdditiveBlending, BoxGeometry, BufferGeometry, CircleGeometry, DoubleSide, Group, Mesh,
  MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPON_KINDS, type WeaponKind } from '../combat/weapons';
import { fireMotion } from './flash';

export const VIEWMODEL_REST = { x: 0.17, y: -0.112, z: -0.38 } as const;
const REST_PITCH = 0.045, REST_YAW = -0.09;
export const VIEWMODEL_RENDER_ORDER = 900;
const MODEL_SCALE = 0.8, FLASH_COLOR = 0xffdf8a, FLASH_SIZE = 0.075;

const SHAPES: Readonly<Record<WeaponKind, readonly [number, number, number, number, number, number]>> = {
  pistol: [0.062, 0.088, 0.165, 0.032, 0.18, 0x6b7280],
  smg: [0.072, 0.092, 0.235, 0.031, 0.24, 0x7c8593],
  chaingun: [0.108, 0.112, 0.26, 0.038, 0.32, 0x8d7a45],
};

/** The barrel points down -Z, so the muzzle is the most negative Z the parts reach --
 *  where the flash is drawn, and never where a shot is traced from (US4-S8). */
const muzzleOf = (kind: WeaponKind): [number, number, number] =>
  [0, SHAPES[kind][1] / 4, -(SHAPES[kind][2] / 2 + SHAPES[kind][4])];

function silhouette(kind: WeaponKind): BufferGeometry {
  const [width, height, depth, bore, barrel] = SHAPES[kind];
  const boxes: readonly (readonly number[])[] = [
    [width, height, depth, 0, 0, 0],
    [bore, bore, barrel, 0, height / 4, -(depth + barrel) / 2],
    [width * 0.9, height * 1.4, depth * 0.4, 0, -height, depth / 4],
    [width * 0.8, height * 0.7, depth * 0.35, 0, 0, depth * 0.6],
  ];
  const parts = boxes.map(([w, h, d, x, y, z]) => {
    const box = new BoxGeometry(w, h, d);
    box.translate(x!, y!, z!);
    return box;
  });
  return mergeGeometries(parts) ?? parts[0]!;
}

export interface WeaponViewModel {
  readonly object: Group;
  setKind(kind: WeaponKind): void;
  setFireMotion(intensity: number): void;
  /** A reading, not a control: the harness asserts the fire motion happened and returned
   *  to rest (US4-S6). */
  pose(): { x: number; y: number; z: number; pitch: number; flashVisible: boolean };
}

export function createWeaponViewModel(kind: WeaponKind = WEAPON_KINDS[0]!): WeaponViewModel {
  const geometries = new Map(WEAPON_KINDS.map((weapon) => [weapon, silhouette(weapon)]));
  const material = new MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const mesh = new Mesh(geometries.get(kind)!, material);
  mesh.renderOrder = VIEWMODEL_RENDER_ORDER;
  mesh.frustumCulled = false;

  const flashMaterial = new MeshBasicMaterial({ color: FLASH_COLOR, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthTest: false, depthWrite: false, side: DoubleSide });
  const flash = new Mesh(new CircleGeometry(1, 8), flashMaterial);
  flash.renderOrder = VIEWMODEL_RENDER_ORDER + 1;
  flash.frustumCulled = false;
  flash.visible = false;

  const object = new Group();
  object.add(mesh, flash);
  object.rotation.set(REST_PITCH, REST_YAW, 0);
  object.position.set(VIEWMODEL_REST.x, VIEWMODEL_REST.y, VIEWMODEL_REST.z);
  object.scale.setScalar(MODEL_SCALE);

  let current = kind;
  const wear = (next: WeaponKind): void => {
    current = next;
    mesh.geometry = geometries.get(next)!;
    material.color.setHex(SHAPES[next][5]);
    flash.position.set(...muzzleOf(next));
  };
  wear(kind);

  return {
    object,

    setKind(next: WeaponKind): void {
      if (next !== current) wear(next);
    },

    setFireMotion(intensity: number): void {
      const motion = fireMotion(intensity);
      object.position.set(VIEWMODEL_REST.x, VIEWMODEL_REST.y - motion.drop, VIEWMODEL_REST.z + motion.back);
      object.rotation.x = REST_PITCH - motion.pitch;
      flash.visible = motion.back > 0;
      if (!flash.visible) return;
      const eased = Math.min(1, Math.max(0, intensity));
      flashMaterial.opacity = eased;
      flash.scale.setScalar(FLASH_SIZE * (0.55 + 0.45 * eased));
    },

    pose() {
      const { x, y, z } = object.position;
      return { x, y, z, pitch: object.rotation.x, flashVisible: flash.visible };
    },
  };
}
