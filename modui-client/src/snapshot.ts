// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Immutable snapshots of the running pedalboard for UI frameworks ({@link SnapshotStore}, the engine behind
 * `currentPedalboard.getSnapshot()` and `currentPedalboard.subscribe()`).
 * @module
 */

import { Emitter, type Unsubscribe } from './emitter';
import type { GraphChange, GraphModel, ModelPlugin } from './graph-state';
import type { PortDirection, PortType } from './types';

/** A plugin of the pedalboard in a {@link PedalboardSnapshot}. */
export interface PluginSnapshot {
  /** Instance path, e.g. `/graph/Gain`. */
  readonly instance: string;
  readonly uri: string;
  readonly x: number;
  readonly y: number;
  /** `false` when the plugin is bypassed. */
  readonly active: boolean;
  /** URI of the current preset, `null` when none. */
  readonly preset: string | null;
  /**
   * The value of each control port the client has seen (by symbol): from the state replay, `param_set` frames and its own writes.
   * A port that is missing is at its default, which `instance.params.get(symbol).default` tells.
   */
  readonly values: Readonly<Record<string, number>>;
  /** The raw text of each patch parameter the client has seen (by URI); `instance.patchParams.get(uri).value` parses it. */
  readonly patches: Readonly<Record<string, string>>;
}

/** A port of the pedalboard itself (physical, virtual or MIDI) in a {@link PedalboardSnapshot}. */
export interface PortSnapshot {
  readonly id: string;
  readonly type: PortType;
  /** Seen from the graph: the device's capture ports are `output`s (sources). */
  readonly direction: PortDirection;
  readonly title: string;
  readonly index: number;
}

/** A connection in a {@link PedalboardSnapshot}: ids of the output and the input port. */
export interface ConnectionSnapshot {
  readonly from: string;
  readonly to: string;
}

/**
 * The state of the running pedalboard at one moment: plain, frozen, JSON-serializable data.
 *
 * It is replaced, never changed: `getSnapshot()` returns the same object until something changes, and what did not change keeps
 * its identity (a `PluginSnapshot` that was not touched is the same object, an unchanged list is the same array), so
 * `React.memo`, `computed()` and the like skip it. Meters, device statistics and the connection state are not part of it.
 */
export interface PedalboardSnapshot {
  /** Increases with every new snapshot; `0` for the first (empty) one. */
  readonly version: number;
  /** The first state replay is complete and no pedalboard is loading. */
  readonly ready: boolean;
  /** A pedalboard is being (re)loaded: `plugins` and `connections` are empty until `ready` (`ports` keep their last value). */
  readonly loading: boolean;
  readonly plugins: ReadonlyArray<PluginSnapshot>;
  readonly connections: ReadonlyArray<ConnectionSnapshot>;
  /** The pedalboard's own ports: sources first, by type and index. */
  readonly ports: ReadonlyArray<PortSnapshot>;
}

/** Runs a callback later. `ModUiClientOptions.schedule` replaces it. */
export type Schedule = (callback: () => void) => void;

const PORT_TYPES: PortType[] = ['audio', 'midi', 'cv'];
const DIRECTION_ORDER: PortDirection[] = ['output', 'input'];

/** One notification per animation frame in a browser, per microtask elsewhere (Node, tests). Looked up when used. */
export const defaultSchedule: Schedule = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback());
  } else {
    queueMicrotask(callback);
  }
};

const EMPTY: ReadonlyArray<never> = Object.freeze([]);

function record<T>(map: Map<string, T>): Readonly<Record<string, T>> {
  const result: Record<string, T> = Object.create(null);
  for (const [key, value] of map) {
    result[key] = value;
  }
  return Object.freeze(result);
}

/**
 * Builds the {@link PedalboardSnapshot} from the model, on demand, and notifies the subscribers at most once per `schedule` tick.
 *
 * Fed by the `PedalboardStore` in the order of the frames: `note()` only marks what is out of date; `current()` rebuilds that and
 * nothing else, so a burst of frames costs one rebuild.
 */
export class SnapshotStore {
  private snapshot: PedalboardSnapshot = Object.freeze({
    version: 0,
    ready: false,
    loading: false,
    plugins: EMPTY,
    connections: EMPTY,
    ports: EMPTY,
  });
  private readonly cache = new Map<string, PluginSnapshot>();
  private readonly connectionCache = new Map<string, ConnectionSnapshot>();
  private readonly portCache = new Map<string, PortSnapshot>();
  /** The snapshot the subscribers were last told about. */
  private notified: PedalboardSnapshot = this.snapshot;
  private readonly dirty = new Set<string>();
  private pluginsDirty = false;
  private connectionsDirty = false;
  private portsDirty = false;
  private loading = false;
  private ready = false;
  private flagsDirty = false;
  private scheduled = false;
  private readonly emitter = new Emitter<{ changed: object }>();

  constructor(private readonly model: () => GraphModel, private readonly schedule: () => Schedule) {}

  /** The current snapshot: the same object until something changes. */
  current = (): PedalboardSnapshot => {
    this.rebuild();
    return this.snapshot;
  };

  /**
   * Calls `listener` (no arguments) after the snapshot changed, at most once per scheduler tick however many changes happened. Read
   * the new state with `current()`.
   */
  subscribe = (listener: () => void): Unsubscribe => this.emitter.on('changed', () => listener());

  /** Records what a change makes out of date and schedules the notification. */
  note(change: GraphChange): void {
    if (this.loading && change.type !== 'loaded') {
      return; // the lists stay empty until the pedalboard is complete; `loaded` rebuilds everything
    }
    switch (change.type) {
      case 'loading':
        this.loading = true;
        this.ready = false;
        this.flagsDirty = true;
        this.cache.clear();
        this.dirty.clear();
        break;
      case 'loaded':
        this.loading = false;
        this.ready = true;
        this.flagsDirty = true;
        this.markAll();
        break;
      case 'cleared':
        this.markAll();
        break;
      case 'newer-format':
        return; // not part of the snapshot: read `currentPedalboard.newerFormat`
      case 'plugin-added':
      case 'plugin-removed':
        this.pluginsDirty = true;
        this.dirty.add(change.instance);
        break;
      case 'connection-added':
      case 'connection-removed':
        this.connectionsDirty = true;
        break;
      case 'port-added':
      case 'port-removed':
        this.portsDirty = true;
        break;
      case 'param':
      case 'active':
      case 'moved':
      case 'patch':
      case 'preset':
        this.pluginsDirty = true;
        this.dirty.add(change.instance);
        break;
    }
    this.notifyLater();
  }

  private markAll(): void {
    this.pluginsDirty = true;
    this.connectionsDirty = true;
    this.portsDirty = true;
    this.cache.clear();
    this.dirty.clear();
  }

  private notifyLater(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    this.schedule()(() => {
      this.scheduled = false;
      this.rebuild();
      // `getSnapshot()` may have rebuilt it already: what counts is what the subscribers were last told, and a change that cancelled
      // itself (a bypass switched off and on again before the tick) is not news.
      if (this.snapshot !== this.notified) {
        this.notified = this.snapshot;
        this.emitter.emit('changed', {});
      }
    });
  }

  /**
   * Rebuilds what is out of date. Every object that ends up with the same content as before is the previous object (and a list
   * whose items are all the same is the same array), so a change that cancels itself publishes nothing.
   */
  private rebuild(): void {
    const stale = this.pluginsDirty || this.connectionsDirty || this.portsDirty || this.flagsDirty;
    if (!stale) {
      return;
    }
    const previous = this.snapshot;
    const model = this.model();
    let plugins = previous.plugins;
    let connections = previous.connections;
    let ports = previous.ports;

    if (this.loading) {
      plugins = EMPTY;
      connections = EMPTY;
    } else {
      if (this.pluginsDirty) {
        const built: PluginSnapshot[] = [];
        const alive = new Set<string>();
        for (const plugin of model.plugins.values()) {
          alive.add(plugin.instance);
          let item = this.cache.get(plugin.instance);
          if (!item || this.dirty.has(plugin.instance)) {
            const next = this.pluginSnapshot(plugin, item);
            item = item && samePlugin(item, next) ? item : next;
            this.cache.set(plugin.instance, item);
          }
          built.push(item);
        }
        for (const instance of Array.from(this.cache.keys())) {
          if (!alive.has(instance)) {
            this.cache.delete(instance);
          }
        }
        plugins = sameItems(previous.plugins, built) ? previous.plugins : Object.freeze(built);
      }
      if (this.connectionsDirty) {
        const built: ConnectionSnapshot[] = [];
        const used = new Set<string>();
        for (const { from, to } of model.connections) {
          const key = `${from},${to}`;
          used.add(key);
          let item = this.connectionCache.get(key);
          if (!item) {
            item = Object.freeze({ from, to });
            this.connectionCache.set(key, item);
          }
          built.push(item);
        }
        this.prune(this.connectionCache, used);
        connections = sameItems(previous.connections, built) ? previous.connections : Object.freeze(built);
      }
      if (this.portsDirty) {
        const built: PortSnapshot[] = [];
        const used = new Set<string>();
        const sorted = Array.from(model.hardware.values()).sort(
          (a, b) =>
            PORT_TYPES.indexOf(a.type) - PORT_TYPES.indexOf(b.type) ||
            DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction) ||
            a.index - b.index,
        );
        for (const { id, type, direction, title, index } of sorted) {
          used.add(id);
          let item = this.portCache.get(id);
          if (!item || item.type !== type || item.direction !== direction || item.title !== title || item.index !== index) {
            item = Object.freeze({ id, type, direction, title, index });
            this.portCache.set(id, item);
          }
          built.push(item);
        }
        this.prune(this.portCache, used);
        ports = sameItems(previous.ports, built) ? previous.ports : Object.freeze(built);
      }
    }

    this.pluginsDirty = false;
    this.connectionsDirty = false;
    this.portsDirty = false;
    this.flagsDirty = false;
    this.dirty.clear();
    if (
      plugins === previous.plugins &&
      connections === previous.connections &&
      ports === previous.ports &&
      this.ready === previous.ready &&
      this.loading === previous.loading
    ) {
      return; // nothing that a subscriber can see changed
    }
    this.snapshot = Object.freeze({
      version: previous.version + 1,
      ready: this.ready,
      loading: this.loading,
      plugins,
      connections,
      ports,
    });
  }

  private prune<T>(cache: Map<string, T>, used: Set<string>): void {
    for (const key of Array.from(cache.keys())) {
      if (!used.has(key)) {
        cache.delete(key);
      }
    }
  }

  /** A new snapshot of a plugin, reusing the maps that did not change. */
  private pluginSnapshot(plugin: ModelPlugin, previous: PluginSnapshot | undefined): PluginSnapshot {
    return Object.freeze({
      instance: plugin.instance,
      uri: plugin.uri,
      x: plugin.x,
      y: plugin.y,
      active: !plugin.bypassed,
      preset: plugin.preset,
      values: previous && sameMap(previous.values, plugin.values) ? previous.values : record(plugin.values),
      patches: previous && sameMap(previous.patches, plugin.patches) ? previous.patches : record(plugin.patches),
    });
  }
}

function samePlugin(a: PluginSnapshot, b: PluginSnapshot): boolean {
  return (
    a.uri === b.uri &&
    a.x === b.x &&
    a.y === b.y &&
    a.active === b.active &&
    a.preset === b.preset &&
    a.values === b.values &&
    a.patches === b.patches
  );
}

function sameItems<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function sameMap<T>(snapshot: Readonly<Record<string, T>>, map: Map<string, T>): boolean {
  const keys = Object.keys(snapshot);
  if (keys.length !== map.size) {
    return false;
  }
  for (const [key, value] of map) {
    if (snapshot[key] !== value) {
      return false;
    }
  }
  return true;
}
