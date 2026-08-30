// The pointer-lock DOM adapter. It requests pointer lock on click, listens for
// `pointerlockchange`, `pointerlockerror` and `mousemove`, and accumulates raw
// deltas since the last drain. The target element and event source are injected
// parameters, so the denial path is unit-testable without a browser (T002).
//
// A denied, errored or browser-revoked lock leaves `pointerLocked` false, throws
// nothing uncaught, and records nothing in `window.__diag.errors` (FR-004).

export interface MouseMoveLike {
  movementX: number;
  movementY: number;
}

export interface PointerLockTarget {
  requestPointerLock(): void | Promise<void>;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface PointerLockEventSource {
  pointerLockElement: PointerLockTarget | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface DrainedDeltas {
  deltaX: number;
  deltaY: number;
}

export interface PointerLockAdapter {
  readonly pointerLocked: boolean;
  drainDeltas(): DrainedDeltas;
  dispose(): void;
}

export function createPointerLockAdapter(
  target: PointerLockTarget,
  eventSource: PointerLockEventSource,
): PointerLockAdapter {
  let locked = false;
  let deltaX = 0;
  let deltaY = 0;

  function onClick(): void {
    try {
      const result = target.requestPointerLock();
      if (result != null && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch(() => {
          // Denied or errored: swallow, no uncaught exception, no error recorded.
        });
      }
    } catch {
      // Synchronous throw: swallow, no uncaught exception, no error recorded.
    }
  }

  function onPointerLockChange(): void {
    locked = eventSource.pointerLockElement === target;
    if (!locked) {
      // Lock released: clear any deltas accumulated before the release.
      deltaX = 0;
      deltaY = 0;
    }
  }

  function onPointerLockError(): void {
    // A failed request. `pointerlockchange` is the source of truth for `locked`;
    // here we only ensure no error escapes the adapter.
  }

  function onMouseMove(event: unknown): void {
    if (!locked) return;
    const move = event as MouseMoveLike;
    deltaX += move.movementX;
    deltaY += move.movementY;
  }

  target.addEventListener('click', onClick);
  eventSource.addEventListener('pointerlockchange', onPointerLockChange);
  eventSource.addEventListener('pointerlockerror', onPointerLockError);
  eventSource.addEventListener('mousemove', onMouseMove);

  return {
    get pointerLocked() {
      return locked;
    },
    drainDeltas() {
      const drained = { deltaX, deltaY };
      deltaX = 0;
      deltaY = 0;
      return drained;
    },
    dispose() {
      target.removeEventListener('click', onClick);
      eventSource.removeEventListener('pointerlockchange', onPointerLockChange);
      eventSource.removeEventListener('pointerlockerror', onPointerLockError);
      eventSource.removeEventListener('mousemove', onMouseMove);
    },
  };
}
