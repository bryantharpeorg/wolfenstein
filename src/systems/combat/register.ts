/**
 * The combat system (order 70): the DOM and render edge of US1. Every decision
 * lives in `src/combat/` and is tested without a page; this file binds the two
 * fire bindings and the three select keys to the one command path, steps the
 * gate once per frame with the frame delta, traces whatever the gate resolved
 * from the camera centre, and publishes what the harness reads (FR-006, FR-008,
 * FR-018).
 *
 * `src/main.ts` is not edited — 001's glob discovery finds this file — and
 * neither is `src/diag/diag.ts`: the `combat` field arrives by the module
 * augmentation in `src/combat/combat-diag.ts`.
 *
 * It runs after the player systems (30-36), so the ray is traced from where this
 * frame left the camera, and after the enemies system (60), so a guard is shot
 * where this frame's tick left it. The ray originates at the camera centre and
 * nowhere else: US4's view-model is cosmetic and is never a ray origin
 * (Clarifications, US4-S8).
 */
import { Vector3 } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { LEVEL_GRID, TILE_SIZE } from '../../level';
import { openTiles } from '../../interaction/open-state';
import type { OpenState } from '../../player/tiles';
import { ensureCombatDiag, publishAmmo, type CombatDiagnostics } from '../../combat/combat-diag';
import {
  createFireControl,
  createFireInput,
  fireSourceForKeyCode,
  fireSourceForMouseButton,
  stepFireControl,
  type FireControlState,
  type FireInput,
} from '../../combat/fire-control';
import { traceShot, type HitscanGuard, type ShotResult } from '../../combat/hitscan';
import { SPREAD_SEED, spreadDirection } from '../../combat/spread';
import { commandsResolve } from '../../combat/run-state';
import { weaponForKeyCode, type WeaponKind } from '../../combat/weapons';
import { getEnemyWorld } from '../enemies/register';

const MILLISECONDS_PER_SECOND = 1000;

/** Stands in until the first shot of a frame asks for the real one. */
const EMPTY_DOOR_STATE: OpenState = new Set<string>();

let control: FireControlState | null = null;
let input: FireInput | null = null;
let combat: CombatDiagnostics | null = null;

/** The digit key pressed since the last frame, consumed by the next update. */
let pendingSelect: WeaponKind | null = null;

/** Guards already counted as killed, so one death scores once. */
const countedDead = new Set<string>();
let hits = 0;
let kills = 0;

// Scratch vectors, allocated once: the ray is traced every frame a shot resolves
// and must not mint garbage to do it.
const cameraPosition = new Vector3();
const cameraForward = new Vector3();

/** The run's fire control, or null before setup. US2's restart resets the
 *  magazine and the active weapon through this rather than by reaching into a
 *  module global of its own. */
export function getFireControl(): FireControlState | null {
  return control;
}

function publish(): void {
  if (combat == null || control == null) return;
  combat.weapon = control.weapon;
  publishAmmo(combat, control.ammo);
  combat.shotsFired = control.shotsFired;
  combat.hits = hits;
  combat.kills = kills;
}

function bindCommands(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const source = fireSourceForKeyCode(event.code);
    if (source != null) {
      input?.press(source);
      return;
    }
    const selected = weaponForKeyCode(event.code);
    if (selected != null) pendingSelect = selected;
  });

  window.addEventListener('keyup', (event: KeyboardEvent) => {
    const source = fireSourceForKeyCode(event.code);
    if (source != null) input?.release(source);
  });

  // The second binding of the same command, not a second command: both reach the
  // gate as one held flag, so both down on one frame is still one shot (US1-S10).
  window.addEventListener('mousedown', (event: MouseEvent) => {
    const source = fireSourceForMouseButton(event.button);
    if (source != null) input?.press(source);
  });

  window.addEventListener('mouseup', (event: MouseEvent) => {
    const source = fireSourceForMouseButton(event.button);
    if (source != null) input?.release(source);
  });

  // A trigger held across a focus change must not stick down.
  window.addEventListener('blur', () => input?.clear());
}

/** The live guards, as the hitscan sees them: cell positions and whether they
 *  can still be hit. Built only on a frame that actually resolves a shot. */
function liveGuards(): { targets: HitscanGuard[]; ids: string[] } {
  const world = getEnemyWorld();
  const targets: HitscanGuard[] = [];
  const ids: string[] = [];
  if (world == null) return { targets, ids };
  for (const record of world.records) {
    targets.push({ x: record.guard.x, z: record.guard.z, alive: record.state !== 'death' });
    ids.push(record.id);
  }
  return { targets, ids };
}

/** Newly dead guards, counted once each. Nothing but the player's own fire
 *  damages a guard at this milestone, so a death is a kill. */
function countKills(): void {
  const world = getEnemyWorld();
  if (world == null) return;
  for (const record of world.records) {
    if (record.state !== 'death' || countedDead.has(record.id)) continue;
    countedDead.add(record.id);
    kills += 1;
  }
}

function resolveShots(ctx: GameContext, deltaSeconds: number): void {
  if (control == null || input == null) return;

  // Everything the trace needs is gathered on the first shot of the frame and
  // not before: most frames resolve none, and a per-frame guard list would be
  // garbage minted for nothing.
  let targets: HitscanGuard[] | null = null;
  let ids: string[] = [];
  let doorStates: OpenState = EMPTY_DOOR_STATE;
  const origin = { x: 0, z: 0 };
  const forward = { x: 0, y: 0, z: 0 };

  const gather = (): HitscanGuard[] => {
    if (targets !== null) return targets;
    ctx.camera.getWorldPosition(cameraPosition);
    ctx.camera.getWorldDirection(cameraForward);
    origin.x = cameraPosition.x / TILE_SIZE;
    origin.z = cameraPosition.z / TILE_SIZE;
    forward.x = cameraForward.x;
    forward.y = cameraForward.y;
    forward.z = cameraForward.z;
    const live = liveGuards();
    targets = live.targets;
    ids = live.ids;
    doorStates = openTiles();
    return targets;
  };

  const struck: ShotResult[] = [];
  stepFireControl(control, {
    deltaSeconds,
    fire: input.held,
    select: pendingSelect,
    trace: ({ weapon, shotIndex }) => {
      const guards = gather();
      const direction = spreadDirection(forward, weapon.maxSpreadRadians, SPREAD_SEED, shotIndex);
      const result = traceShot({
        grid: LEVEL_GRID,
        doorStates,
        guards,
        origin,
        direction: { x: direction.x, z: direction.z },
        maxRange: weapon.maxRangeCells,
        damage: weapon.damage,
      });
      struck.push(result);
      return result;
    },
  });
  pendingSelect = null;

  const world = getEnemyWorld();
  for (const result of struck) {
    if (result.outcome !== 'guard') continue;
    hits += 1;
    const id = ids[result.guardIndex];
    if (id != null) world?.damageGuardById(id, result.damage);
  }
}

defineSystem({
  name: 'combat',
  order: 70,

  setup(ctx) {
    combat = ensureCombatDiag(ctx.diag);
    control = createFireControl();
    input = createFireInput();
    bindCommands();
    publish();
  },

  update(ctx, deltaMs) {
    if (control == null || input == null) return;

    // The one gate FR-010 closes on death: no command resolves while it is shut,
    // and a trigger still held when it reopens does not fire the frames it missed.
    if (commandsResolve()) {
      resolveShots(ctx, deltaMs / MILLISECONDS_PER_SECOND);
    } else {
      pendingSelect = null;
    }

    countKills();
    publish();
  },
});
