// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A minimal typed event emitter (internal).
 * @module
 */

/** Removes a subscription. */
export type Off = () => void;

/** Typed event emitter. A throwing handler does not stop the others; the error is rethrown asynchronously. */
export class Emitter<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Off {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set!.delete(handler as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of Array.from(this.handlers.get(event) ?? [])) {
      try {
        (handler as (payload: Events[K]) => void)(payload);
      } catch (error) {
        setTimeout(() => {
          throw error;
        }, 0);
      }
    }
  }

  has<K extends keyof Events>(event: K): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
