// Hand-drawn grid fixtures shared by the enemy test files. Kept out of the
// `.test.ts` glob deliberately: it declares no test, only the paper the pathing,
// sight and attack assertions are drawn on.

import { expect } from 'vitest';
import { isTileBlocking } from '../../src/player/tiles';
import type { Cell } from '../../src/enemy/step';

/** A mutable char matrix, indexed `[z][x]` the way `LEVEL_GRID` rows are. */
export type GridDraft = string[][];

export function solidDraft(width: number, height: number): GridDraft {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => '1'));
}

/** A solid border with open floor inside — the plain room most cases start from. */
export function roomDraft(width: number, height: number): GridDraft {
  const draft = solidDraft(width, height);
  for (let z = 1; z < height - 1; z += 1) {
    for (let x = 1; x < width - 1; x += 1) put(draft, x, z, '0');
  }
  return draft;
}

export function put(draft: GridDraft, x: number, z: number, cell: string): GridDraft {
  const row = draft[z];
  if (row === undefined) throw new Error(`row ${z} out of range`);
  row[x] = cell;
  return draft;
}

export const draw = (draft: GridDraft): string[] => draft.map((row) => row.join(''));

export const NO_OPEN_TILES: ReadonlySet<string> = new Set<string>();

export const openTileSet = (...keys: string[]): ReadonlySet<string> => new Set(keys);

/** Every cell a path could ever stand on, given no door is open. */
export function freeCellCount(grid: string[]): number {
  let count = 0;
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (!isTileBlocking(grid, x, z, NO_OPEN_TILES)) count += 1;
    }
  }
  return count;
}

/** US2-S1's shape check, stated once: ordered, orthogonally adjacent, wall-free. */
export function expectWalkablePath(
  grid: string[],
  doorStates: ReadonlySet<string>,
  cells: readonly Cell[],
  from: Cell,
  to: Cell,
): void {
  expect(cells.length).toBeGreaterThan(0);
  expect(cells[0]).toEqual(from);
  expect(cells[cells.length - 1]).toEqual(to);
  for (let i = 1; i < cells.length; i += 1) {
    const previous = cells[i - 1]!;
    const current = cells[i]!;
    const step = Math.abs(current.x - previous.x) + Math.abs(current.z - previous.z);
    expect(step, `cells ${i - 1}->${i} are not orthogonally adjacent`).toBe(1);
  }
  for (const cell of cells) {
    expect(
      isTileBlocking(grid, cell.x, cell.z, doorStates),
      `path crosses blocking cell ${cell.x},${cell.z}`,
    ).toBe(false);
  }
}
