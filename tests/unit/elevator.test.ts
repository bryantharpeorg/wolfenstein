import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INTERACT_OUTCOMES, type InteractOutcome } from '../../src/interaction/outcomes';
import { LEVEL_GRID } from '../../src/level';
import {
  findExitTile,
  resolveElevator,
  shippedExitTile,
  type ExitTile,
} from '../../src/run/elevator';
import type { RunState } from '../../src/run/state';

// T002 (FR-001, US1-S1, US1-S2, US1-S4, US1-S6). The resolver is input to output:
// a player position, a health and a run state in, one declared outcome out. It
// never reads a live world, so every case below is one call.

const isDeclared = (outcome: InteractOutcome): boolean =>
  (INTERACT_OUTCOMES as readonly string[]).includes(outcome);

/** Standing in the middle of a tile, which is where a player is. */
const at = (x: number, z: number): { playerX: number; playerZ: number } => ({
  playerX: x + 0.5,
  playerZ: z + 0.5,
});

const exit: ExitTile = { x: 4, z: 3 };

function resolve(
  x: number,
  z: number,
  options: { health?: number; state?: RunState } = {},
): { outcome: InteractOutcome; exit: ExitTile | null } {
  return resolveElevator({
    ...at(x, z),
    health: options.health ?? 100,
    state: options.state ?? 'playing',
    exit,
  });
}

describe('the elevator resolver (FR-001)', () => {
  it('declares its outcomes in 004’s one set', () => {
    for (const outcome of ['exit-used', 'no-target', 'already-exiting', 'exit-refused-dead']) {
      expect(isDeclared(outcome as InteractOutcome)).toBe(true);
    }
  });

  it('finds the shipped level’s single E tile', () => {
    const found = findExitTile(LEVEL_GRID);
    expect(found).not.toBeNull();
    expect(LEVEL_GRID[found!.z]![found!.x]).toBe('E');
    const all = LEVEL_GRID.join('').split('').filter((cell) => cell === 'E');
    expect(all.length).toBe(1);
    expect(shippedExitTile()).toEqual(found);
  });

  it('answers exit-used adjacent and alive (US1-S1)', () => {
    // The exit tile itself and its four orthogonal neighbours are all in reach.
    for (const [x, z] of [
      [4, 3],
      [3, 3],
      [5, 3],
      [4, 2],
      [4, 4],
    ] as const) {
      const resolution = resolve(x, z);
      expect(resolution.outcome).toBe('exit-used');
      expect(resolution.exit).toEqual(exit);
    }
  });

  it('answers no-target from across the room (US1-S2)', () => {
    for (const [x, z] of [
      [6, 3],
      [4, 5],
      [2, 1],
      [40, 40],
    ] as const) {
      const resolution = resolve(x, z);
      expect(resolution.outcome).toBe('no-target');
      expect(resolution.exit).toBeNull();
    }
  });

  it('answers already-exiting while the lift travels, and once it has arrived (US1-S4)', () => {
    expect(resolve(4, 3, { state: 'exiting' }).outcome).toBe('already-exiting');
    expect(resolve(4, 3, { state: 'complete' }).outcome).toBe('already-exiting');
    // Still nothing in reach: distance is asked before the run state.
    expect(resolve(40, 40, { state: 'exiting' }).outcome).toBe('no-target');
  });

  it('refuses a player at zero health (US1-S6)', () => {
    const resolution = resolve(4, 3, { health: 0 });
    expect(resolution.outcome).not.toBe('exit-used');
    expect(isDeclared(resolution.outcome)).toBe(true);
    expect(resolution.outcome).toBe('exit-refused-dead');
    // A run already in `dead` is refused the same way.
    expect(resolve(4, 3, { health: 0, state: 'dead' }).outcome).toBe('exit-refused-dead');
    expect(resolve(4, 3, { health: 1 }).outcome).toBe('exit-used');
  });

  it('is a pure function: the same query answers the same way, forever', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(resolve(4, 3).outcome).toBe('exit-used');
      expect(resolve(9, 9).outcome).toBe('no-target');
    }
  });

  it('resolves against the shipped level when no exit tile is supplied', () => {
    const shipped = shippedExitTile()!;
    expect(
      resolveElevator({ ...at(shipped.x, shipped.z), health: 100, state: 'playing' }).outcome,
    ).toBe('exit-used');
    expect(
      resolveElevator({ playerX: 1.5, playerZ: 1.5, health: 100, state: 'playing' }).outcome,
    ).toBe('no-target');
  });
});

describe('src/run/ imports no DOM and no three.js (Constitution III)', () => {
  const RUN_DIR = fileURLToPath(new URL('../../src/run/', import.meta.url));
  const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
  const DOM_GLOBAL =
    /\b(window|document|navigator|localStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement|KeyboardEvent|MouseEvent)\b/;

  it('names neither in any module of the directory', () => {
    const files = readdirSync(RUN_DIR).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(RUN_DIR + name, 'utf8');
      expect(THREE_IMPORT.test(source), `${name} imports three`).toBe(false);
      expect(DOM_GLOBAL.test(source), `${name} names a DOM global`).toBe(false);
    }
  });
});
