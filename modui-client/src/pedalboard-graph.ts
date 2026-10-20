// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Plugins, ports and connections of the running pedalboard, and the engine behind
 * `device.currentPedalboard.plugins`, `.connections` and `.ports` ({@link PedalboardGraph}, internal).
 * @module
 */

import type { ListenOptions, Unsubscribe } from './emitter';
import { ModUiError } from './errors';
import type { EventChannel } from './events';
import type { HttpTransport } from './http';
import type { GraphChange, GraphModel, GraphState, ModelPlugin } from './graph-state';
import { PluginPatchParams, patchFrameValue } from './patch-params';
import { PluginPresets, type PresetCatalog, type PresetEngine } from './plugin-presets';
import type { ParamEvent, PluginEvents, StoreEvents } from './pedalboard-events';
import { PedalboardStore } from './pedalboard-store';
import type { Schedule } from './snapshot';
import type { PluginsApi } from './plugins';
import type {
  PluginInfo,
  PluginPortInfo,
  PluginTarget,
  PortDirection,
  PortType,
  Position,
  WriteOptions,
} from './types';

/** Runs a task after the pending device operations (see `Device`), so it never overlaps a load or a save. */
export type Enqueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * A connectable port of the running pedalboard: a port of a plugin instance, or one of the pedalboard itself
 * (physical inputs/outputs, MIDI ports, ...; {@link Port.owner} is `null`).
 *
 * `direction` is seen from the graph: an `output` is a signal source, an `input` a sink. The pedalboard's own
 * capture ports are therefore *outputs* and its playback ports *inputs*.
 */
export class Port {
  /** @internal Built by the client. */
  constructor(
    /** Port id used in URLs and WebSocket frames: `/graph/capture_1`, `/graph/Gain/out`. */
    readonly id: string,
    /** Last segment of the id: the LV2 port symbol, or the pedalboard port name. */
    readonly symbol: string,
    /** Display name (plugin port name, or the title of a pedalboard port). */
    readonly name: string,
    readonly type: PortType,
    readonly direction: PortDirection,
    /** The plugin instance this port belongs to; `null` for a port of the pedalboard itself. */
    readonly owner: PluginInstance | null,
  ) {}
}

/** What a {@link PluginInstance} asks the engine to do (internal). */
export interface InstanceOps {
  /** The current model entry of a plugin, or `undefined` when it is not in the pedalboard (any more). */
  live(instance: string): ModelPlugin | undefined;
  /** Whether the object is still the one that stands for its path (see {@link PluginInstance.alive}). */
  isAlive(plugin: PluginInstance): boolean;
  /** Subscribes to an event of one plugin; ends by itself when the plugin is gone. */
  listen<K extends keyof StoreEvents>(
    plugin: PluginInstance,
    event: K,
    handler: (payload: StoreEvents[K]) => void,
    options?: ListenOptions,
    once?: boolean,
    extra?: (payload: StoreEvents[K]) => boolean,
  ): Unsubscribe;
  /** The presets of a plugin URI, shared by all its instances. */
  presetCatalog(uri: string): PresetCatalog;
  /** What {@link PluginInstance.presets} needs from the engine. */
  presetEngine: PresetEngine;
  remove(instance: string, source?: unknown): Promise<void>;
  setParam(instance: string, symbol: string, value: number, source?: unknown): Promise<void>;
  /** Sends `patch_set` with the already validated and encoded value. */
  setPatch(instance: string, uri: string, typeChar: string, encoded: string, source?: unknown): Promise<void>;
  /** Sends `patch_get` and resolves with the raw text of the answer. */
  refreshPatch(instance: string, uri: string, timeoutMs?: number, source?: unknown): Promise<string>;
  isActive(instance: string): Promise<boolean>;
  setActive(instance: string, active: boolean, source?: unknown): Promise<void>;
  toggle(instance: string, source?: unknown): Promise<boolean>;
  setPosition(instance: string, position: Position, source?: unknown): Promise<void>;
}

/** Control ports the host drives itself: `param_set` on them is refused. */
const HOST_DESIGNATIONS = [
  'http://lv2plug.in/ns/lv2core#enabled',
  'http://lv2plug.in/ns/lv2core#freeWheeling',
  'http://lv2plug.in/ns/ext/time#beatsPerBar',
  'http://lv2plug.in/ns/ext/time#beatsPerMinute',
  'http://lv2plug.in/ns/ext/time#speed',
];

/**
 * A control input of a plugin instance: a knob, a switch, a selector. Get them with `instance.params.list()` or
 * `instance.params.get('gain')`.
 *
 * The description (`symbol`, `name`, `default`, `minimum`, `maximum`, ...) never changes. {@link Param.value} is read from
 * the live state each time, so it follows changes made by this client, by the classic UI and by other clients.
 */
export class Param {
  readonly symbol: string;
  readonly name: string;
  readonly default: number;
  /** `-Infinity` when the plugin does not say. */
  readonly minimum: number;
  /** `Infinity` when the plugin does not say. */
  readonly maximum: number;
  /** LV2 designation URI, empty when none. Ports with a designation the host drives (enabled, transport, ...) cannot be set. */
  readonly designation: string;
  /** LV2 port properties such as `toggled`, `integer`, `enumeration`, `logarithmic`, `trigger`, `notOnGUI`. */
  readonly properties: string[];

  /** @internal Built by the client. */
  constructor(readonly owner: PluginInstance, port: PluginPortInfo, private readonly ops: InstanceOps) {
    this.symbol = port.symbol;
    this.name = port.name;
    this.default = port.ranges?.default ?? 0;
    this.minimum = port.ranges?.minimum ?? -Infinity;
    this.maximum = port.ranges?.maximum ?? Infinity;
    this.designation = port.designation ?? '';
    this.properties = port.properties ?? [];
  }

  /**
   * The current value: the last one the backend announced (`param_set`) or this client sent, `default` when none is known
   * yet. Synchronous: it reads memory, it makes no request.
   */
  get value(): number {
    return this.owner.liveModel().values.get(this.symbol) ?? this.default;
  }

  /**
   * Changes the value in the audio engine.
   *
   * The backend does not confirm a `param_set` to the socket that sent it (only to the other sockets), so there is nothing
   * to wait for: the promise resolves once the message was sent, and {@link Param.value} already shows the new value.
   * The call is queued behind loads, resets and saves.
   *
   * Checked before anything is sent (the backend would close the socket on some bad messages): the value is a finite
   * number between `minimum` and `maximum`, the port is not driven by the host, and the plugin is still in the pedalboard.
   *
   * The change is also announced to `param.on('change')` and `instance.on('param')` (with `origin: 'local'` and the `source` given),
   * since the backend does not echo it.
   *
   * WebSocket: `param_set <instance>/<symbol> <value>` (see `connectMainWebSocket`).
   * @param options.source Marks the change as yours: its events carry it, and a subscription with `ignoreSource` skips them.
   * @throws {ModUiError} for an invalid value, a host-driven port, or a plugin that is not in the pedalboard.
   * @example
   * const gain = instance.params.get('gain')!;
   * await gain.setValue(gain.default);
   * await gain.setValue(gain.maximum / 2, { source: mySlider });
   */
  setValue(value: number, options: WriteOptions = {}): Promise<void> {
    if (typeof value !== 'number' || !isFinite(value)) {
      return Promise.reject(new ModUiError(`"${this.symbol}": expected a finite number, got ${String(value)}`));
    }
    if (value < this.minimum || value > this.maximum) {
      return Promise.reject(
        new ModUiError(`"${this.symbol}": ${value} is outside the range ${this.minimum} .. ${this.maximum}`),
      );
    }
    if (HOST_DESIGNATIONS.includes(this.designation)) {
      return Promise.reject(new ModUiError(`"${this.symbol}" is driven by the host (${this.designation}) and cannot be set`));
    }
    return this.owner.rejectIfGone() ?? this.ops.setParam(this.owner.instance, this.symbol, value, options.source);
  }

  /**
   * Calls `handler` each time the value changes, whoever changed it (this client, the classic UI, another client). Nothing is
   * requested from the backend; the value is already in memory when the handler runs. The subscription ends by itself when the
   * plugin is removed or the pedalboard is reloaded.
   * @returns A function that removes the subscription.
   * @example
   * const off = gain.on('change', ({ value }) => knob.setPosition(value), { ignoreSource: knob });
   */
  on(_event: 'change', handler: (event: ParamEvent) => void, options?: ListenOptions): Unsubscribe {
    return this.listen(handler, options, false);
  }

  /** Like {@link Param.on}, but the handler runs once. */
  once(_event: 'change', handler: (event: ParamEvent) => void, options?: ListenOptions): Unsubscribe {
    return this.listen(handler, options, true);
  }

  private listen(handler: (event: ParamEvent) => void, options: ListenOptions | undefined, once: boolean): Unsubscribe {
    return this.owner.listenTo('param', handler, options, once, (event) => event.param === this);
  }
}

/** The control inputs of a plugin instance (`instance.params`). */
export class PluginParams {
  /** @internal Built by the client. */
  constructor(private items: Param[]) {}

  /** @internal Fills in the controls of a plugin whose description arrived after the object was built. */
  replace(items: Param[]): void {
    this.items = items;
  }

  /**
   * Every control input, in the order of the plugin. Synchronous: the description is already known when the instance
   * exists. Empty when the plugin is not installed.
   * @example
   * for (const param of instance.params.list()) console.log(param.symbol, param.value, param.minimum, param.maximum);
   */
  list(): Param[] {
    return [...this.items];
  }

  /**
   * Finds a control input by symbol.
   * @example
   * await instance.params.get('gain')?.setValue(3.5);
   */
  get(symbol: string): Param | undefined {
    return this.items.find((param) => param.symbol === symbol);
  }
}

/**
 * A plugin in the running pedalboard.
 *
 * `x`, `y`, {@link Param.value} and the active state are read from the live state, so they follow changes made through this
 * client, the classic UI or other clients. The object keeps its identity and its ports; list again to learn about plugins
 * that were added or removed.
 */
export class PluginInstance {
  /** Instance path, e.g. `/graph/Gain`. */
  readonly instance: string;
  /** LV2 URI of the plugin. */
  readonly uri: string;
  /**
   * Connectable ports by type and direction: `ports.audio.input`, `ports.audio.output`, `ports.midi.input`, ...
   * Control ports are not connectable and are not listed.
   */
  readonly ports: PortGroups = emptyPortGroups();
  /** The control inputs (knobs, switches, ...): `params.list()`, `params.get('gain')`. */
  readonly params: PluginParams;
  /** The patch parameters (strings, paths, booleans, ...): `patchParams.list()`, `patchParams.get(uri)`. */
  readonly patchParams: PluginPatchParams;
  /** The presets of the plugin (shared with its other instances): `presets.list()`, `load()`, `create()`, `save()`, `delete()`. */
  readonly presets: PluginPresets;

  private description: PluginInfo | null = null;

  /** @internal Built by the client. */
  constructor(private readonly last: ModelPlugin, info: PluginInfo | null, private readonly ops: InstanceOps) {
    this.instance = last.instance;
    this.uri = last.uri;
    this.params = new PluginParams([]);
    this.patchParams = new PluginPatchParams(this, ops);
    this.presets = new PluginPresets(this, ops.presetCatalog(last.uri), ops.presetEngine);
    if (info) {
      this.attach(info);
    }
  }

  /**
   * Description of the plugin (ports, parameters, presets, ...); `null` when it is not known: the plugin is not installed, or
   * the request for it failed (`plugins.list()` and `plugins.get()` ask again). The object keeps its identity when it arrives.
   */
  get info(): PluginInfo | null {
    return this.description;
  }

  /** @internal Gives the description to an instance that was built without it: fills `ports`, `params` and `patchParams`. */
  attach(info: PluginInfo): void {
    if (this.description) {
      return;
    }
    this.description = info;
    for (const type of PORT_TYPES) {
      for (const direction of ['input', 'output'] as const) {
        for (const port of info.ports[type]?.[direction] ?? []) {
          this.ports[type][direction].push(
            new Port(`${this.instance}/${port.symbol}`, port.symbol, port.name, type, direction, this),
          );
        }
      }
    }
    this.params.replace((info.ports.control?.input ?? []).map((port) => new Param(this, port, this.ops)));
    this.patchParams.fill(info.parameters ?? []);
  }

  /**
   * Whether this object still stands for a plugin of the running pedalboard. It turns `false`, for good, when the plugin is
   * removed, when the pedalboard is reset and when another one is loaded (the same path in the new pedalboard is a new object).
   * A gone plugin keeps its last known state in its getters, and its operations throw.
   */
  get alive(): boolean {
    return this.ops.isAlive(this);
  }

  /**
   * Calls `handler` when something about this plugin changes, whoever caused it. Nothing is requested from the backend.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `param` | a control port changed | `{ plugin, param, value, previous }` |
   * | `active` | bypassed or switched on | `{ plugin, active }` |
   * | `moved` | the block moved in the canvas | `{ plugin, x, y }` |
   * | `patch` | a patch parameter changed | `{ plugin, uri, param, value }` |
   * | `preset` | the current preset changed | `{ plugin, preset, previous }` (`null`: none) |
   * | `removed` | the plugin is gone (removed, reset, reloaded) | `{ plugin, reason }` |
   *
   * Every payload also has `origin` (`'local'` for a change made through this client, `'remote'` otherwise) and `source`.
   * The subscription ends by itself after `removed`. No event is delivered while a pedalboard is loading.
   * @param options `signal` (an `AbortSignal` that ends the subscription), `ignoreSource` (skips the changes made with that
   *   `source`), `ignoreLocal` (skips every change made through this client).
   * @returns A function that removes the subscription.
   * @example
   * const off = instance.on('active', ({ active }) => led.classList.toggle('on', active));
   * instance.on('removed', () => view.remove());
   */
  on<K extends keyof PluginEvents>(event: K, handler: (event: PluginEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.listenTo(event === 'removed' ? 'instance:removed' : event, handler as never, options, false);
  }

  /** Like {@link PluginInstance.on}, but the handler runs once. */
  once<K extends keyof PluginEvents>(event: K, handler: (event: PluginEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.listenTo(event === 'removed' ? 'instance:removed' : event, handler as never, options, true);
  }

  /** @internal Subscribes to an event of the store about this plugin. */
  listenTo<K extends keyof StoreEvents>(
    event: K,
    handler: (event: StoreEvents[K]) => void,
    options: ListenOptions | undefined,
    once: boolean,
    extra?: (event: StoreEvents[K]) => boolean,
  ): Unsubscribe {
    return this.ops.listen(this, event, handler, options, once, extra);
  }

  /** @internal A rejected promise when this plugin is gone, `undefined` when it is still in the pedalboard. */
  rejectIfGone(): Promise<never> | undefined {
    return this.alive ? undefined : Promise.reject(new ModUiError(`There is no plugin "${this.instance}" in the running pedalboard`));
  }

  private rejectIfNotBypassable(): Promise<never> | undefined {
    return this.bypassable ? undefined : Promise.reject(new ModUiError(`The plugin "${this.instance}" (${this.uri}) has no bypass`));
  }

  /** @internal The live state of this plugin (the last known one when it is gone). */
  liveModel(): ModelPlugin {
    return (this.alive ? this.ops.live(this.instance) : undefined) ?? this.last;
  }

  /**
   * URI of the current preset of the plugin (the list is `presets.list()`), `null` when none. Live, like {@link PluginInstance.x}:
   * it follows the classic UI, the HMI and other clients. Changes are announced by `instance.on('preset')`.
   */
  get preset(): string | null {
    return this.liveModel().preset;
  }

  /** Horizontal position of the block in the canvas. */
  get x(): number {
    return this.liveModel().x;
  }

  /** Vertical position of the block in the canvas. */
  get y(): number {
    return this.liveModel().y;
  }

  /**
   * Finds a port by symbol, whatever its type and direction.
   * @example
   * const input = instance.port('in');   // same as instance.ports.audio.input[0] for a mono effect
   */
  port(symbol: string): Port | undefined {
    return allPorts(this.ports).find((port) => port.symbol === symbol);
  }

  /**
   * `false` for the plugins that mod-host implements itself and that have no bypass (the Buffer): {@link PluginInstance.setActive} and
   * {@link PluginInstance.toggle} refuse them, because the backend ignores `:bypass` for them (and still echoes it to the other
   * clients) and addressing it is refused. `true` for every other plugin, and while the description is not known (`info === null`).
   * @example
   * if (instance.bypassable) showBypassSwitch(instance);
   */
  get bypassable(): boolean {
    return this.description?.bypassable !== false;
  }

  /**
   * Whether the plugin is processing audio (`true`) or bypassed (`false`). Reads the live state, after the socket is in sync.
   * @throws {ModUiError} when the plugin is not in the pedalboard (any more).
   * @example
   * if (await instance.isActive()) console.log('on');
   */
  isActive(): Promise<boolean> {
    return this.rejectIfGone() ?? this.ops.isActive(this.instance);
  }

  /**
   * Turns the plugin on (`true`) or bypasses it (`false`). Like {@link Param.setValue}, the backend sends no confirmation to
   * the sender: the promise resolves once the message was sent.
   *
   * The change is announced to `instance.on('active')` (`origin: 'local'`) when the state really changes.
   *
   * WebSocket: `param_set <instance>/:bypass <0|1>` (`1` bypasses).
   * @param options.source Marks the change as yours (see {@link Param.setValue}).
   * @throws {ModUiError} when the plugin is not in the pedalboard, or has no bypass ({@link PluginInstance.bypassable} is `false`).
   * @example
   * await instance.setActive(false);   // bypass
   */
  setActive(active: boolean, options: WriteOptions = {}): Promise<void> {
    if (typeof active !== 'boolean') {
      return Promise.reject(new ModUiError('Expected true (on) or false (bypassed)'));
    }
    return this.rejectIfGone() ?? this.rejectIfNotBypassable() ?? this.ops.setActive(this.instance, active, options.source);
  }

  /**
   * Switches between on and bypassed and resolves with the new state (`true` = active). Announced like {@link PluginInstance.setActive}.
   * @param options.source Marks the change as yours (see {@link Param.setValue}).
   * @throws {ModUiError} when the plugin is not in the pedalboard, or has no bypass ({@link PluginInstance.bypassable} is `false`).
   * @example
   * const active = await instance.toggle();
   */
  toggle(options: WriteOptions = {}): Promise<boolean> {
    return this.rejectIfGone() ?? this.rejectIfNotBypassable() ?? this.ops.toggle(this.instance, options.source);
  }

  /**
   * Sets the place of the block in the canvas and resolves once the message was sent (no confirmation is sent to the sender). The
   * position is stored with the pedalboard at the next save, and `x` / `y` already show it.
   *
   * Announced to `instance.on('moved')` (`origin: 'local'`) when the position really changes.
   *
   * WebSocket: `plugin_pos <instance> <x> <y>`.
   * @param options.source Marks the change as yours (see {@link Param.setValue}).
   * @throws {ModUiError} for coordinates that are not finite numbers, or a plugin that is not in the pedalboard.
   * @example
   * await instance.setPosition({ x: 320, y: 140 });
   */
  setPosition(position: Position, options: WriteOptions = {}): Promise<void> {
    if (!position || !isFinite(position.x) || !isFinite(position.y) || typeof position.x !== 'number' || typeof position.y !== 'number') {
      return Promise.reject(new ModUiError('Expected a position { x, y } with finite numbers'));
    }
    return this.rejectIfGone() ?? this.ops.setPosition(this.instance, position, options.source);
  }

  /**
   * Removes this plugin (and its connections) from the pedalboard. Same as `plugins.remove(instance)`.
   * @param options.source Marks the change as yours (see {@link PedalboardPlugins.add}).
   * @throws {ModUiError} see {@link PedalboardPlugins.remove}.
   */
  remove(options: WriteOptions = {}): Promise<void> {
    return this.rejectIfGone() ?? this.ops.remove(this.instance, options.source);
  }
}

/** The ports of one type, split by direction. */
export interface PortsByDirection {
  /** Sinks. */
  input: Port[];
  /** Sources. */
  output: Port[];
}

/** Ports by type and direction: `groups.audio.input`, `groups.midi.output`, ... */
export type PortGroups = Record<PortType, PortsByDirection>;

function emptyPortGroups(): PortGroups {
  return {
    audio: { input: [], output: [] },
    midi: { input: [], output: [] },
    cv: { input: [], output: [] },
  };
}

function allPorts(groups: PortGroups): Port[] {
  const result: Port[] = [];
  for (const type of PORT_TYPES) {
    result.push(...groups[type].input, ...groups[type].output);
  }
  return result;
}

/** A connection between an output and an input of the running pedalboard. */
export class PedalboardConnection {
  /** @internal Built by the client. */
  constructor(
    /** The source: an output port. */
    readonly from: Port,
    /** The sink: an input port. */
    readonly to: Port,
  ) {}

  /** `"<from id>,<to id>"`, the form used in URLs. */
  get id(): string {
    return `${this.from.id},${this.to.id}`;
  }
}

const PORT_TYPES: PortType[] = ['audio', 'midi', 'cv'];
/** Sources before sinks. */
const DIRECTION_ORDER: PortDirection[] = ['output', 'input'];

/** Everything the graph holds at one moment. */
interface GraphView {
  instances: PluginInstance[];
  /** Ports of the pedalboard itself. */
  pedalboardPorts: Port[];
  connections: PedalboardConnection[];
  /** Finds a port by object or id, any port of the pedalboard. */
  port(ref: Port | string): Port;
}

/** `graph/Gain` and `/graph/Gain` are the same port; the client always uses the leading slash. */
function normalizeId(id: string): string {
  return id.startsWith('/') ? id : '/' + id;
}

/**
 * Instance path for a new plugin, as the classic UI does (`generateInstance` in `html/js/pedalboard.js`): last URI
 * segment, invalid characters → `_`, `_` prefix when it starts with a digit, `/graph/cv` is reserved, then `_1`,
 * `_2`, ... until it is unused.
 */
export function generateInstance(uri: string, used: { has(instance: string): boolean }): string {
  const lastDelimiter = (text: string): number => {
    for (let i = text.length - 1; i > 0; --i) {
      if ('/?#:'.includes(text[i])) {
        return i;
      }
    }
    return -1;
  };
  let name = uri;
  let delimiter = lastDelimiter(name);
  while (delimiter !== -1 && !/[a-zA-Z0-9]/.test(name.slice(delimiter))) {
    name = name.slice(0, delimiter);
    delimiter = lastDelimiter(name);
  }
  name = name.slice(delimiter + 1).replace(/[^_a-zA-Z0-9]+/g, '_');
  if (name === '') {
    name = 'plugin';
  }
  if (/^[0-9]/.test(name)) {
    name = '_' + name;
  }
  let instance = '/graph/' + name;
  if (instance === '/graph/cv') {
    instance += 'x';
  }
  if (used.has(instance)) {
    const base = instance;
    let n = 1;
    do {
      instance = `${base}_${n++}`;
    } while (used.has(instance));
  }
  return instance;
}

/**
 * Engine of `device.currentPedalboard.plugins`, `.connections` and `.ports` (internal).
 *
 * Reads come from the WebSocket-fed {@link GraphState}; writes are HTTP requests confirmed by the matching
 * WebSocket frame. Everything runs through the `Device` queue.
 */
export class PedalboardGraph {
  /** The objects of the running pedalboard and their events. */
  readonly store: PedalboardStore;

  constructor(
    private readonly http: HttpTransport,
    private readonly events: EventChannel,
    private readonly state: GraphState,
    private readonly plugins: PluginsApi,
    private readonly enqueue: Enqueue,
    private readonly confirmTimeoutMs: number,
    schedule: () => Schedule,
  ) {
    this.store = new PedalboardStore(state, plugins, {
      instance: (model, info) => new PluginInstance(model, info, this.ops),
      hardwarePort: (port) =>
        new Port(port.id, port.id.slice(port.id.lastIndexOf('/') + 1), port.title, port.type, port.direction, null),
      connection: (from, to) => new PedalboardConnection(from, to),
    }, schedule, confirmTimeoutMs);
  }

  /** @internal Tags the changes `match` accepts as made by this client until the returned function is called. */
  expect(match: (change: GraphChange) => boolean, source: unknown): () => void {
    return this.store.expect(match, source);
  }

  // ---- reads --------------------------------------------------------------------------------------------------------

  /** Connects the socket and waits until the model is in sync (what every read does first). Call it from inside the queue. */
  async sync(): Promise<void> {
    await this.state.ready();
  }

  /** Plugin instances of the running pedalboard. */
  listInstances(): Promise<PluginInstance[]> {
    return this.enqueue(async () => (await this.view()).instances);
  }

  /** One plugin instance, `undefined` when there is none with that path. */
  getInstance(path: string): Promise<PluginInstance | undefined> {
    return this.enqueue(async () => {
      await this.view();
      return this.store.instance(normalizeId(path));
    });
  }

  /** Ports of the pedalboard itself, optionally of one type and direction: audio, MIDI, CV; sources first; by index. */
  listPedalboardPorts(type?: PortType, direction?: PortDirection): Promise<Port[]> {
    return this.enqueue(async () =>
      (await this.view()).pedalboardPorts.filter(
        (port) => (type === undefined || port.type === type) && (direction === undefined || port.direction === direction),
      ),
    );
  }

  /** Connections of the running pedalboard. */
  listConnections(): Promise<PedalboardConnection[]> {
    return this.enqueue(async () => (await this.view()).connections);
  }

  // ---- writes -------------------------------------------------------------------------------------------------------

  addPlugin(target: PluginTarget, position?: Position, options: WriteOptions = {}): Promise<PluginInstance> {
    return this.enqueue(async () => {
      const uri = typeof target === 'string' ? target : target && target.uri;
      if (typeof uri !== 'string' || uri === '') {
        throw new ModUiError('Expected a plugin URI, a Plugin or a PluginInfo');
      }
      const model = await this.state.ready();
      const instance = generateInstance(uri, model.plugins);

      // The backend pushes "add" before it answers the HTTP request, and the answer carries the description of the plugin:
      // the store waits for it instead of asking again.
      const arrival = this.plugins.expect(uri);
      const release = this.store.expect((change) => change.type === 'plugin-added' && change.instance === instance, options.source);
      try {
        const added = this.events.waitFor('add', this.confirmTimeoutMs, (args) => args.split(' ')[0] === instance);
        let info: PluginInfo | false;
        try {
          info = await this.http.getJson<PluginInfo | false>(`/effect/add/${instance}`, {
            uri,
            x: position?.x ?? 0,
            y: position?.y ?? 0,
          });
          if (info) {
            this.plugins.remember(info);
          }
        } catch (error) {
          added.cancel();
          throw error;
        } finally {
          arrival.done();
        }
        if (!info) {
          added.cancel();
          throw new ModUiError(`The backend could not load the plugin "${uri}" (is it installed?)`);
        }
        await added.promise;
        await this.store.settled();

        const created = this.store.instance(instance);
        if (!created) {
          throw new ModUiError(`The plugin "${instance}" disappeared right after it was added`);
        }
        return created;
      } finally {
        release();
      }
    });
  }

  removePlugin(target: string | { readonly instance: string }, options: WriteOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      const instance = normalizeId(typeof target === 'string' ? target : (target && target.instance) ?? '');
      const model = await this.state.ready();
      if (!model.plugins.has(instance)) {
        throw new ModUiError(`There is no plugin "${instance}" in the running pedalboard`);
      }
      // The backend sends "disconnect" frames and then "remove" before it answers: all of them are caused by this call.
      const ownedBy = (port: string) => port.startsWith(instance + '/');
      const release = this.store.expect(
        (change) =>
          (change.type === 'plugin-removed' && change.instance === instance) ||
          (change.type === 'connection-removed' && (ownedBy(change.from) || ownedBy(change.to))),
        options.source,
      );
      try {
        const removed = this.events.waitFor('remove', this.confirmTimeoutMs, (args) => args === instance);
        let ok: boolean;
        try {
          ok = await this.http.getJson<boolean>(`/effect/remove/${instance}`);
        } catch (error) {
          removed.cancel();
          throw error;
        }
        if (ok !== true) {
          removed.cancel();
          throw new ModUiError(`The backend could not remove the plugin "${instance}"`);
        }
        await removed.promise;
      } finally {
        release();
      }
    });
  }

  // The backend sends no confirmation to the socket that sent "param_set", "patch_set" or "plugin_pos" (only to the others), so these
  // calls resolve once the message is sent, and apply it to the model themselves as the frame the others receive: the store reports
  // it as a local change.

  setParam(instance: string, symbol: string, value: number, source?: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.requirePlugin(instance);
      this.events.send(`param_set ${instance}/${symbol} ${value}`);
      this.state.applyLocal('param_set', `${instance} ${symbol} ${value}`, source);
    });
  }

  setPatch(instance: string, uri: string, typeChar: string, encoded: string, source?: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.requirePlugin(instance);
      this.events.send(`patch_set ${instance} ${uri} ${typeChar} ${encoded}`);
      this.state.applyLocal('patch_set', `${instance} 1 ${uri} ${typeChar} ${encoded}`, source);
    });
  }

  /**
   * `patch_get` is answered by a `patch_set` frame to every socket. The wait is registered before the request is sent and
   * the queue is left before waiting, so a slow or silent plugin does not block loads, saves and other calls.
   */
  async refreshPatch(instance: string, uri: string, timeoutMs: number = this.confirmTimeoutMs, source?: unknown): Promise<string> {
    // The expectation lives from the moment the request is sent (inside the queue) to the answer: a patch_set that another client
    // sends while this call waits behind a load is not ours.
    let release: () => void = () => undefined;
    try {
      const answer = await this.enqueue(async () => {
        await this.requirePlugin(instance);
        release = this.store.expect((change) => change.type === 'patch' && change.instance === instance && change.uri === uri, source);
        const waiting = this.events.waitFor('patch_set', timeoutMs, (args) => {
          const [id, , parameter] = args.split(' ');
          return id === instance && parameter === uri;
        });
        try {
          this.events.send(`patch_get ${instance} ${uri}`);
        } catch (error) {
          waiting.cancel();
          throw error;
        }
        return waiting;
      });
      return patchFrameValue(await answer.promise) ?? '';
    } finally {
      release();
    }
  }

  isActive(instance: string): Promise<boolean> {
    return this.enqueue(async () => !(await this.requirePlugin(instance)).bypassed);
  }

  setActive(instance: string, active: boolean, source?: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.requirePlugin(instance);
      this.sendBypass(instance, active, source);
    });
  }

  toggle(instance: string, source?: unknown): Promise<boolean> {
    return this.enqueue(async () => {
      const plugin = await this.requirePlugin(instance);
      const active = plugin.bypassed; // bypassed now -> active after
      this.sendBypass(instance, active, source);
      return active;
    });
  }

  private sendBypass(instance: string, active: boolean, source: unknown): void {
    const value = active ? '0.0' : '1.0';
    this.events.send(`param_set ${instance}/:bypass ${value}`);
    this.state.applyLocal('param_set', `${instance} :bypass ${value}`, source);
  }

  setPosition(instance: string, position: Position, source?: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.requirePlugin(instance);
      this.events.send(`plugin_pos ${instance} ${position.x} ${position.y}`);
      this.state.applyLocal('plugin_pos', `${instance} ${position.x} ${position.y}`, source);
    });
  }

  connect(from: Port | string, to: Port | string, options: WriteOptions = {}): Promise<PedalboardConnection> {
    return this.enqueue(async () => {
      const view = await this.view();
      const source = view.port(from);
      const target = view.port(to);
      validateConnection(source, target);

      const existing = view.connections.find((c) => c.from.id === source.id && c.to.id === target.id);
      if (existing) {
        // The backend answers "true" and sends no frame for a connection that exists.
        return existing;
      }
      const release = this.store.expect(
        (change) => change.type === 'connection-added' && change.from === source.id && change.to === target.id,
        options.source,
      );
      try {
        const connected = this.events.waitFor('connect', this.confirmTimeoutMs, (args) => args === `${source.id} ${target.id}`);
        let ok: boolean;
        try {
          ok = await this.http.getJson<boolean>(`/effect/connect/${source.id},${target.id}`);
        } catch (error) {
          connected.cancel();
          throw error;
        }
        if (ok !== true) {
          connected.cancel();
          throw new ModUiError(`The backend could not connect "${source.id}" to "${target.id}"`);
        }
        await connected.promise;
      } finally {
        release();
      }
      return this.store.connection(source, target);
    });
  }

  disconnect(
    connection: PedalboardConnection | { readonly from: Port | string; readonly to: Port | string },
    options: WriteOptions = {},
  ): Promise<void> {
    return this.enqueue(async () => {
      const model = await this.state.ready();
      const from = normalizeId(typeof connection.from === 'string' ? connection.from : connection.from.id);
      const to = normalizeId(typeof connection.to === 'string' ? connection.to : connection.to.id);
      // The backend answers "true" and broadcasts "disconnect" even when nothing was connected.
      if (!model.hasConnection(from, to)) {
        throw new ModUiError(`"${from}" is not connected to "${to}"`);
      }
      const release = this.store.expect(
        (change) => change.type === 'connection-removed' && change.from === from && change.to === to,
        options.source,
      );
      try {
        const disconnected = this.events.waitFor('disconnect', this.confirmTimeoutMs, (args) => args === `${from} ${to}`);
        let ok: boolean;
        try {
          ok = await this.http.getJson<boolean>(`/effect/disconnect/${from},${to}`);
        } catch (error) {
          disconnected.cancel();
          throw error;
        }
        if (ok !== true) {
          disconnected.cancel();
          throw new ModUiError(`The backend could not disconnect "${from}" from "${to}"`);
        }
        await disconnected.promise;
      } finally {
        release();
      }
    });
  }

  // ---- model → objects ----------------------------------------------------------------------------------------------

  private readonly ops: InstanceOps = {
    live: (instance) => this.state.peek().plugins.get(instance),
    isAlive: (plugin) => this.store.isAlive(plugin),
    listen: (plugin, event, handler, options, once, extra) => this.store.listen(plugin, event, handler, options, once, extra),
    presetCatalog: (uri) => this.plugins.presetCatalog(uri),
    presetEngine: {
      getJson: (path, query) => this.http.getJson(path, query),
      queue: (task) =>
        this.enqueue(async () => {
          await this.state.ready();
          return task();
        }),
      has: (instance) => this.state.peek().plugins.has(instance),
      expect: (match, source) => this.store.expect(match, source),
      setCurrent: (instance, uri, source) => this.state.applyLocal('preset', `${instance} ${uri ?? 'null'}`, source),
    },
    remove: (instance, source) => this.removePlugin(instance, { source }),
    setParam: (instance, symbol, value, source) => this.setParam(instance, symbol, value, source),
    setPatch: (instance, uri, typeChar, encoded, source) => this.setPatch(instance, uri, typeChar, encoded, source),
    refreshPatch: (instance, uri, timeoutMs, source) => this.refreshPatch(instance, uri, timeoutMs, source),
    isActive: (instance) => this.isActive(instance),
    setActive: (instance, active, source) => this.setActive(instance, active, source),
    toggle: (instance, source) => this.toggle(instance, source),
    setPosition: (instance, position, source) => this.setPosition(instance, position, source),
  };

  /** The model entry of a plugin. The backend raises (and closes the socket) for an unknown instance, so check first. */
  private async requirePlugin(instance: string): Promise<ModelPlugin> {
    const plugin = (await this.state.ready()).plugins.get(instance);
    if (!plugin) {
      throw new ModUiError(`There is no plugin "${instance}" in the running pedalboard`);
    }
    return plugin;
  }

  /**
   * The objects for the current model, in the order of the model. Must run inside the queue. The objects are the store's, so
   * they are the same ones on every call; only a plugin that has no description yet asks the backend again.
   */
  private async view(): Promise<GraphView> {
    const model: GraphModel = await this.state.ready();
    await this.store.fillMissing();

    const instances: PluginInstance[] = [];
    for (const path of model.plugins.keys()) {
      const instance = this.store.instance(path);
      if (instance) {
        instances.push(instance);
      }
    }
    const pedalboardPorts = Array.from(model.hardware.values())
      .sort((a, b) => PORT_TYPES.indexOf(a.type) - PORT_TYPES.indexOf(b.type) || DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction) || a.index - b.index)
      .map((port) => this.store.hardwarePort(port));

    const ports = new Map<string, Port>();
    for (const port of pedalboardPorts) {
      ports.set(port.id, port);
    }
    for (const instance of instances) {
      for (const port of allPorts(instance.ports)) {
        ports.set(port.id, port);
      }
    }
    const find = (ref: Port | string): Port => {
      const id = normalizeId(typeof ref === 'string' ? ref : ref && ref.id);
      const port = ports.get(id);
      if (!port) {
        throw new ModUiError(`There is no port "${id}" in the running pedalboard`);
      }
      return port;
    };

    // Connections whose ports are unknown (a plugin that is not installed) are left out.
    const connections: PedalboardConnection[] = [];
    for (const { from, to } of model.connections) {
      const source = ports.get(from);
      const target = ports.get(to);
      if (source && target) {
        connections.push(this.store.connection(source, target));
      }
    }
    // The caches keep only what is in the pedalboard now (ports and connections of removed plugins would hold the dead plugins).
    this.store.retain(
      new Set(pedalboardPorts.map((port) => port.id)),
      new Set(connections.map((connection) => connection.id)),
    );
    return { instances, pedalboardPorts, connections, port: find };
  }
}

/** Throws {@link ModUiError} unless `from` is an output, `to` an input of the same type, on different plugins. */
function validateConnection(from: Port, to: Port): void {
  if (from.direction !== 'output') {
    throw new ModUiError(`"${from.id}" is an input: the first port of a connection must be an output`);
  }
  if (to.direction !== 'input') {
    throw new ModUiError(`"${to.id}" is an output: the second port of a connection must be an input`);
  }
  if (from.type !== to.type) {
    throw new ModUiError(`Cannot connect ${from.type} "${from.id}" to ${to.type} "${to.id}": the types differ`);
  }
  if (from.owner !== null && to.owner !== null && from.owner.instance === to.owner.instance) {
    throw new ModUiError(`Cannot connect two ports of the same plugin ("${from.owner.instance}")`);
  }
}
