/**
 * The combat system (order 70): the DOM and render edge of US1. Every decision
 * lives in `src/combat/` and is tested without a page; this file binds the fire
 * bindings and the select keys to the one command path, steps the gate once per
 * frame, traces what it resolved from the camera centre, and publishes what the
 * harness reads (FR-006, FR-008, FR-018). Neither `src/main.ts` nor
 * `src/diag/diag.ts` is edited: 001's glob discovery finds this file and `combat`
 * arrives by module augmentation. Order 70 is after the player systems (30-36)
 * and enemies (60), so the ray leaves from where the frame left the camera and a
 * guard is shot where its tick left it — from the camera centre and nowhere else,
 * US4's view-model being cosmetic (Clarifications, US4-S8).
 */
import { Vector3 } from 'three';
import { defineSystem, type GameContext } from '../../boot/registry';
import { LEVEL_GRID, TILE_SIZE } from '../../level';
import { openTiles } from '../../interaction/open-state';
import type { OpenState } from '../../player/tiles';
import { ensureCombatDiag, publishAmmo, type CombatDiagnostics } from '../../combat/combat-diag';
import {
  createFireControl, createFireInput, fireSourceForKeyCode, fireSourceForMouseButton,
  stepFireControl, type FireControlState, type FireInput,
} from '../../combat/fire-control';
import { traceShot, type HitscanGuard, type ShotResult } from '../../combat/hitscan';
import { SPREAD_SEED, spreadDirection } from '../../combat/spread';
import { commandsResolve } from '../../combat/run-state';
import { weaponForKeyCode, type WeaponKind } from '../../combat/weapons';
import { getEnemyWorld } from '../enemies/register';

const MILLISECONDS_PER_SECOND = 1000;

let control: FireControlState | null = null;
let input: FireInput | null = null;
let combat: CombatDiagnostics | null = null;

/** The digit key pressed since the last frame, consumed by the next update. */
let pendingSelect: WeaponKind | null = null;

/** Guards already counted as killed, so one death scores once. */
const countedDead = new Set<string>();
let hits = 0;
let kills = 0;

// Scratch vectors, allocated once: a traced frame must mint no garbage.
const cameraPosition = new Vector3();
const cameraForward = new Vector3();

/** What US2's restart resets the magazine and active weapon through. */
export function getFireControl(): FireControlState | null {
  return control;
}

/** US2's restart (FR-011): a fresh magazine, the default weapon and the shot
 *  counters at zero. `countedDead` goes too — guard ids repeat across a rebuilt
 *  world, so a stale entry would swallow that guard's next kill. */
export function resetCombatRun(): void {
  control = createFireControl();
  input?.clear();
  pendingSelect = null;
  countedDead.clear();
  hits = 0;
  kills = 0;
  publish();
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

  // The same command's second binding, not a second command: both reach the gate
  // as one flag, so both down on a frame is one shot (US1-S10).
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

/** Newly dead guards, counted once each: nothing but the player's fire damages
 *  a guard yet, so a death is a kill. */
function countKills(): void {
  for (const record of getEnemyWorld()?.records ?? []) {
    if (record.state !== 'death' || countedDead.has(record.id)) continue;
    countedDead.add(record.id);
    kills += 1;
  }
}

function resolveShots(ctx: GameContext, deltaSeconds: number): void {
  if (control == null || input == null) return;

  // Gathered on the frame's first shot and not before: most frames fire none, and
  // a per-frame guard list would be garbage minted for nothing.
  let targets: HitscanGuard[] | null = null;
  const ids: string[] = [];
  let doorStates: OpenState = new Set<string>();
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
    doorStates = openTiles();
    targets = [];
    for (const record of getEnemyWorld()?.records ?? []) {
      targets.push({ x: record.guard.x, z: record.guard.z, alive: record.state !== 'death' });
      ids.push(record.id);
    }
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

    // The gate FR-010 closes on death: nothing resolves while it is shut, and a
    // trigger held across it does not fire the frames it missed.
    if (commandsResolve()) {
      resolveShots(ctx, deltaMs / MILLISECONDS_PER_SECOND);
    } else {
      pendingSelect = null;
    }

    countKills();
    publish();
  },
});
