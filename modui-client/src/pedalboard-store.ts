// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The state of the running pedalboard as objects, and the events about it ({@link PedalboardStore}, internal).
 *
 * `GraphState` keeps the plain data (`GraphModel`) and says what each frame changed. The store turns that into the objects the
 * application holds — one {@link PluginInstance} per plugin, stable until it is removed — and into events. It is the only place
 * that builds those objects, so an event always refers to an object that is complete and that the application can keep.
 * @module
 */

import { Emitter, type EventMeta, type ListenOptions, type Unsubscribe } from './emitter';
import { ModUiTimeoutError } from './errors';
import type { ChangeSink, GraphChange, GraphState, ModelHardwarePort, ModelPlugin } from './graph-state';
import type { PluginsApi } from './plugins';
import { SnapshotStore, type Schedule } from './snapshot';
import type { PedalboardConnection, Port, PluginInstance } from './pedalboard-graph';
import type { PluginRemovedReason, StoreEvents } from './pedalboard-events';
import type { PluginInfo } from './types';

/** A request of this client that will provoke frames: they are tagged `'local'` while it is in flight. */
interface Expectation {
  match(change: GraphChange): boolean;
  source: unknown;
}

/** Builds the objects the store keeps. Given by the graph, which knows the operations they can ask for. */
export interface ObjectFactory {
  instance(model: ModelPlugin, info: PluginInfo | null): PluginInstance;
  /** A port of the pedalboard itself. */
  hardwarePort(model: ModelHardwarePort): Port;
  connection(from: Port, to: Port): PedalboardConnection;
}

/**
 * Owns the plugin objects of the running pedalboard and the emitter of their events.
 *
 * Rules (see `docs/plans/2026-10-modui-client-events.md`):
 * - changes are handled **in the order of the frames**. Handling a change normally finishes at once; only a plugin whose
 *   description is not known yet makes it wait (one `POST /effect/bulk/`), and everything after it waits in the same line;
 * - between `loading` and `loaded` nothing is delivered but those two: the plugins are built once, at `loaded`;
 * - an event is delivered after the model and the objects are up to date, so a handler reads the new state.
 */
export class PedalboardStore implements ChangeSink {
  /** Every event of the pedalboard and of its plugins. */
  readonly bus = new Emitter<StoreEvents>();
  /** The immutable snapshots of the pedalboard, for UI frameworks. */
  readonly snapshots: SnapshotStore;

  private readonly instances = new Map<string, PluginInstance>();
  private readonly expectations = new Set<Expectation>();
  private readonly hardwarePorts = new Map<string, Port>();
  private readonly connectionObjects = new Map<string, PedalboardConnection>();
  /** The work in progress, when a change is waiting for a plugin description; `null` when idle. */
  private gate: Promise<void> | null = null;
  private loading = false;
  /** A `loading` event was delivered for the bracket in progress (a replay that has not seen `loading_start` has none yet). */
  private loadingAnnounced = false;

  constructor(
    private readonly state: GraphState,
    private readonly plugins: PluginsApi,
    private readonly factory: ObjectFactory,
    schedule: () => Schedule,
    private readonly descriptionTimeoutMs: number,
  ) {
    this.snapshots = new SnapshotStore(() => state.peek(), schedule);
    state.setSink(this);
  }

  // ---- reads --------------------------------------------------------------------------------------------------------

  /** The object of a plugin, `undefined` when it is not in the pedalboard (or not announced yet: see {@link settled}). */
  instance(path: string): PluginInstance | undefined {
    return this.instances.get(path);
  }

  /** Whether `plugin` is the object that stands for its path now (it is not after a removal, a reset or a reload). */
  isAlive(plugin: PluginInstance): boolean {
    return this.instances.get(plugin.instance) === plugin;
  }

  /** Resolves when every change received so far was handled (plugin descriptions included). */
  async settled(): Promise<void> {
    while (this.gate) {
      await this.gate;
    }
  }

  /**
   * Tries again to read the description of the plugins that exist without one (a failed or incomplete request), and fills
   * them in place: the objects keep their identity.
   */
  async fillMissing(): Promise<void> {
    const missing = Array.from(this.instances.values()).filter((plugin) => plugin.info === null);
    if (missing.length === 0) {
      return;
    }
    await this.fetch(missing.map((plugin) => plugin.uri));
    for (const plugin of missing) {
      const info = this.plugins.peek(plugin.uri);
      if (info) {
        plugin.attach(info);
      }
    }
  }

  /** The object of a port of the pedalboard itself, the same one while the port does not change. */
  hardwarePort(model: ModelHardwarePort): Port {
    const cached = this.hardwarePorts.get(model.id);
    if (cached && cached.name === model.title && cached.type === model.type && cached.direction === model.direction) {
      return cached;
    }
    const port = this.factory.hardwarePort(model);
    this.hardwarePorts.set(model.id, port);
    return port;
  }

  /** Forgets the objects of ports and connections that are not in the pedalboard any more (the ids and keys given are the ones that are). */
  retain(portIds: Set<string>, connectionKeys: Set<string>): void {
    for (const id of Array.from(this.hardwarePorts.keys())) {
      if (!portIds.has(id)) {
        this.hardwarePorts.delete(id);
      }
    }
    for (const key of Array.from(this.connectionObjects.keys())) {
      if (!connectionKeys.has(key)) {
        this.connectionObjects.delete(key);
      }
    }
  }

  /** @internal How many objects the caches hold (for tests). */
  cacheSizes(): { ports: number; connections: number } {
    return { ports: this.hardwarePorts.size, connections: this.connectionObjects.size };
  }

  /** The object of a connection, the same one while its ports are the same objects. */
  connection(from: Port, to: Port): PedalboardConnection {
    const key = `${from.id},${to.id}`;
    const cached = this.connectionObjects.get(key);
    if (cached && cached.from === from && cached.to === to) {
      return cached;
    }
    const connection = this.factory.connection(from, to);
    this.connectionObjects.set(key, connection);
    return connection;
  }

  // ---- local changes ------------------------------------------------------------------------------------------------

  /**
   * Tags the changes `match` accepts as `'local'` (with `source`) until the returned function is called. Register it before
   * sending the request, as the frames can arrive before the HTTP answer.
   */
  expect(match: (change: GraphChange) => boolean, source: unknown): () => void {
    const expectation: Expectation = { match, source };
    this.expectations.add(expectation);
    return () => {
      this.expectations.delete(expectation);
    };
  }

  // ---- subscriptions of one plugin ---------------------------------------------------------------------------------

  /**
   * Subscribes to an event of one plugin. The subscription ends by itself when the plugin is gone (after its `removed` event).
   * Subscribing to a plugin that is already gone does nothing.
   */
  listen<K extends keyof StoreEvents>(
    plugin: PluginInstance,
    event: K,
    handler: (payload: StoreEvents[K]) => void,
    options: ListenOptions = {},
    once = false,
    extra?: (payload: StoreEvents[K]) => boolean,
  ): Unsubscribe {
    if (!this.isAlive(plugin)) {
      return () => undefined;
    }
    const filter = (payload: StoreEvents[K]) =>
      (payload as unknown as { plugin: PluginInstance }).plugin === plugin && (!extra || extra(payload));
    // The plugin is the scope: its death ends all its subscriptions at once, and nothing is kept per subscription meanwhile.
    return once ? this.bus.once(event, handler, options, filter, plugin) : this.bus.on(event, handler, options, filter, plugin);
  }

  // ---- ChangeSink ---------------------------------------------------------------------------------------------------

  changes(changes: GraphChange[], local?: { source: unknown }): void {
    for (const change of changes) {
      const meta = this.metaOf(change, local);
      this.run(() => this.handle(change, meta));
    }
  }

  /** The model was replaced by a state read through a second socket: the same as a pedalboard load that is already complete. */
  reset(snapshotId = 0): void {
    this.changes([{ type: 'loading', empty: false, modified: false }, { type: 'loaded', snapshotId }]);
  }

  /**
   * A new socket starts the state replay: the same as the start of a load (the replay ends with `loaded`). The `loading` event itself
   * is left to the `loading_start` frame that begins the replay, which knows `empty` and `modified`.
   */
  restart(): void {
    this.run(() => {
      this.loading = true;
      this.loadingAnnounced = false;
      this.snapshots.note({ type: 'loading', empty: false, modified: false });
      this.killAll('reloaded', { origin: 'remote' });
    });
  }

  // ---- handling -----------------------------------------------------------------------------------------------------

  private metaOf(change: GraphChange, local?: { source: unknown }): EventMeta {
    if (local) {
      return { origin: 'local', source: local.source };
    }
    for (const expectation of this.expectations) {
      if (expectation.match(change)) {
        return { origin: 'local', source: expectation.source };
      }
    }
    return { origin: 'remote' };
  }

  /** Runs `task` now when nothing is waiting, else after what is waiting: the order of the frames is kept. */
  private run(task: () => void | Promise<void>): void {
    if (this.gate) {
      this.track(this.gate.then(task));
      return;
    }
    let result: void | Promise<void>;
    try {
      result = task();
    } catch (error) {
      reportLater(error);
      return;
    }
    if (result) {
      this.track(result);
    }
  }

  private track(work: Promise<void>): void {
    const done: Promise<void> = work
      .catch(reportLater)
      .then(() => {
        if (this.gate === done) {
          this.gate = null;
        }
      });
    this.gate = done;
  }

  private handle(change: GraphChange, meta: EventMeta): void | Promise<void> {
    // `loaded` is noted when it is announced, after the plugins are built; the others as they are handled, in the order of the frames
    if (change.type !== 'loaded') {
      this.snapshots.note(change);
    }
    switch (change.type) {
      case 'loading':
        // One `loading` per bracket: a replay that restart() prepared has not announced it yet.
        if (!this.loadingAnnounced) {
          this.bus.emit('loading', { empty: change.empty, modified: change.modified, ...meta });
          this.loadingAnnounced = true;
        }
        this.loading = true;
        this.killAll('reloaded', meta);
        return;
      case 'cleared':
        this.bus.emit('cleared', { ...meta });
        this.killAll('cleared', meta);
        return;
      case 'loaded':
        return this.finishLoad(change.snapshotId, meta);
      case 'plugin-added':
        return this.pluginAdded(change.instance, meta);
      case 'plugin-removed': {
        const plugin = this.instances.get(change.instance);
        if (plugin) {
          this.kill(plugin, 'removed', meta, !this.loading);
        }
        return;
      }
      case 'connection-added':
      case 'connection-removed':
        if (!this.loading) {
          this.bus.emit(change.type === 'connection-added' ? 'connection:added' : 'connection:removed', {
            from: change.from,
            to: change.to,
            ...meta,
          });
        }
        return;
      case 'port-added':
        if (!this.loading) {
          const { id, type, direction, title, index } = change.port;
          this.bus.emit('port:added', { id, type, direction, title, index, ...meta });
        }
        return;
      case 'port-removed':
        if (!this.loading) {
          this.bus.emit('port:removed', { id: change.id, ...meta });
        }
        return;
      case 'param': {
        const plugin = this.loading ? undefined : this.instances.get(change.instance);
        const param = plugin?.params.get(change.symbol);
        if (plugin && param) {
          this.bus.emit('param', { plugin, param, value: change.value, previous: change.previous ?? param.default, ...meta });
        }
        return;
      }
      case 'active': {
        const plugin = this.loading ? undefined : this.instances.get(change.instance);
        if (plugin) {
          this.bus.emit('active', { plugin, active: change.active, ...meta });
        }
        return;
      }
      case 'moved': {
        const plugin = this.loading ? undefined : this.instances.get(change.instance);
        if (plugin) {
          this.bus.emit('moved', { plugin, x: change.x, y: change.y, ...meta });
        }
        return;
      }
      case 'preset': {
        const plugin = this.loading ? undefined : this.instances.get(change.instance);
        if (plugin) {
          this.bus.emit('preset', { plugin, preset: change.preset, previous: change.previous, ...meta });
        }
        return;
      }
      case 'patch': {
        const plugin = this.loading ? undefined : this.instances.get(change.instance);
        if (plugin) {
          const param = plugin.patchParams.get(change.uri);
          this.bus.emit('patch', { plugin, uri: change.uri, param, value: param?.value, ...meta });
        }
        return;
      }
    }
  }

  /** A plugin appeared outside a load: announce it once its description is known (one request at most, then cached). */
  private pluginAdded(path: string, meta: EventMeta): void | Promise<void> {
    if (this.loading) {
      return; // built at `loaded`
    }
    const model = this.state.peek().plugins.get(path);
    if (!model || this.instances.has(path)) {
      return; // already removed by a later frame, or already built
    }
    if (this.plugins.peek(model.uri) !== undefined) {
      this.announce(model, meta);
      return;
    }
    return this.fetch([model.uri]).then(() => {
      const current = this.state.peek().plugins.get(path);
      if (current && !this.instances.has(path)) {
        this.announce(current, meta);
      }
    });
  }

  private announce(model: ModelPlugin, meta: EventMeta): void {
    const plugin = this.factory.instance(model, this.plugins.peek(model.uri) ?? null);
    this.instances.set(model.instance, plugin);
    this.bus.emit('plugin:added', { plugin, ...meta });
  }

  /** The pedalboard is complete: read the descriptions that are missing (one request), build every plugin, tell the application. */
  private finishLoad(snapshotId: number, meta: EventMeta): void | Promise<void> {
    const finish = () => {
      for (const model of this.state.peek().plugins.values()) {
        if (!this.instances.has(model.instance)) {
          this.instances.set(model.instance, this.factory.instance(model, this.plugins.peek(model.uri) ?? null));
        }
      }
      this.loading = false;
      if (!this.loadingAnnounced) {
        // a replay without `loading_start`: keep `loading` and `loaded` in pairs
        this.bus.emit('loading', { empty: false, modified: false, ...meta });
      }
      this.loadingAnnounced = false;
      this.snapshots.note({ type: 'loaded', snapshotId });
      this.bus.emit('loaded', { snapshotId, ...meta });
    };
    const missing = Array.from(new Set(Array.from(this.state.peek().plugins.values()).map((model) => model.uri))).filter(
      (uri) => this.plugins.peek(uri) === undefined,
    );
    if (missing.length === 0) {
      finish();
      return;
    }
    return this.fetch(missing).then(finish);
  }

  /**
   * Reads descriptions, for at most `descriptionTimeoutMs`. A failure or a timeout is reported as an `error` event, not thrown: the
   * plugins exist without a description, and what is queued behind this read is not held for good (a request that never ends would
   * otherwise stop every later event and every call that waits for the store).
   */
  private async fetch(uris: string[]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ModUiTimeoutError(`No description of the plugins within ${this.descriptionTimeoutMs} ms`)),
          this.descriptionTimeoutMs,
        );
      });
      await Promise.race([this.plugins.infosOf(uris), timeout]);
    } catch (error) {
      this.bus.emit('error', { error: error instanceof Error ? error : new Error(String(error)), context: 'plugin-description' });
    } finally {
      clearTimeout(timer);
    }
  }

  private killAll(reason: PluginRemovedReason, meta: EventMeta): void {
    for (const plugin of Array.from(this.instances.values())) {
      this.kill(plugin, reason, meta, false);
    }
  }

  /** The plugin stops being part of the pedalboard: `alive` turns `false` first, then the events, then its subscriptions end. */
  private kill(plugin: PluginInstance, reason: PluginRemovedReason, meta: EventMeta, announce: boolean): void {
    this.instances.delete(plugin.instance);
    if (announce) {
      this.bus.emit('plugin:removed', { plugin, reason, ...meta });
    }
    this.bus.emit('instance:removed', { plugin, reason, ...meta });
    this.bus.defer(() => this.bus.dropScope(plugin));
  }
}

function reportLater(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}
