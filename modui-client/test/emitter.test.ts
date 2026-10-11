// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/emitter';

interface Events {
  a: { n: number; origin?: 'local' | 'remote'; source?: unknown };
  b: { text: string };
}

let thrown: unknown[];
const realQueueMicrotask = globalThis.queueMicrotask;

beforeEach(() => {
  thrown = [];
  // Errors of handlers are rethrown from a microtask; collect them instead of failing the run.
  globalThis.queueMicrotask = (task: () => void) => {
    try {
      task();
    } catch (error) {
      thrown.push(error);
    }
  };
});
afterEach(() => {
  globalThis.queueMicrotask = realQueueMicrotask;
});

describe('Emitter', () => {
  it('delivers to the subscribers of the event, in the order they subscribed', () => {
    const emitter = new Emitter<Events>();
    const log: string[] = [];
    emitter.on('a', () => log.push('first'));
    emitter.on('a', () => log.push('second'));
    emitter.on('b', () => log.push('other event'));
    emitter.emit('a', { n: 1 });
    expect(log).toEqual(['first', 'second']);
  });

  it('unsubscribes with the returned function, which can be called twice', () => {
    const emitter = new Emitter<Events>();
    const handler = vi.fn();
    const off = emitter.on('a', handler);
    emitter.emit('a', { n: 1 });
    off();
    off();
    emitter.emit('a', { n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('once() runs the handler a single time', () => {
    const emitter = new Emitter<Events>();
    const handler = vi.fn();
    emitter.once('a', handler);
    emitter.emit('a', { n: 1 });
    emitter.emit('a', { n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('ends a subscription when its AbortSignal aborts, and ignores a signal that is already aborted', () => {
    const emitter = new Emitter<Events>();
    const handler = vi.fn();
    const controller = new AbortController();
    emitter.on('a', handler, { signal: controller.signal });
    emitter.emit('a', { n: 1 });
    controller.abort();
    emitter.emit('a', { n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    emitter.on('a', late, { signal: controller.signal });
    emitter.emit('a', { n: 3 });
    expect(late).not.toHaveBeenCalled();
  });

  it('skips the events of the given source (ignoreSource) and the local ones (ignoreLocal)', () => {
    const emitter = new Emitter<Events>();
    const mine = Symbol('mine');
    const all = vi.fn();
    const notMine = vi.fn();
    const notLocal = vi.fn();
    emitter.on('a', all);
    emitter.on('a', notMine, { ignoreSource: mine });
    emitter.on('a', notLocal, { ignoreLocal: true });

    emitter.emit('a', { n: 1, origin: 'local', source: mine });
    emitter.emit('a', { n: 2, origin: 'local', source: Symbol('other') });
    emitter.emit('a', { n: 3, origin: 'remote' });

    expect(all.mock.calls.map(([e]) => e.n)).toEqual([1, 2, 3]);
    expect(notMine.mock.calls.map(([e]) => e.n)).toEqual([2, 3]);
    expect(notLocal.mock.calls.map(([e]) => e.n)).toEqual([3]);
  });

  it('delivers only the payloads a filter accepts', () => {
    const emitter = new Emitter<Events>();
    const handler = vi.fn();
    emitter.on('a', handler, {}, (payload) => payload.n % 2 === 0);
    emitter.emit('a', { n: 1 });
    emitter.emit('a', { n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 2 });
  });

  it('never runs a handler inside another delivery: an event emitted by a handler is delivered after it, in order', () => {
    const emitter = new Emitter<Events>();
    const log: string[] = [];
    emitter.on('a', ({ n }) => {
      log.push(`a${n} start`);
      if (n === 1) {
        emitter.emit('a', { n: 2 });
        emitter.emit('b', { text: 'x' });
      }
      log.push(`a${n} end`);
    });
    emitter.on('a', ({ n }) => log.push(`a${n} second handler`));
    emitter.on('b', () => log.push('b'));

    emitter.emit('a', { n: 1 });
    expect(log).toEqual(['a1 start', 'a1 end', 'a1 second handler', 'a2 start', 'a2 end', 'a2 second handler', 'b']);
  });

  it('keeps the other handlers working when one throws, and rethrows the error asynchronously', () => {
    const emitter = new Emitter<Events>();
    const after = vi.fn();
    const boom = new Error('boom');
    emitter.on('a', () => {
      throw boom;
    });
    emitter.on('a', after);

    expect(() => emitter.emit('a', { n: 1 })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(thrown).toEqual([boom]);

    emitter.emit('a', { n: 2 }); // still usable
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('applies a subscription made during a delivery from the next event, and an unsubscription at once', () => {
    const emitter = new Emitter<Events>();
    const late = vi.fn();
    const removed = vi.fn();
    let offRemoved: () => void = () => undefined;
    emitter.on('a', () => {
      emitter.on('a', late);
      offRemoved();
    });
    offRemoved = emitter.on('a', removed);

    emitter.emit('a', { n: 1 });
    expect(late).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled(); // removed by the first handler before its turn
    emitter.emit('a', { n: 2 });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('defer() runs a task in the order of the events', () => {
    const emitter = new Emitter<Events>();
    const log: string[] = [];
    emitter.on('a', () => {
      log.push('handler');
      emitter.defer(() => log.push('deferred'));
      emitter.emit('b', { text: 'later' });
    });
    emitter.on('b', () => log.push('b'));
    emitter.emit('a', { n: 1 });
    expect(log).toEqual(['handler', 'deferred', 'b']);
  });

  it('once() with a signal does not leave its abort listener on the signal after it fired', () => {
    const emitter = new Emitter<Events>();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    emitter.once('a', () => undefined, { signal: controller.signal });
    emitter.emit('a', { n: 1 });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(emitter.listenerCount('a')).toBe(0);
  });

  it('an unsubscribe (and an abort) release the abort listener too', () => {
    const emitter = new Emitter<Events>();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    emitter.on('a', () => undefined, { signal: controller.signal })();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount()).toBe(0);
  });

  it('dropScope() ends every subscription of the scope, of any event, and leaves the others', () => {
    const emitter = new Emitter<Events>();
    const scope = {};
    const kept = vi.fn();
    const dropped = vi.fn();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    emitter.on('a', dropped, { signal: controller.signal }, undefined, scope);
    emitter.once('b', dropped, {}, undefined, scope);
    emitter.on('a', kept, {}, undefined, {});
    expect(emitter.listenerCount()).toBe(3);

    emitter.dropScope(scope);

    expect(emitter.listenerCount()).toBe(1);
    expect(remove).toHaveBeenCalled();
    emitter.emit('a', { n: 1 });
    emitter.emit('b', { text: 'x' });
    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });
});
