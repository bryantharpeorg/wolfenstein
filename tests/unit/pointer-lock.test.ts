import { describe, it, expect } from 'vitest';
import {
  createPointerLockAdapter,
  type PointerLockTarget,
  type PointerLockEventSource,
} from '../../src/player/pointer-lock';

type Listener = (event: unknown) => void;

class FakeEventTarget {
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((l) => l !== listener));
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeTarget extends FakeEventTarget implements PointerLockTarget {
  requestPointerLockImpl: () => void | Promise<void> = () => {};

  requestPointerLock(): void | Promise<void> {
    return this.requestPointerLockImpl();
  }
}

class FakeEventSource extends FakeEventTarget implements PointerLockEventSource {
  pointerLockElement: PointerLockTarget | null = null;
}

describe('pointer-lock adapter', () => {
  it('reports pointerLocked truthfully when the lock is granted', () => {
    const target = new FakeTarget();
    const source = new FakeEventSource();
    const adapter = createPointerLockAdapter(target, source);

    expect(adapter.pointerLocked).toBe(false);

    target.emit('click', {});
    source.pointerLockElement = target;
    source.emit('pointerlockchange', {});

    expect(adapter.pointerLocked).toBe(true);
  });

  it('records no error and stays unlocked when requestPointerLock throws', () => {
    const target = new FakeTarget();
    target.requestPointerLockImpl = () => {
      throw new Error('denied');
    };
    const source = new FakeEventSource();
    const adapter = createPointerLockAdapter(target, source);

    expect(() => target.emit('click', {})).not.toThrow();
    expect(adapter.pointerLocked).toBe(false);
  });

  it('records no error and stays unlocked when requestPointerLock rejects', async () => {
    const target = new FakeTarget();
    target.requestPointerLockImpl = () => Promise.reject(new Error('denied'));
    const source = new FakeEventSource();
    const adapter = createPointerLockAdapter(target, source);

    target.emit('click', {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adapter.pointerLocked).toBe(false);
  });

  it('accumulates deltas only while locked', () => {
    const target = new FakeTarget();
    const source = new FakeEventSource();
    const adapter = createPointerLockAdapter(target, source);

    // Not locked: mousemove is ignored.
    source.emit('mousemove', { movementX: 10, movementY: 5 });
    expect(adapter.drainDeltas()).toEqual({ deltaX: 0, deltaY: 0 });

    // Lock, then accumulate.
    source.pointerLockElement = target;
    source.emit('pointerlockchange', {});
    source.emit('mousemove', { movementX: 10, movementY: 5 });
    source.emit('mousemove', { movementX: -3, movementY: 2 });
    expect(adapter.drainDeltas()).toEqual({ deltaX: 7, deltaY: 7 });

    // Drained: cleared.
    expect(adapter.drainDeltas()).toEqual({ deltaX: 0, deltaY: 0 });
  });

  it('clears deltas when the lock is released', () => {
    const target = new FakeTarget();
    const source = new FakeEventSource();
    const adapter = createPointerLockAdapter(target, source);

    source.pointerLockElement = target;
    source.emit('pointerlockchange', {});
    source.emit('mousemove', { movementX: 10, movementY: 5 });

    // Release the lock (Esc).
    source.pointerLockElement = null;
    source.emit('pointerlockchange', {});

    expect(adapter.pointerLocked).toBe(false);
    expect(adapter.drainDeltas()).toEqual({ deltaX: 0, deltaY: 0 });
  });

  it('dispose removes the listeners it installed', () => {
    const target = new FakeTarget();
    const source = new FakeEventSource();
    const adapter = createPointerLockAdapter(target, source);

    adapter.dispose();

    // After dispose, a click no longer requests the lock.
    target.requestPointerLockImpl = () => {
      throw new Error('should not be called');
    };
    expect(() => target.emit('click', {})).not.toThrow();
  });
});
