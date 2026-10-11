// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Live model of the running pedalboard's graph (internal), fed by the main WebSocket.
 *
 * No HTTP endpoint lists the plugins or the connections of the running pedalboard (`GET /pedalboard/info/` only knows
 * the saved bundle), so the client rebuilds them from the WebSocket: the state replay a fresh socket receives
 * (`add_hw_port`, `add`, `connect`, ... up to `loading_end`) and the live frames after it.
 * @module
 */

import { ModUiError } from './errors';
import type { EventChannel } from './events';
import type { PortDirection, PortType } from './types';

/** A plugin as the WebSocket describes it. */
export interface ModelPlugin {
  /** Instance path, e.g. `/graph/Gain`. */
  instance: string;
  uri: string;
  x: number;
  y: number;
  bypassed: boolean;
  /** Last known value of each control input port (by symbol), from `param_set` frames and from `Param.setValue()`. */
  values: Map<string, number>;
  /**
   * Raw text of the last known value of each patch parameter (by URI), from `patch_set` frames and from
   * `PatchParam.setValue()`. Parsed by the parameter's type when read.
   */
  patches: Map<string, string>;
}

/** A port of the pedalboard itself (physical, virtual or MIDI), from `add_hw_port`. */
export interface ModelHardwarePort {
  /** Port id, e.g. `/graph/capture_1`. */
  id: string;
  type: PortType;
  /** Seen from the graph: `output` for an input of the device (a source), `input` for an output of the device. */
  direction: PortDirection;
  title: string;
  index: number;
}

/** A connection as the WebSocket describes it. */
export interface ModelConnection {
  from: string;
  to: string;
}

/**
 * What a WebSocket frame changed in the {@link GraphModel}. Frames that change nothing (a value that is already known, a
 * connection that exists) produce no change.
 */
export type GraphChange =
  | { type: 'loading'; empty: boolean; modified: boolean }
  | { type: 'loaded'; snapshotId: number }
  | { type: 'cleared' }
  | { type: 'plugin-added'; instance: string }
  | { type: 'plugin-removed'; instance: string }
  | { type: 'connection-added'; from: string; to: string }
  | { type: 'connection-removed'; from: string; to: string }
  | { type: 'port-added'; port: ModelHardwarePort }
  | { type: 'port-removed'; id: string }
  | { type: 'param'; instance: string; symbol: string; value: number; previous: number | undefined }
  | { type: 'active'; instance: string; active: boolean }
  | { type: 'moved'; instance: string; x: number; y: number }
  | { type: 'patch'; instance: string; uri: string };

/** The graph, updated by {@link GraphModel.apply}. */
export class GraphModel {
  readonly plugins = new Map<string, ModelPlugin>();
  readonly hardware = new Map<string, ModelHardwarePort>();
  connections: ModelConnection[] = [];

  /** Forgets everything, the pedalboard's own ports included: a new socket starts a new state replay that announces them again. */
  clear(): void {
    this.plugins.clear();
    this.hardware.clear();
    this.connections = [];
  }

  /** Applies one WebSocket message and reports what changed; unrelated commands change nothing. */
  apply(command: string, args: string): GraphChange[] {
    const parts = args.split(' ');
    switch (command) {
      case 'add_hw_port': {
        // <port> <type:audio|midi|cv> <direction:0|1> <title> <index>
        const [id, type, direction, title, index] = parts;
        if (id && (type === 'audio' || type === 'midi' || type === 'cv')) {
          const port: ModelHardwarePort = {
            id,
            type,
            direction: direction === '0' ? 'output' : 'input',
            title: title ?? id,
            index: parseInt(index, 10) || 0,
          };
          const previous = this.hardware.get(id);
          this.hardware.set(id, port);
          if (!previous || !sameHardwarePort(previous, port)) {
            return [{ type: 'port-added', port }];
          }
        }
        return [];
      }
      case 'remove_hw_port': {
        const existed = this.hardware.delete(parts[0]);
        const changes = this.dropConnectionsOf(parts[0]);
        if (existed) {
          changes.push({ type: 'port-removed', id: parts[0] });
        }
        return changes;
      }
      case 'add': {
        // <instance> <uri> <x> <y> <bypassed> <version> <officialBuild>
        const [instance, uri, x, y, bypassed] = parts;
        if (instance && uri) {
          this.plugins.set(instance, {
            instance,
            uri,
            x: parseFloat(x) || 0,
            y: parseFloat(y) || 0,
            bypassed: bypassed === '1',
            values: new Map(),
            patches: new Map(),
          });
          return [{ type: 'plugin-added', instance }];
        }
        return [];
      }
      case 'remove':
        if (parts[0] === ':all') {
          this.clearPedalboard();
          return [{ type: 'cleared' }];
        } else {
          const existed = this.plugins.delete(parts[0]);
          const changes = this.dropConnectionsOf(parts[0]);
          if (existed) {
            changes.push({ type: 'plugin-removed', instance: parts[0] });
          }
          return changes;
        }
      case 'loading_start':
        // A (re)load or the initial replay begins. Hardware ports stay: a load does not send them again.
        // <empty:0|1> <modified:0|1>
        this.clearPedalboard();
        return [{ type: 'loading', empty: parts[0] === '1', modified: parts[1] === '1' }];
      case 'loading_end':
        return [{ type: 'loaded', snapshotId: parseInt(parts[0], 10) || 0 }];
      case 'connect': {
        const [from, to] = parts;
        if (from && to && !this.hasConnection(from, to)) {
          this.connections.push({ from, to });
          return [{ type: 'connection-added', from, to }];
        }
        return [];
      }
      case 'disconnect': {
        const before = this.connections.length;
        this.connections = this.connections.filter((c) => !(c.from === parts[0] && c.to === parts[1]));
        return this.connections.length < before ? [{ type: 'connection-removed', from: parts[0], to: parts[1] }] : [];
      }
      case 'plugin_pos': {
        const plugin = this.plugins.get(parts[0]);
        if (plugin) {
          const x = parseFloat(parts[1]) || 0;
          const y = parseFloat(parts[2]) || 0;
          const changed = plugin.x !== x || plugin.y !== y;
          plugin.x = x;
          plugin.y = y;
          if (changed) {
            return [{ type: 'moved', instance: plugin.instance, x, y }];
          }
        }
        return [];
      }
      case 'param_set': {
        // <instance> <symbol> <value>; for ":bypass" a value >= 0.5 means bypassed.
        const plugin = this.plugins.get(parts[0]);
        if (plugin && parts[1] === ':bypass') {
          const bypassed = parseFloat(parts[2]) >= 0.5;
          const changed = plugin.bypassed !== bypassed;
          plugin.bypassed = bypassed;
          if (changed) {
            return [{ type: 'active', instance: plugin.instance, active: !bypassed }];
          }
        } else if (plugin && parts[1] && !isNaN(parseFloat(parts[2]))) {
          const value = parseFloat(parts[2]);
          const previous = plugin.values.get(parts[1]);
          plugin.values.set(parts[1], value);
          if (previous !== value) {
            return [{ type: 'param', instance: plugin.instance, symbol: parts[1], value, previous }];
          }
        }
        return [];
      }
      case 'patch_set': {
        // <instance> <writable:0|1> <uri> <type:char> <value...>; the value is the rest of the line and may hold spaces.
        const [instance, , uri, , ...value] = args.split(' ');
        const plugin = this.plugins.get(instance);
        if (plugin && uri) {
          const text = value.join(' ');
          const changed = plugin.patches.get(uri) !== text;
          plugin.patches.set(uri, text);
          if (changed) {
            return [{ type: 'patch', instance, uri }];
          }
        }
        return [];
      }
    }
    return [];
  }

  hasConnection(from: string, to: string): boolean {
    return this.connections.some((c) => c.from === from && c.to === to);
  }

  private clearPedalboard(): void {
    this.plugins.clear();
    this.connections = [];
  }

  /** Removes the connections of a plugin (or port) and reports them. The backend sends `disconnect` first; this is a safety net. */
  private dropConnectionsOf(owner: string): GraphChange[] {
    const prefix = owner + '/';
    const dropped = this.connections.filter(
      (c) => c.from === owner || c.to === owner || c.from.startsWith(prefix) || c.to.startsWith(prefix),
    );
    this.connections = this.connections.filter((c) => !dropped.includes(c));
    return dropped.map((c) => ({ type: 'connection-removed', from: c.from, to: c.to }));
  }
}

function sameHardwarePort(a: ModelHardwarePort, b: ModelHardwarePort): boolean {
  return a.id === b.id && a.type === b.type && a.direction === b.direction && a.title === b.title && a.index === b.index;
}

/** Commands that change the {@link GraphModel}. */
const GRAPH_COMMANDS = [
  'add_hw_port',
  'remove_hw_port',
  'add',
  'remove',
  'loading_start',
  'loading_end',
  'connect',
  'disconnect',
  'plugin_pos',
  'param_set',
  'patch_set',
];

/** Where {@link GraphState} reports what its model changed (implemented by `PedalboardStore`). */
export interface ChangeSink {
  /** The changes one frame produced, in order. `local` is set for a change this client made itself (no frame came for it). */
  changes(changes: GraphChange[], local?: { source: unknown }): void;
  /** The model was replaced by a snapshot read through a second socket: everything has to be rebuilt. */
  reset(): void;
  /** A new socket of the client starts a state replay: the model was emptied, everything is rebuilt as the replay arrives. */
  restart(): void;
  /** Resolves when everything that is still being prepared (plugin descriptions) is done. */
  settled(): Promise<void>;
}

/**
 * Keeps a {@link GraphModel} in sync with the main WebSocket.
 *
 * The handlers are registered when the object is created, before the socket is opened, so the initial replay
 * of an own socket feeds the model. A shared socket (`options.webSocket`) delivered its replay before the client
 * existed: then {@link GraphState.ready} reads one snapshot through a short-lived second socket.
 */
export class GraphState {
  private model = new GraphModel();
  private sink: ChangeSink | null = null;
  /** Live frames received while a snapshot is being read; applied on top of it. */
  private buffer: Array<[string, string]> | null = null;
  private snapshot: Promise<void> | null = null;

  /**
   * @param events The main WebSocket.
   * @param openSnapshotChannel Creates an own (non-shared) channel; `null` when no WebSocket class is available.
   */
  constructor(private readonly events: EventChannel, private readonly openSnapshotChannel: () => EventChannel | null) {
    for (const command of GRAPH_COMMANDS) {
      events.on(command, (args) => {
        if (this.buffer) {
          this.buffer.push([command, args]);
        } else {
          const changes = this.model.apply(command, args);
          this.sink?.changes(changes);
        }
      });
    }
    // A new own socket (the first one, or a reconnection) receives the whole state again: start from nothing, so that what
    // disappeared while the client was away (plugins, pedalboard ports) does not stay.
    events.onNewSocket(() => {
      this.model.clear();
      this.sink?.restart();
    });
  }

  /** Connects the object that is told what changed. Called once, by the store. */
  setSink(sink: ChangeSink): void {
    this.sink = sink;
  }

  /**
   * Applies a change this client just made (the backend never echoes `param_set`, `patch_set` and `plugin_pos` to the sender),
   * written as the frame the other sockets receive, and reports it as a `'local'` change.
   */
  applyLocal(command: string, args: string, source: unknown): void {
    const changes = this.model.apply(command, args);
    this.sink?.changes(changes, { source });
  }

  /** The model as it is now, without waiting for the socket. Use {@link GraphState.ready} before trusting it. */
  peek(): GraphModel {
    return this.model;
  }

  /**
   * Connects the socket and resolves with the up-to-date model, once the plugin descriptions are in.
   * @throws {ModUiTimeoutError} when the backend does not answer.
   * @throws {ModUiError} for a shared socket when no `WebSocket` class is available to read the snapshot.
   */
  async ready(): Promise<GraphModel> {
    await this.events.connect();
    if (!this.events.ownsSocket) {
      if (!this.snapshot) {
        this.snapshot = this.readSnapshot().catch((error) => {
          this.snapshot = null;
          throw error;
        });
      }
      await this.snapshot;
    }
    await this.sink?.settled();
    return this.model;
  }

  private async readSnapshot(): Promise<void> {
    const channel = this.openSnapshotChannel();
    if (!channel) {
      throw new ModUiError(
        'The shared WebSocket already delivered its state replay: pass options.WebSocket so the client can read a snapshot',
      );
    }
    const fresh = new GraphModel();
    channel.on('*', (args, command) => {
      fresh.apply(command, args);
    });
    this.buffer = [];
    try {
      await channel.connect();
    } catch (error) {
      this.buffer = null;
      throw error;
    } finally {
      channel.close();
    }
    this.model = fresh;
    const pending = this.buffer;
    this.buffer = null;
    this.sink?.reset();
    for (const [command, args] of pending) {
      this.sink?.changes(fresh.apply(command, args));
    }
  }
}
