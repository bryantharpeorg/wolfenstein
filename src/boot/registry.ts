/**
 * The system registry: how a story adds behaviour without editing a shared file.
 *
 * A story adds `src/systems/<name>/register.ts` and nothing else. Discovery is by
 * glob (see `discover.ts`), so there is no index to append to either — an index
 * file conflicts on adjacent lines just as readily as a wiring function does.
 */
import type { PerspectiveCamera, Scene } from 'three';
import type { Diagnostics } from '../diag/diag';

export type Backend = 'webgpu' | 'webgl';

/** What every system is handed. Additive only: adding a field must not break a system. */
export interface GameContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly diag: Diagnostics;
  readonly backend: Backend;
  /** Renderer type is left loose so a system need not import a backend-specific class. */
  readonly renderer: { render(scene: Scene, camera: PerspectiveCamera): void };
}

export interface System {
  /** Unique; also the tiebreaker for a stable order when two systems share `order`. */
  readonly name: string;
  /**
   * Lower runs first. Left as a number rather than a dependency graph on purpose —
   * ordering between systems is rare, and a graph would be a second scheduler to
   * maintain beside the workgraph's.
   */
  readonly order?: number;
  setup?(ctx: GameContext): void;
  /** `deltaMs` since the previous frame. */
  update?(ctx: GameContext, deltaMs: number): void;
  resize?(ctx: GameContext, width: number, height: number): void;
}

export const DEFAULT_ORDER = 100;

const registered = new Map<string, System>();

/** Register a system. Called for side effect from a `systems/<name>/register.ts`. */
export function defineSystem(system: System): System {
  if (registered.has(system.name)) {
    throw new Error(`duplicate system name: ${system.name}`);
  }
  registered.set(system.name, system);
  return system;
}

/** Registration order is not load order: sort so behaviour does not depend on glob order. */
export function collectSystems(): System[] {
  return [...registered.values()].sort((a, b) => {
    const byOrder = (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER);
    return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name);
  });
}

/** Test seam only. Production code never unregisters. */
export function resetSystemsForTest(): void {
  registered.clear();
}
