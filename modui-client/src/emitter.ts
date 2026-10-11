// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A small typed event emitter shared by the areas that notify the application ({@link Emitter}, internal).
 * @module
 */

/** Function returned by every `on()`: removes the subscription. Calling it twice is harmless. */
export type Unsubscribe = () => void;

/**
 * Where a change came from, on every event that describes one:
 * - `'local'`: this client caused it (a write it made, or a load/reset it asked for);
 * - `'remote'`: the backend announced it and nobody here asked for it (the classic UI, the HMI, another client, a plugin).
 *
 * Best effort: a change is `'local'` when this client had a matching request in flight when the frame arrived.
 */
export type Origin = 'local' | 'remote';

/** Fields of every event that describes a change of the running pedalboard. */
export interface EventMeta {
  origin: Origin;
  /**
   * The `source` given to the write that caused the change (`{ source }` in the options of the call), `undefined` when none was
   * given and for every `'remote'` change. Lets a component recognise its own changes.
   */
  source?: unknown;
}

/** Options of every `on()` / `once()`. */
export interface ListenOptions {
  /** Removes the subscription when the signal aborts (an alternative to the returned function). */
  signal?: AbortSignal;
  /** Skips the events whose `source` is this value (the component that made the write does not hear about it). */
  ignoreSource?: unknown;
  /** Skips every event whose `origin` is `'local'`: only changes made by someone else are delivered. */
  ignoreLocal?: boolean;
}

interface Listener {
  handler: (payload: any) => void;
  options: ListenOptions;
  filter?: (payload: any) => boolean;
  once: boolean;
  /** Group the subscription belongs to: {@link Emitter.dropScope} ends the whole group. */
  scope?: unknown;
  /** Releases what the subscription holds outside the emitter (the `abort` listener on its signal). */
  dispose?: () => void;
}

/**
 * Typed emitter with the delivery rules the whole client follows:
 *
 * - **Ordered and not nested**: `emit()` queues the delivery; a handler that causes another event (it calls `setValue()`, for
 *   instance) never runs inside the first delivery, the new event is delivered right after, in order.
 * - **Isolated**: a handler that throws does not stop the other handlers. The error is rethrown asynchronously
 *   (`queueMicrotask`), so it reaches `window.onerror` / `process 'uncaughtException'` and the developer tools.
 * - **Snapshot of listeners**: subscribing or unsubscribing during a delivery takes effect from the next event.
 */
export class Emitter<M extends { [K in keyof M]: object }> {
  private readonly listeners = new Map<keyof M, Set<Listener>>();
  private readonly queue: Array<() => void> = [];
  private delivering = false;

  /**
   * Subscribes to an event.
   * @param filter Internal: delivers only the payloads it accepts.
   * @param scope Internal: a group the subscription belongs to, ended by {@link Emitter.dropScope}.
   * @returns A function that removes the subscription.
   */
  on<K extends keyof M>(
    event: K,
    handler: (payload: M[K]) => void,
    options: ListenOptions = {},
    filter?: (payload: M[K]) => boolean,
    scope?: unknown,
  ): Unsubscribe {
    return this.add(event, { handler, options, filter, once: false, scope });
  }

  /** Like {@link Emitter.on}, but the handler runs at most once. */
  once<K extends keyof M>(
    event: K,
    handler: (payload: M[K]) => void,
    options: ListenOptions = {},
    filter?: (payload: M[K]) => boolean,
    scope?: unknown,
  ): Unsubscribe {
    return this.add(event, { handler, options, filter, once: true, scope });
  }

  /** Ends every subscription made with this `scope`, whatever its event. */
  dropScope(scope: unknown): void {
    for (const set of this.listeners.values()) {
      for (const listener of Array.from(set)) {
        if (listener.scope === scope) {
          set.delete(listener);
          listener.dispose?.();
        }
      }
    }
  }

  /** How many subscriptions are active (of one event, or of all). */
  listenerCount(event?: keyof M): number {
    if (event !== undefined) {
      return this.listeners.get(event)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }

  /** Delivers `payload` to the subscribers of `event` (queued if a delivery is running). */
  emit<K extends keyof M>(event: K, payload: M[K]): void {
    this.schedule(() => this.deliver(event, payload));
  }

  /** Runs `task` in the delivery order, after the events emitted before it. */
  defer(task: () => void): void {
    this.schedule(task);
  }

  private add(event: keyof M, listener: Listener): Unsubscribe {
    const signal = listener.options.signal;
    if (signal?.aborted) {
      return () => undefined;
    }
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    const onAbort = () => off();
    listener.dispose = () => signal?.removeEventListener('abort', onAbort);
    const off = () => {
      set!.delete(listener);
      listener.dispose!();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    return off;
  }

  private schedule(task: () => void): void {
    this.queue.push(task);
    if (this.delivering) {
      return;
    }
    this.delivering = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        try {
          next();
        } catch (error) {
          rethrowLater(error);
        }
      }
    } finally {
      this.delivering = false;
    }
  }

  private deliver<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    const meta = payload as { origin?: Origin; source?: unknown };
    for (const listener of Array.from(set)) {
      if (!set.has(listener)) {
        continue; // unsubscribed by an earlier handler of this same delivery
      }
      const { options } = listener;
      if (options.ignoreLocal && meta.origin === 'local') {
        continue;
      }
      if (options.ignoreSource !== undefined && meta.source === options.ignoreSource) {
        continue;
      }
      if (listener.filter && !listener.filter(payload)) {
        continue;
      }
      if (listener.once) {
        set.delete(listener);
        listener.dispose?.();
      }
      try {
        listener.handler(payload);
      } catch (error) {
        rethrowLater(error);
      }
    }
  }
}

function rethrowLater(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}
