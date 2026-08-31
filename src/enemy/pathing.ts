// A* over the level grid: an ordered adjacent-cell path, or the declared
// `unreachable` result (FR-003, FR-004, US2-S1..S4, US2-S9). Pure: no DOM, no
// three.js (FR-001).
//
// The search is bounded before it is anything else. `MAX_NODE_EXPANSIONS` is the
// single named constant the spec's clarification asks for, every result reports
// the count it actually spent, and exhausting the budget ends the search with
// `unreachable` rather than pressing on. A guard therefore cannot stall a frame
// however pathological the map, which is the whole point of this module.
//
// The search is deterministic second. The open set is ordered by a *total*
// comparison — f, then h, then cell index, then insertion sequence — so two
// calls with the same grid and the same door state cannot tie-break differently
// and return different equal-cost paths (US2-S9, SC-003). Nothing here reads a
// clock or a generator.

import { isTileBlocking } from '../player/tiles';
import type { OpenState } from '../player/tiles';
import type { Cell } from './guard';
import { isUnreachable } from './step';
import type { PathFound, PathResult, PathUnreachable } from './step';

export { isUnreachable };
export type { PathFound, PathResult, PathUnreachable };

/**
 * The declared node-expansion cap (FR-004). One 64x64 grid is 4096 cells, so a
 * search may expand every cell of the level exactly once and no more; anything
 * past that is a map big enough to stall a frame, and is refused.
 */
export const MAX_NODE_EXPANSIONS = 4096;

/** Neighbour order, fixed. Orthogonal only: US2-S1 wants adjacent cells, and a
 *  diagonal step would let a guard walk the pinwheel `los.ts` refuses to see
 *  through. Declared as one flat table so expansion allocates nothing per cell. */
const NEIGHBOUR_DX = [0, 1, 0, -1] as const;
const NEIGHBOUR_DZ = [-1, 0, 1, 0] as const;

/** One entry of the open set. `seq` is the last tie-break, so the ordering below
 *  is total and no two entries can ever compare equal. */
interface OpenNode {
  readonly node: number;
  readonly f: number;
  readonly h: number;
  readonly seq: number;
}

/** The deterministic ordering (T015): cheapest f, then nearest goal, then the
 *  lowest cell index, then the oldest entry. Every field after `f` exists to
 *  break a tie the previous one left, so the result never depends on the order
 *  the heap happened to be built in. */
function precedes(a: OpenNode, b: OpenNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  if (a.node !== b.node) return a.node < b.node;
  return a.seq < b.seq;
}

/** A binary min-heap over `precedes`. Small enough to keep here rather than in a
 *  module of its own; nothing else in this spec needs a priority queue. */
class OpenSet {
  private readonly items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: OpenNode): void {
    const items = this.items;
    items.push(entry);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!precedes(items[index]!, items[parent]!)) break;
      items[index] = items[parent]!;
      items[parent] = entry;
      index = parent;
    }
  }

  pop(): OpenNode | undefined {
    const items = this.items;
    const top = items[0];
    if (top === undefined) return undefined;
    const last = items.pop()!;
    if (items.length === 0) return top;
    items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < items.length && precedes(items[left]!, items[best]!)) best = left;
      if (right < items.length && precedes(items[right]!, items[best]!)) best = right;
      if (best === index) break;
      const swap = items[best]!;
      items[best] = items[index]!;
      items[index] = swap;
      index = best;
    }
    return top;
  }
}

/** The widest row, so one flat index serves a grid whose rows are ragged. */
function gridWidth(grid: string[]): number {
  let width = 0;
  for (const row of grid) width = Math.max(width, row.length);
  return width;
}

/** Manhattan distance — admissible and consistent for four-way unit steps, so
 *  the first time the goal is popped its path is already optimal. */
function heuristic(fromX: number, fromZ: number, to: Cell): number {
  return Math.abs(to.x - fromX) + Math.abs(to.z - fromZ);
}

function unreachable(nodesExpanded: number): PathUnreachable {
  return { unreachable: true, nodesExpanded };
}

/**
 * A route from `from` to `to` over `grid`, treating a door tile as passable only
 * while `doorStates` marks it open (FR-003).
 *
 * The returned `cells` begin at `from` and end at `to`, every consecutive pair
 * orthogonally adjacent and no cell blocking (US2-S1). When no route exists — or
 * when the search spends `maxExpansions` without finding one — the declared
 * unreachable value is returned instead: never `null`, never an empty array, and
 * never a partial path (FR-003, FR-004, US2-S2).
 */
export function findPath(
  grid: string[],
  doorStates: OpenState,
  from: Cell,
  to: Cell,
  maxExpansions: number = MAX_NODE_EXPANSIONS,
): PathResult {
  const width = gridWidth(grid);
  const height = grid.length;
  const inBounds = (x: number, z: number): boolean =>
    x >= 0 && z >= 0 && x < width && z < height;

  if (!inBounds(from.x, from.z) || !inBounds(to.x, to.z)) return unreachable(0);
  // A goal standing on a wall, or behind a door that is shut, is unreachable
  // without spending a single expansion on finding that out.
  if (isTileBlocking(grid, to.x, to.z, doorStates)) return unreachable(0);

  const startIndex = from.z * width + from.x;
  const goalIndex = to.z * width + to.x;
  if (startIndex === goalIndex) return { cells: [{ x: from.x, z: from.z }], nodesExpanded: 0 };

  const cells = width * height;
  const gScore = new Float64Array(cells).fill(Infinity);
  const cameFrom = new Int32Array(cells).fill(-1);
  const closed = new Uint8Array(cells);

  const open = new OpenSet();
  let seq = 0;
  gScore[startIndex] = 0;
  open.push({
    node: startIndex,
    f: heuristic(from.x, from.z, to),
    h: heuristic(from.x, from.z, to),
    seq: seq += 1,
  });

  let nodesExpanded = 0;
  while (open.size > 0) {
    const current = open.pop()!;
    if (closed[current.node] === 1) continue;

    if (current.node === goalIndex) {
      return { cells: reconstruct(cameFrom, startIndex, goalIndex, width), nodesExpanded };
    }
    // The budget is spent on *expansions*, checked before taking another one, so
    // the reported count can never exceed the cap (FR-004, US2-S4).
    if (nodesExpanded >= maxExpansions) return unreachable(nodesExpanded);

    closed[current.node] = 1;
    nodesExpanded += 1;

    const x = current.node % width;
    const z = (current.node - x) / width;
    const tentative = gScore[current.node]! + 1;

    for (let side = 0; side < 4; side += 1) {
      const nx = x + NEIGHBOUR_DX[side]!;
      const nz = z + NEIGHBOUR_DZ[side]!;
      if (!inBounds(nx, nz)) continue;
      const neighbour = nz * width + nx;
      if (closed[neighbour] === 1) continue;
      if (isTileBlocking(grid, nx, nz, doorStates)) continue;
      if (tentative >= gScore[neighbour]!) continue;
      gScore[neighbour] = tentative;
      cameFrom[neighbour] = current.node;
      const h = heuristic(nx, nz, to);
      open.push({ node: neighbour, f: tentative + h, h, seq: (seq += 1) });
    }
  }

  return unreachable(nodesExpanded);
}

/** The chain of cells the search recorded, start first and goal last. */
function reconstruct(
  cameFrom: Int32Array,
  startIndex: number,
  goalIndex: number,
  width: number,
): readonly Cell[] {
  const reversed: Cell[] = [];
  let node = goalIndex;
  while (node !== -1) {
    const x = node % width;
    reversed.push({ x, z: (node - x) / width });
    if (node === startIndex) break;
    node = cameFrom[node]!;
  }
  reversed.reverse();
  return reversed;
}
