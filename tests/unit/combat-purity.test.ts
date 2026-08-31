import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEAPON_TABLE } from '../../src/combat/weapons';
import { spreadDirection } from '../../src/combat/spread';
import { traceShot } from '../../src/combat/hitscan';
import { createFireControl, stepFireControl } from '../../src/combat/fire-control';
import {
  COMBAT_DIAGNOSTIC_FIELDS, createCombatDiagnostics, ensureCombatDiag, publishAmmo,
} from '../../src/combat/combat-diag';
import {
  RUN_COMMANDS_RESOLVE_DEFAULT, commandsResolve, resetRunState, setCommandsResolve,
} from '../../src/combat/run-state';
import { createDiagnostics } from '../../src/diag/diag';

// FR-001 / US1-S1, two claims. *Purity*: neither `three` nor a DOM API appears
// anywhere in the four modules' import graph, walked transitively because a pure
// file importing an impure one is not pure; the imports above loading under
// vitest's node environment is half the proof, the source scan catches a
// lazy-branch reference. *Arguments, not globals*: the source names no module
// that publishes the world, and the same call with a different argument answers
// differently.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|HTMLImageElement|CanvasRenderingContext2D|ImageData|createImageBitmap|requestAnimationFrame|addEventListener|removeEventListener|getElementById|createElement|MouseEvent|KeyboardEvent)\b/;

/** What a module would name to read the live world instead of its arguments. */
const WORLD_GLOBAL =
  /\b(LEVEL_GRID|ENEMY_SPAWNS|ITEM_SPAWNS|openTiles|liveOpenTiles|getPlayerState|createEnemyWorld|getEnemyWorld)\b/;

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

const ENTRY_POINTS = [
  'combat/weapons.ts',
  'combat/spread.ts',
  'combat/hitscan.ts',
  'combat/fire-control.ts',
] as const;

const readSource = (path: string): string => readFileSync(path, 'utf8');

/** Every file reachable from `entry` by relative import, `entry` included. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const match of readSource(path).matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1]!;
      queue.push(resolve(dirname(path), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
    }
  }
  return [...seen].sort();
}

const graphs = new Map(ENTRY_POINTS.map((entry) => [entry, importGraph(entry)]));

describe('combat module purity (FR-001, US1-S1)', () => {
  it.each(ENTRY_POINTS)('%s reaches only files free of three and of the DOM', (entry) => {
    for (const path of graphs.get(entry)!) {
      const source = readSource(path);
      expect(THREE_IMPORT.test(source), `${path} imports three`).toBe(false);
      const dom = DOM_GLOBAL.exec(source);
      if (dom) throw new Error(`${path} references the browser global ${dom[0]}`);
    }
  });

  it('walks a graph wider than the four entry points, so the check is not vacuous', () => {
    // hitscan reaches 003's tile predicates; were the walk to collapse to the
    // entry files alone, the scan above would stop proving anything.
    const reached = new Set(ENTRY_POINTS.flatMap((entry) => graphs.get(entry)!));
    expect(reached.size).toBeGreaterThan(ENTRY_POINTS.length);
  });

  it('loads all four modules from a test file that defines no window', () => {
    expect('window' in globalThis).toBe(false);
    expect(Object.keys(WEAPON_TABLE)).toHaveLength(3);
    expect(spreadDirection).toBeTypeOf('function');
    expect(traceShot).toBeTypeOf('function');
    expect(stepFireControl).toBeTypeOf('function');
  });
});

describe('hitscan takes the world as arguments (FR-001, US1-S1)', () => {
  it('names no module-level source of grid, door state or guard list', () => {
    for (const entry of ENTRY_POINTS) {
      const match = WORLD_GLOBAL.exec(readSource(resolve(SRC, entry)));
      if (match) throw new Error(`${entry} reads the global ${match[0]} instead of an argument`);
      expect(match).toBeNull();
    }
  });

  const base = {
    grid: ['1111111', '1000001', '1111111'],
    doorStates: new Set<string>(),
    guards: [] as { x: number; z: number }[],
    origin: { x: 1.5, z: 1.5 },
    direction: { x: 1, z: 0 },
    maxRange: 10,
    damage: 7,
  };

  it('answers differently for each of grid, door state and guard list', () => {
    // The grid, passed twice with one cell changed.
    expect(traceShot({ ...base, grid: ['1111', '1001', '1001', '1111'] }).distance).toBeCloseTo(1.5, 10);
    expect(traceShot({ ...base, grid: ['1111', '1011', '1001', '1111'] }).distance).toBeCloseTo(0.5, 10);
    // The door state, at a range short enough that an open door leaves nothing else in reach.
    const doored = { ...base, grid: ['11111', '10D01', '10001', '11111'], maxRange: 1.5 };
    expect(traceShot(doored).outcome).toBe('wall');
    expect(traceShot({ ...doored, doorStates: new Set(['2,1']) }).outcome).toBe('none');
    // The guard list.
    expect(traceShot(base).outcome).toBe('wall');
    expect(traceShot({ ...base, guards: [{ x: 3.5, z: 1.5 }] }).outcome).toBe('guard');
  });

  it('carries no run state between calls: fire control state is a value', () => {
    const a = createFireControl();
    const b = createFireControl();
    stepFireControl(a, {
      deltaSeconds: 1,
      fire: true,
      trace: () => ({ outcome: 'none', distance: 0, guardIndex: -1, damage: 0 }),
    });
    expect(b.shotsFired).toBe(0);
    expect(a.shotsFired).toBeGreaterThan(0);
  });
});

// FR-008 / US1-S10. The one gate every player command consults: US1 reads it from
// the fire path, US2 closes it on death. FR-018's published shape is asserted by
// US4's smoke harness against the running page (FR-019), not here.

describe('the run-state gate and the published shape (FR-008, FR-010, FR-018)', () => {
  it('resolves by default, closes and reopens through one setter, and resets', () => {
    resetRunState();
    expect(RUN_COMMANDS_RESOLVE_DEFAULT).toBe(true);
    expect(commandsResolve()).toBe(true);
    setCommandsResolve(false);
    expect(commandsResolve()).toBe(false);
    setCommandsResolve(true);
    expect(commandsResolve()).toBe(true);
    setCommandsResolve(false);
    resetRunState(); // what US2's restart calls
    expect(commandsResolve()).toBe(RUN_COMMANDS_RESOLVE_DEFAULT);
  });

  it('declares the whole FR-018 field set zeroed, and attaches it additively', () => {
    const combat = createCombatDiagnostics();
    expect(Object.keys(combat).sort()).toEqual([...COMBAT_DIAGNOSTIC_FIELDS].sort());
    expect(combat.kills).toBe(0);
    expect(combat.dead).toBe(false);
    // Published by copy, so the diagnostics never alias the live magazine.
    publishAmmo(combat, { pistol: 1, smg: 2, chaingun: 3 });
    expect(combat.ammo).toEqual({ pistol: 1, smg: 2, chaingun: 3 });
    // Attached additively: no 001-006 field is renamed or replaced.
    const diag = createDiagnostics('webgl');
    const before = Object.keys(diag).sort();
    expect(ensureCombatDiag(diag)).toBe(ensureCombatDiag(diag));
    expect(Object.keys(diag).sort()).toEqual([...before, 'combat'].sort());
  });
});
