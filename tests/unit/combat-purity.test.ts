import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEAPON_TABLE } from '../../src/combat/weapons';
import { spreadDirection } from '../../src/combat/spread';
import { traceShot } from '../../src/combat/hitscan';
import { createFireControl, stepFireControl } from '../../src/combat/fire-control';

// FR-001 / US1-S1. Two claims, both made executable.
//
// *Purity.* Neither `three` nor a DOM API appears anywhere in the four modules'
// import graph — walked transitively, because a pure file that imports an impure
// one is not pure. The imports above succeeding under vitest's node environment
// (which defines no `window`) is the first half of the proof; the source-text
// scan below is the half that catches a reference sitting behind a lazy branch.
//
// *Arguments, not globals.* The grid, the door state and the guard list reach
// hitscan as parameters. Asserted twice: the source names none of the modules
// that publish those things globally, and the same call with a different grid
// returns a different answer.

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|HTMLImageElement|CanvasRenderingContext2D|ImageData|createImageBitmap|requestAnimationFrame|addEventListener|removeEventListener|getElementById|createElement|MouseEvent|KeyboardEvent)\b/;

/** What a module would have to name to read the live world instead of its arguments. */
const WORLD_GLOBAL =
  /\b(LEVEL_GRID|ENEMY_SPAWNS|ITEM_SPAWNS|openTiles|liveOpenTiles|getPlayerState|createEnemyWorld|getEnemyWorld)\b/;

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

const ENTRY_POINTS = [
  'combat/weapons.ts',
  'combat/spread.ts',
  'combat/hitscan.ts',
  'combat/fire-control.ts',
] as const;

const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Every file reachable from `entry` by relative import, `entry` included. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = readSource(path);
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1]!;
      const resolved = resolve(dirname(path), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`);
      queue.push(resolved);
    }
  }
  return [...seen].sort();
}

const graphs = new Map(ENTRY_POINTS.map((entry) => [entry, importGraph(entry)]));

describe('combat module purity (FR-001, US1-S1)', () => {
  it.each(ENTRY_POINTS)('%s reaches only files that import no three', (entry) => {
    for (const path of graphs.get(entry)!) {
      expect(THREE_IMPORT.test(readSource(path)), `${path} imports three`).toBe(false);
    }
  });

  it.each(ENTRY_POINTS)('%s reaches only files that touch no DOM API', (entry) => {
    for (const path of graphs.get(entry)!) {
      const match = DOM_GLOBAL.exec(readSource(path));
      if (match) throw new Error(`${path} references the browser global ${match[0]}`);
      expect(match).toBeNull();
    }
  });

  it('walks a graph wider than the four entry points, so the check is not vacuous', () => {
    // hitscan reaches 003's tile predicates; if the walk ever collapsed to the
    // entry files alone the DOM scan above would stop proving anything.
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
      const source = readSource(resolve(SRC, entry));
      const match = WORLD_GLOBAL.exec(source);
      if (match) throw new Error(`${entry} reads the global ${match[0]} instead of an argument`);
      expect(match).toBeNull();
    }
  });

  it('answers differently for two grids passed to the same call', () => {
    const open: string[] = ['1111', '1001', '1001', '1111'];
    const walled: string[] = ['1111', '1011', '1001', '1111'];
    const shot = {
      doorStates: new Set<string>(),
      guards: [],
      origin: { x: 1.5, z: 1.5 },
      direction: { x: 1, z: 0 },
      maxRange: 10,
      damage: 1,
    };
    expect(traceShot({ ...shot, grid: open }).distance).toBeCloseTo(1.5, 10);
    expect(traceShot({ ...shot, grid: walled }).distance).toBeCloseTo(0.5, 10);
  });

  it('answers differently for two door states passed to the same call', () => {
    const grid: string[] = ['11111', '10D01', '10001', '11111'];
    const shot = {
      grid,
      guards: [],
      origin: { x: 1.5, z: 1.5 },
      direction: { x: 1, z: 0 },
      // Short enough that an open door leaves nothing else in range.
      maxRange: 1.5,
      damage: 1,
    };
    expect(traceShot({ ...shot, doorStates: new Set<string>() }).outcome).toBe('wall');
    expect(traceShot({ ...shot, doorStates: new Set(['2,1']) }).outcome).toBe('none');
  });

  it('answers differently for two guard lists passed to the same call', () => {
    const grid: string[] = ['1111111', '1000001', '1111111'];
    const shot = {
      grid,
      doorStates: new Set<string>(),
      origin: { x: 1.5, z: 1.5 },
      direction: { x: 1, z: 0 },
      maxRange: 10,
      damage: 7,
    };
    expect(traceShot({ ...shot, guards: [] }).outcome).toBe('wall');
    expect(traceShot({ ...shot, guards: [{ x: 3.5, z: 1.5 }] }).outcome).toBe('guard');
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
