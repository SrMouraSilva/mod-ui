// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Entry point: {@link ModUiClient} and its options.
 * @module
 */

import { BanksApi } from './banks';
import { ConfigApi } from './config';
import { Emitter, type ListenOptions, type Unsubscribe } from './emitter';
import { Device } from './device';
import { ModUiError } from './errors';
import { defaultSchedule, type Schedule } from './snapshot';
import { FilesApi } from './files';
import { EventChannel, type ConnectionState, type ReconnectOptions, type StateEvent } from './events';
import { HttpTransport } from './http';
import type { ErrorEvent } from './pedalboard-events';
import { PedalboardsApi } from './pedalboards';
import { PluginsApi } from './plugins';
import type { FetchLike, WebSocketFactory, WebSocketLike } from './runtime';
import { SystemApi } from './system';

/** Options of {@link ModUiClient}. All are optional in a mod-ui page. */
export interface ModUiClientOptions {
  /**
   * Origin of the mod-ui server, e.g. `"http://modduo.local"`. Defaults to `location.origin`.
   * The WebSocket URL is derived from it (`http` → `ws`, `https` → `wss`).
   */
  baseUrl?: string;
  /** `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** WebSocket class used to open the client's own socket. Defaults to the global `WebSocket`. */
  WebSocket?: WebSocketFactory;
  /**
   * Reuse an already open socket instead of opening a new one (in the classic UI: `window.ws`).
   * The client then never answers `ping`/`data_ready` and never closes it.
   */
  webSocket?: WebSocketLike;
  /** Default timeout for pedalboard loads, in ms. Default: 60000. */
  loadTimeoutMs?: number;
  /** Timeout for opening the WebSocket and receiving the initial state replay, in ms. Default: 30000. */
  connectTimeoutMs?: number;
  /**
   * Maximum time to wait for the WebSocket frame that confirms a plugin or connection change
   * (`add`, `remove`, `connect`, `disconnect`), in ms. Default: 10000.
   */
  graphTimeoutMs?: number;
  /**
   * Reconnect by itself when the connection is lost (own socket only: the owner of a shared `webSocket` decides what to do).
   * `true` uses the defaults (first retry after 500 ms, doubling up to 10 s, ±20 % jitter); pass {@link ReconnectOptions} to tune it.
   * Default: off. See {@link ModUiClient.state}.
   */
  reconnect?: boolean | ReconnectOptions;
  /**
   * Runs the callback that notifies the subscribers of `currentPedalboard.subscribe()`, so that a burst of changes (a knob drag is
   * dozens of WebSocket messages) costs one notification. Default: `requestAnimationFrame` in a browser, a microtask elsewhere.
   * Node code can pass `(callback) => setTimeout(callback, 16)`, tests a function they call by hand.
   */
  schedule?: Schedule;
}

/** Events of {@link ModUiClient.on}. */
export interface ClientEvents {
  /** The connection state changed. */
  state: StateEvent;
  /** A background request failed (today: the description of a plugin that appeared). Same as `currentPedalboard.on('error')`. */
  error: ErrorEvent;
}

/**
 * Entry point of the mod-ui client.
 *
 * @example
 * // In a mod-ui page (same origin)
 * const client = new ModUiClient();
 *
 * // From another origin / Node (Node 22+ has global fetch and WebSocket)
 * const remote = new ModUiClient({ baseUrl: 'http://modduo.local' });
 *
 * // Inside the classic UI, sharing its socket instead of opening a second one
 * const shared = new ModUiClient({ webSocket: window.ws });
 */
export class ModUiClient {
  /** Server origin used for every request, without trailing slash. */
  readonly baseUrl: string;
  /** The running pedalboard. */
  readonly device: Device;
  /** The pedalboard library. */
  readonly pedalboards: PedalboardsApi;
  /** The banks: ordered collections of pedalboards. */
  readonly banks: BanksApi;
  /** The files the user put on the device (samples, impulse responses, models). */
  readonly files: FilesApi;
  /** The device itself: what it is, its system settings and (in `system.danger`) the operations that need a person's decision. */
  readonly system: SystemApi;
  /** The preferences kept on the device: `config.mod` (mod-ui's own) and `config.app` (your application's). */
  readonly config: ConfigApi;
  /** Main WebSocket: raw subscriptions and waits. */
  readonly events: EventChannel;

  private readonly emitter = new Emitter<ClientEvents>();

  constructor(options: ModUiClientOptions = {}) {
    const origin = options.baseUrl ?? (typeof location !== 'undefined' ? location.origin : undefined);
    if (!origin) {
      throw new ModUiError('options.baseUrl is required outside a browser page');
    }
    this.baseUrl = origin.replace(/\/+$/, '');

    const fetchImpl = options.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new ModUiError('No fetch implementation available; pass options.fetch');
    }
    const factory =
      options.WebSocket ?? (typeof WebSocket !== 'undefined' ? (WebSocket as unknown as WebSocketFactory) : undefined);

    const http = new HttpTransport(this.baseUrl, fetchImpl);
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/websocket';
    const connectTimeoutMs = options.connectTimeoutMs ?? 30000;
    const reconnect = options.reconnect === true ? {} : options.reconnect || undefined;
    this.events = new EventChannel(wsUrl, factory, options.webSocket, connectTimeoutMs, reconnect);
    this.pedalboards = new PedalboardsApi(http);
    this.banks = new BanksApi(http, this.pedalboards);
    this.files = new FilesApi(http);
    this.system = new SystemApi(http);
    this.config = new ConfigApi(http);
    this.device = new Device(http, this.events, this.pedalboards, new PluginsApi(http), options.loadTimeoutMs ?? 60000, {
      confirmTimeoutMs: options.graphTimeoutMs ?? 10000,
      schedule: () => options.schedule ?? defaultSchedule,
      // Used when the socket is shared: its state replay has passed, so a short-lived own socket reads a new one.
      openSnapshotChannel: () => (factory ? new EventChannel(wsUrl, factory, undefined, connectTimeoutMs) : null),
    });
    this.events.onState((event) => this.emitter.emit('state', event));
    this.device.currentPedalboard.on('error', (event) => this.emitter.emit('error', event));
  }

  /**
   * State of the connection to the backend: `'idle'` (nothing asked yet), `'connecting'`, `'open'`, `'reconnecting'` (lost, trying
   * again: see the `reconnect` option) or `'closed'`. Follow it with `client.on('state', ...)`.
   * @example
   * if (client.state !== 'open') banner.show();
   */
  get state(): ConnectionState {
    return this.events.state;
  }

  /**
   * Calls `handler` when the client itself has news.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `state` | the connection state changed | `{ state, previous, reason?, error? }` (`reason`: `closed`, `backend-stopped`, `timeout`, `manual`) |
   * | `error` | a background request failed | `{ error, context }` |
   *
   * On `open` after `reconnecting` the pedalboard was read again: `currentPedalboard.on('loaded')` fires and the plugin objects of
   * before the loss are gone (`alive === false`). Pending calls at the moment of the loss fail with `ModUiError('WebSocket closed')`.
   * @param options `signal` (an `AbortSignal` that ends the subscription).
   * @returns A function that removes the subscription.
   * @example
   * const off = client.on('state', ({ state, reason }) => {
   *   banner.textContent = state === 'open' ? '' : `Offline (${reason ?? state}), trying again...`;
   * });
   */
  on<K extends keyof ClientEvents>(event: K, handler: (event: ClientEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.emitter.on(event, handler, options);
  }

  /** Like {@link ModUiClient.on}, but the handler runs once. */
  once<K extends keyof ClientEvents>(event: K, handler: (event: ClientEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.emitter.once(event, handler, options);
  }

  /** Connects the WebSocket ahead of time (feature methods do it on demand). See {@link EventChannel.connect}. */
  connect(): Promise<void> {
    return this.events.connect();
  }

  /** Releases the WebSocket (closes it if the client opened it). */
  close(): void {
    this.events.close();
  }
}
