// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What runs on the device right now: {@link Device} (`client.device`).
 * @module
 */

import { CurrentPedalboard } from './current-pedalboard';
import {
  DeviceState,
  type BufferSizeEvent,
  type DeviceEvents,
  type SnapshotEvent,
  type StatsEvent,
  type SysStatsEvent,
  type TransportEvent,
  type TrueBypassEvent,
} from './device-state';
import type { ListenOptions, Unsubscribe } from './emitter';
import { ModUiError } from './errors';
import type { EventChannel } from './events';
import { GraphState } from './graph-state';
import type { HttpTransport } from './http';
import { PedalboardGraph } from './pedalboard-graph';
import type { PedalboardsApi } from './pedalboards';
import type { PluginsApi } from './plugins';
import type { Schedule } from './snapshot';
import type { LoadOptions, LoadResult, PedalboardTarget, WriteOptions } from './types';

/**
 * Buffer sizes of the audio engine that mod-ui accepts (`POST /set_buffersize/{size}` only takes these two). A smaller buffer lowers the
 * latency and loads the CPU more.
 */
export enum BufferSize {
  /** 128 frames: lowest latency. */
  Frames128 = 128,
  /** 256 frames: more room for heavy pedalboards. */
  Frames256 = 256,
}

const BUFFER_SIZES: readonly number[] = [BufferSize.Frames128, BufferSize.Frames256];

/**
 * What runs on the device right now (`client.device`).
 *
 * Operations are serialized: a second `load()` starts only after the previous one finished, and saves made
 * through {@link Device.currentPedalboard} wait for a running load.
 *
 * Note: when another client (or the HMI) loads a pedalboard at the same moment, its `loading_end` may
 * resolve this client's wait. mod-ui gives no way to correlate them.
 */
export class Device {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly graph: PedalboardGraph;
  private readonly deviceState: DeviceState;

  /** The pedalboard that is running now: find it, save it, edit its plugins and connections. */
  readonly currentPedalboard: CurrentPedalboard;

  /** The plugins installed on the device. */
  readonly plugins: PluginsApi;

  /** @internal Use `client.device`. */
  constructor(
    private readonly http: HttpTransport,
    private readonly events: EventChannel,
    private readonly pedalboards: PedalboardsApi,
    plugins: PluginsApi,
    private readonly defaultTimeoutMs: number,
    graph: { confirmTimeoutMs: number; openSnapshotChannel: () => EventChannel | null; schedule: () => Schedule },
  ) {
    this.plugins = plugins;
    this.deviceState = new DeviceState(events);
    const enqueue = <T>(task: () => Promise<T>) => this.enqueue(task);
    const state = new GraphState(events, graph.openSnapshotChannel);
    this.graph = new PedalboardGraph(http, events, state, plugins, enqueue, graph.confirmTimeoutMs, graph.schedule);
    this.currentPedalboard = new CurrentPedalboard(http, pedalboards, enqueue, this.graph, events);
  }

  /**
   * Calls `handler` when the device reports something new about itself. Nothing is requested from the backend.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `stats` | every second | `{ cpuLoad, xruns }` (DSP load in %, dropouts) |
   * | `sysStats` | every few seconds | `{ memLoad, cpuFreqKhz, cpuTempMilli }` (`null`: not available) |
   * | `transport` | the global transport changed | `{ rolling, beatsPerBar, bpm, syncMode }` |
   * | `bufferSize` | the JACK buffer size changed | `{ frames }` |
   * | `trueBypass` | the hardware true bypass changed | `{ left, right }` |
   * | `snapshot` | the current snapshot of the pedalboard changed | `{ index, name }` |
   *
   * `stats` and `sysStats` are periodic and arrive every time; the others arrive when the value changes. The last value of each is
   * kept and seeded by the state replay of a new connection, so a late subscriber reads it from {@link Device.stats} and its siblings
   * (`null` until the device reported it). For the frames of a plugin see `instance.on(...)`.
   * @param options `signal` (an `AbortSignal` that ends the subscription).
   * @returns A function that removes the subscription.
   * @example
   * const off = client.device.on('stats', ({ cpuLoad, xruns }) => meter.show(cpuLoad, xruns));
   * client.device.on('transport', ({ bpm, rolling }) => tempo.show(bpm, rolling));
   */
  on<K extends keyof DeviceEvents>(event: K, handler: (event: DeviceEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.deviceState.on(event, handler, options);
  }

  /** Like {@link Device.on}, but the handler runs once. */
  once<K extends keyof DeviceEvents>(event: K, handler: (event: DeviceEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.deviceState.once(event, handler, options);
  }

  /** Last `stats` reported (DSP load and xruns); `null` until the device reported one. Kept while the connection is down. */
  get stats(): StatsEvent | null {
    return this.deviceState.stats;
  }

  /** Last `sysStats` reported (memory, CPU frequency and temperature); `null` until reported. */
  get sysStats(): SysStatsEvent | null {
    return this.deviceState.sysStats;
  }

  /** Last known transport (rolling, beats per bar, tempo, sync mode); `null` until reported. */
  get transport(): TransportEvent | null {
    return this.deviceState.transport;
  }

  /** Last known JACK buffer size; `null` until the device reported one (it does so when it changes). */
  get bufferSize(): BufferSizeEvent | null {
    return this.deviceState.bufferSize;
  }

  /** Last known hardware true bypass; `null` until reported. */
  get trueBypass(): TrueBypassEvent | null {
    return this.deviceState.trueBypass;
  }

  /** The current snapshot of the pedalboard (index and name), as last announced; `null` until announced. */
  get snapshot(): SnapshotEvent | null {
    return this.deviceState.snapshot;
  }

  /**
   * Replaces the running pedalboard and resolves once the backend finished loading it.
   *
   * Steps (same as the classic UI):
   * 1. make sure the WebSocket is connected and in sync;
   * 2. `GET /reset` — clear the current graph (operationId `resetPedalboard`);
   * 3. `POST /pedalboard/load_bundle/` with `bundlepath` (operationId `loadPedalboardBundle`);
   * 4. wait for the WebSocket `loading_end <snapshotId>`.
   *
   * @param target Bundle path, {@link PedalboardReference} or {@link PedalboardInfo}.
   * @throws {ModUiError} when the backend refuses (e.g. the bundle does not exist).
   * @throws {ModUiTimeoutError} when `loading_end` does not arrive in time.
   * @throws {ModUiHttpError} on HTTP errors.
   * @example
   * const [first] = await client.pedalboards.list();
   * const { name, snapshotId } = await client.device.load(first);
   */
  load(target: PedalboardTarget, options: LoadOptions = {}): Promise<LoadResult> {
    let bundlepath: string;
    try {
      bundlepath = bundlepathOf(target);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue(() => this.loadBundle(bundlepath, false, options));
  }

  /**
   * Loads the built-in empty pedalboard, shown as "Untitled".
   *
   * The bundle path is taken from `GET /pedalboard/list` (the entry whose bundle is `…/default.pedalboard`)
   * and it is loaded with `isDefault=1`, so the backend clears the current title and path.
   * @throws {ModUiError} when the list has no default pedalboard.
   * @example
   * await client.device.loadDefault();
   */
  loadDefault(options: LoadOptions = {}): Promise<LoadResult> {
    return this.enqueue(async () => {
      const references = await this.pedalboards.list();
      const reference = references.find((ref) => ref.isDefault);
      if (!reference) {
        throw new ModUiError('The backend does not list a default pedalboard');
      }
      return this.loadBundle(reference.bundlepath, true, options);
    });
  }

  /**
   * Clears the running pedalboard (all plugins, connections and addressings). The WebSocket broadcasts `remove :all`, which
   * `currentPedalboard.on('cleared')` reports (with `origin: 'local'` and the `source` given here).
   *
   * Backend: `GET /reset` (operationId `resetPedalboard`).
   * @throws {ModUiError} when the backend refuses.
   */
  reset(options: WriteOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      const release = this.graph.expect((change) => change.type === 'cleared', options.source);
      try {
        await this.resetNow();
      } finally {
        release();
      }
    });
  }

  /**
   * Changes the buffer size of the audio engine (JACK). On a real device the value is also kept for the next boot.
   *
   * The backend answers with the size in use; the client applies it to {@link Device.bufferSize} (and emits `bufferSize`) without waiting
   * for the `bufsize` frame. Audio may glitch for a moment.
   *
   * Backend: `POST /set_buffersize/{size}` (operationId `setBufferSize`).
   * @param size One of {@link BufferSize}. Any other value is refused before a request is made.
   * @throws {ModUiError} when `size` is not a {@link BufferSize}, or when the engine did not take it.
   * @example
   * const { frames } = await client.device.setBufferSize(BufferSize.Frames256);
   */
  async setBufferSize(size: BufferSize): Promise<BufferSizeEvent> {
    if (!BUFFER_SIZES.includes(size)) {
      throw new ModUiError(`Unsupported buffer size ${String(size)}; use BufferSize.Frames128 or BufferSize.Frames256`);
    }
    const response = await this.http.postForm<{ ok: boolean; size: number }>(`/set_buffersize/${size}`, {});
    if (!response || !response.ok) {
      throw new ModUiError(`The audio engine did not take the buffer size ${size} (it uses ${response?.size})`);
    }
    this.deviceState.applyBufferSize(response.size);
    return { frames: response.size };
  }

  /**
   * Turns the hardware true bypass of one or both channels on or off (`true` = bypassed). A channel that is not given is not touched.
   * Nothing is requested for `{}`. {@link Device.trueBypass} and the `trueBypass` event follow the answer.
   *
   * Backend: `GET /truebypass/{channel}/{bypassed}` (operationId `setTrueBypass`), once per channel given.
   * @throws {ModUiError} when the backend refuses (for example a device without hardware true bypass).
   * @example
   * await client.device.setTrueBypass({ left: true, right: true });
   */
  async setTrueBypass(change: Partial<TrueBypassEvent>): Promise<void> {
    const channels: Array<['Left' | 'Right', boolean | undefined]> = [
      ['Left', change.left],
      ['Right', change.right],
    ];
    for (const [channel, bypassed] of channels) {
      if (bypassed === undefined) {
        continue;
      }
      if (typeof bypassed !== 'boolean') {
        throw new ModUiError(`The true bypass of ${channel} must be true or false`);
      }
      const ok = await this.http.getJson<boolean>(`/truebypass/${channel}/${bypassed}`);
      if (ok !== true) {
        throw new ModUiError(`The backend refused to set the true bypass of ${channel} (does this device have it?)`);
      }
      this.deviceState.applyTrueBypass(channel === 'Left' ? { left: bypassed } : { right: bypassed });
    }
  }

  /**
   * Sets the xrun counter (audio dropouts) back to zero. The next `stats` event, about a second later, carries `xruns: 0`.
   *
   * Backend: `POST /reset_xruns/` (operationId `resetXruns`).
   * @example
   * await client.device.resetXruns();
   */
  async resetXruns(): Promise<void> {
    await this.http.postForm<boolean>('/reset_xruns/', {});
  }

  /**
   * Moves the CPU to the next frequency the hardware offers (after the highest it wraps to the lowest). The new value shows up in
   * {@link Device.sysStats} (`cpuFreqKhz`) in the next `sysStats` event.
   *
   * Backend: `POST /switch_cpu_freq/` (operationId `switchCpuFrequency`). Needs Linux `cpufreq`: on other hosts it fails.
   * @throws {ModUiError} when the backend answers `false` (frequency unknown).
   * @example
   * await client.device.switchCpuFrequency();
   */
  async switchCpuFrequency(): Promise<void> {
    const ok = await this.http.postForm<boolean>('/switch_cpu_freq/', {});
    if (ok !== true) {
      throw new ModUiError('The backend could not change the CPU frequency');
    }
  }

  // ------------------------------------------------------------------------------------------------------------------

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async resetNow(): Promise<void> {
    const ok = await this.http.getJson<boolean>('/reset');
    if (ok !== true) {
      throw new ModUiError('The backend refused to reset the pedalboard');
    }
  }

  private async loadBundle(bundlepath: string, isDefault: boolean, options: LoadOptions): Promise<LoadResult> {
    // The reset, `loading_start` and `loading_end` that follow are caused by this call (a load by someone else at the same
    // moment cannot be told apart: see the note of the class).
    const release = this.graph.expect(
      (change) => change.type === 'cleared' || change.type === 'loading' || change.type === 'loaded',
      options.source,
    );
    try {
      return await this.loadBundleNow(bundlepath, isDefault, options);
    } finally {
      release();
    }
  }

  private async loadBundleNow(bundlepath: string, isDefault: boolean, options: LoadOptions): Promise<LoadResult> {
    await this.events.connect();
    await this.resetNow();

    // The backend emits "loading_end" before answering the HTTP request: start waiting first.
    const loaded = this.events.waitFor('loading_end', options.timeoutMs ?? this.defaultTimeoutMs);
    let response: { ok: boolean; name: string };
    try {
      response = await this.http.postForm('/pedalboard/load_bundle/', {
        bundlepath,
        isDefault: isDefault ? 1 : 0,
      });
    } catch (error) {
      loaded.cancel();
      throw error;
    }
    if (!response || !response.ok) {
      loaded.cancel();
      throw new ModUiError(`The backend could not load "${bundlepath}" (does the bundle exist?)`);
    }

    const snapshotId = parseInt(await loaded.promise, 10);
    return { bundlepath, name: response.name, snapshotId: isNaN(snapshotId) ? 0 : snapshotId };
  }
}

function bundlepathOf(target: PedalboardTarget): string {
  const bundlepath = typeof target === 'string' ? target : target && target.bundlepath;
  if (typeof bundlepath !== 'string' || bundlepath === '') {
    throw new ModUiError('Expected a bundle path, a PedalboardReference or a PedalboardInfo');
  }
  return bundlepath;
}
