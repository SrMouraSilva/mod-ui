// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The main WebSocket channel (`/websocket`).
 * @module
 */

import { Emitter, type ListenOptions, type Unsubscribe } from './emitter';
import { ModUiError, ModUiTimeoutError } from './errors';
import type { WebSocketFactory, WebSocketLike } from './runtime';

/**
 * State of the main WebSocket (`client.state`):
 * - `idle`: nothing was asked yet;
 * - `connecting`: the socket is being opened and the initial state is being received;
 * - `open`: connected and in sync with the backend;
 * - `reconnecting`: the connection was lost and the client is trying again (see {@link ReconnectOptions});
 * - `closed`: not connected, and not trying (see {@link StateReason}). `connect()` opens it again.
 */
export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Why the state changed to `closed` (or to `reconnecting`):
 * - `closed`: the socket closed (network lost, backend restarted, the owner of a shared socket closed it);
 * - `backend-stopped`: the backend sent `stop` (audio host restarted) and then closed the socket;
 * - `timeout`: the backend did not answer in time while connecting;
 * - `manual`: `client.close()` was called.
 */
export type StateReason = 'closed' | 'backend-stopped' | 'timeout' | 'manual';

/** Payload of the `state` event (`client.on('state', ...)`). */
export interface StateEvent {
  state: ConnectionState;
  previous: ConnectionState;
  /** Set when `state` is `closed` or `reconnecting`. */
  reason?: StateReason;
  /** The failure behind `closed` after a failed connection attempt. */
  error?: Error;
}

/**
 * Automatic reconnection (`ModUiClientOptions.reconnect`). After a lost connection the client waits `minDelayMs`, opens a new socket
 * and waits for the state replay; each failed attempt multiplies the wait by `factor`, up to `maxDelayMs`, and it never gives up
 * (call `client.close()` to stop). Every wait is randomised by `±jitter` (a fraction) so many clients do not retry together.
 */
export interface ReconnectOptions {
  /** Wait before the first attempt, in ms. Default: 500. */
  minDelayMs?: number;
  /** Longest wait between attempts, in ms. Default: 10000. */
  maxDelayMs?: number;
  /** Growth of the wait after each failed attempt. Default: 2. */
  factor?: number;
  /** Fraction of the wait that is randomised, 0 to 1. Default: 0.2. */
  jitter?: number;
}

const RECONNECT_DEFAULTS: Required<ReconnectOptions> = { minDelayMs: 500, maxDelayMs: 10000, factor: 2, jitter: 0.2 };

/** Someone waiting in `connect()` for a reconnection that is under way. */
interface Joiner {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Handler of a WebSocket message: `args` is everything after the command (empty string when none). */
export type MessageHandler = (args: string, command: string) => void;

/** Handle returned by {@link EventChannel.waitFor}. */
export interface Waiting {
  /** Resolves with the message arguments, rejects on timeout, `stop` or socket close. */
  promise: Promise<string>;
  /** Stops waiting; the promise then never settles. */
  cancel(): void;
}

interface Waiter {
  command: string;
  predicate: (args: string) => boolean;
  resolve(args: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;

/**
 * The main WebSocket (`/websocket`, operationId `connectMainWebSocket`).
 *
 * Available as `client.events`. Feature areas use it to await backend confirmations; applications can use
 * {@link EventChannel.on} to observe raw messages (`param_set`, `transport`, `stats`, ...).
 *
 * @example
 * const off = client.events.on('stats', (args) => {
 *   const [cpuLoad, xruns] = args.split(' ');
 *   console.log(`CPU ${cpuLoad}% / ${xruns} xruns`);
 * });
 * await client.connect();
 * // later: off();
 */
export class EventChannel {
  private socket: WebSocketLike | null = null;
  private connecting: Promise<void> | null = null;
  private synced = false;
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly waiters = new Set<Waiter>();
  private readonly owned: boolean;
  private readonly policy: Required<ReconnectOptions> | null;
  private readonly states = new Emitter<{ state: StateEvent }>();
  private readonly newSocketListeners = new Set<() => void>();
  private current: ConnectionState = 'idle';
  private backendStopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly joiners = new Set<Joiner>();

  /**
   * @param url WebSocket URL (`ws://host/websocket`).
   * @param factory Class used to open the client's own socket.
   * @param shared Existing socket to reuse instead (see {@link ModUiClientOptions.webSocket}).
   * @param connectTimeoutMs Timeout for {@link EventChannel.connect}.
   * @param reconnect Automatic reconnection after a lost connection (own socket only); `undefined`: none.
   */
  constructor(
    private readonly url: string,
    private readonly factory: WebSocketFactory | undefined,
    private readonly shared: WebSocketLike | undefined,
    private readonly connectTimeoutMs: number,
    reconnect?: ReconnectOptions,
  ) {
    this.owned = shared === undefined;
    this.policy = reconnect ? { ...RECONNECT_DEFAULTS, ...reconnect } : null;
  }

  /** State of the connection; see {@link ConnectionState}. */
  get state(): ConnectionState {
    return this.current;
  }

  /**
   * Calls `handler` each time {@link EventChannel.state} changes. Same rules as every `on()` of the client (ordered, a throwing handler
   * does not affect the others).
   * @returns A function that removes the subscription.
   * @example
   * client.events.onState(({ state, reason }) => banner.textContent = state === 'open' ? '' : `Connection: ${state} (${reason ?? ''})`);
   */
  onState(handler: (event: StateEvent) => void, options?: ListenOptions): Unsubscribe {
    return this.states.on('state', handler, options);
  }

  /** @internal Calls `listener` each time the channel opens a new socket of its own, before any frame arrives (the state replay follows). */
  onNewSocket(listener: () => void): Unsubscribe {
    this.newSocketListeners.add(listener);
    return () => {
      this.newSocketListeners.delete(listener);
    };
  }

  /** True when the client opened the socket itself (not shared through `options.webSocket`). */
  get ownsSocket(): boolean {
    return this.owned;
  }

  /** True when the socket is open and the initial state replay has been received. */
  get connected(): boolean {
    return this.synced && this.socket !== null && this.socket.readyState === WS_OPEN;
  }

  /**
   * Opens the socket (once) and resolves when the client is in sync with the backend.
   *
   * - Own socket: resolves after the initial state replay (first `loading_end`).
   * - Shared socket: resolves as soon as it is open (its owner already handled the replay).
   * - While the client is reconnecting: resolves when the connection is back (the attempts go on by themselves).
   *
   * Safe to call many times; feature methods call it for you. After the connection was lost and not recovered (state `closed`),
   * calling it opens a new socket.
   * @throws {ModUiTimeoutError} when the backend does not answer within `connectTimeoutMs` (also while waiting for a reconnection).
   * @throws {ModUiError} when the socket closes before it is in sync, or `close()` is called while waiting.
   */
  connect(): Promise<void> {
    if (this.current === 'reconnecting') {
      return this.joinReconnection();
    }
    if (!this.connecting) {
      this.setState('connecting');
      this.connecting = (this.owned ? this.openOwnSocket() : this.attachSharedSocket()).then(
        () => {
          this.synced = true;
          this.setState('open');
        },
        (error) => {
          this.connecting = null;
          this.setState('closed', error instanceof ModUiTimeoutError ? 'timeout' : 'closed', error);
          throw error;
        },
      );
    }
    return this.connecting;
  }

  /**
   * Subscribes to a WebSocket command (`'*'` receives every message).
   * Does not open the socket by itself; call {@link EventChannel.connect} (or any feature method).
   * @returns A function that removes the subscription.
   */
  on(command: string, handler: MessageHandler): () => void {
    let set = this.handlers.get(command);
    if (!set) {
      set = new Set();
      this.handlers.set(command, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  /**
   * Waits for the next message `command` whose arguments satisfy `predicate`.
   * Register the wait **before** triggering the action that produces the message: mod-ui often pushes
   * WebSocket messages before the HTTP response of the request that caused them.
   */
  waitFor(command: string, timeoutMs: number, predicate: (args: string) => boolean = () => true): Waiting {
    let waiter!: Waiter;
    const promise = new Promise<string>((resolve, reject) => {
      waiter = {
        command,
        predicate,
        resolve: (args) => {
          this.removeWaiter(waiter);
          resolve(args);
        },
        reject: (error) => {
          this.removeWaiter(waiter);
          reject(error);
        },
        timer: setTimeout(() => {
          waiter.reject(new ModUiTimeoutError(`No "${command}" message within ${timeoutMs} ms`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
    // Avoid "unhandled rejection" noise while the caller is still awaiting something else.
    promise.catch(() => undefined);
    return { promise, cancel: () => this.removeWaiter(waiter) };
  }

  /** Sends a raw text frame. The socket must be connected. */
  send(text: string): void {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      throw new ModUiError('WebSocket is not connected');
    }
    this.socket.send(text);
  }

  /**
   * Detaches from the socket; closes it only if this client opened it. Pending waits are rejected and a reconnection under way is
   * cancelled. The state becomes `closed` (reason `manual`); `connect()` opens it again.
   */
  close(): void {
    const socket = this.socket;
    this.cancelRetry();
    this.detach();
    this.failWaiters(new ModUiError('Client closed'));
    this.failJoiners(new ModUiError('Client closed'));
    if (socket && this.owned) {
      socket.close();
    }
    if (this.current !== 'closed') {
      this.setState('closed', 'manual');
    }
  }

  // ------------------------------------------------------------------------------------------------------------------

  private openOwnSocket(): Promise<void> {
    if (!this.factory) {
      return Promise.reject(new ModUiError('No WebSocket implementation available; pass options.WebSocket'));
    }
    const socket = new this.factory(this.url);
    for (const listener of Array.from(this.newSocketListeners)) {
      listener();
    }
    this.attach(socket);
    // The initial state replay always ends with "loading_end".
    const replay = this.waitFor('loading_end', this.connectTimeoutMs);
    return replay.promise.then(
      () => undefined,
      (error) => {
        this.detach();
        socket.close();
        throw error;
      },
    );
  }

  private attachSharedSocket(): Promise<void> {
    const socket = this.shared!;
    this.attach(socket);
    if (socket.readyState === WS_OPEN) {
      return Promise.resolve();
    }
    if (socket.readyState !== WS_CONNECTING) {
      this.detach();
      return Promise.reject(new ModUiError('The shared WebSocket is closed'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('open', onOpen);
        this.detach();
        reject(new ModUiTimeoutError(`Shared WebSocket not open within ${this.connectTimeoutMs} ms`));
      }, this.connectTimeoutMs);
      const onOpen = () => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        resolve();
      };
      socket.addEventListener('open', onOpen);
    });
  }

  private attach(socket: WebSocketLike): void {
    this.socket = socket;
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('close', this.onClose);
  }

  private detach(): void {
    if (this.socket) {
      this.socket.removeEventListener('message', this.onMessage);
      this.socket.removeEventListener('close', this.onClose);
    }
    this.socket = null;
    this.connecting = null;
    this.synced = false;
  }

  private readonly onMessage = (event: { data?: unknown }): void => {
    if (typeof event.data !== 'string') {
      return;
    }
    const space = event.data.indexOf(' ');
    const command = space < 0 ? event.data : event.data.slice(0, space);
    const args = space < 0 ? '' : event.data.slice(space + 1);

    if (this.owned) {
      if (command === 'ping') {
        this.socket?.send('pong');
      } else if (command === 'data_ready') {
        // Flow control: mod-host stays silent until the counter is echoed back.
        this.socket?.send('data_ready ' + args);
      }
    }

    for (const key of [command, '*']) {
      const set = this.handlers.get(key);
      if (set) {
        for (const handler of Array.from(set)) {
          handler(args, command);
        }
      }
    }

    if (command === 'stop') {
      this.backendStopped = true;
      this.failWaiters(new ModUiError('The backend stopped (audio host restarted or UI disconnected)'));
      return;
    }
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.command === command && waiter.predicate(args)) {
        waiter.resolve(args);
      }
    }
  };

  private readonly onClose = (): void => {
    const stopped = this.backendStopped;
    this.backendStopped = false;
    this.detach();
    this.failWaiters(new ModUiError('WebSocket closed'));
    if (this.current === 'connecting' || this.current === 'reconnecting') {
      return; // the attempt in progress reports its own failure
    }
    const reason: StateReason = stopped ? 'backend-stopped' : 'closed';
    if (this.owned && this.policy && this.current === 'open') {
      this.startReconnecting(reason);
    } else {
      this.setState('closed', reason);
    }
  };

  // ---- state and reconnection ---------------------------------------------------------------------------------------

  private setState(state: ConnectionState, reason?: StateReason, error?: Error): void {
    if (state === this.current) {
      return;
    }
    const previous = this.current;
    this.current = state;
    const event: StateEvent = { state, previous };
    if (reason !== undefined) event.reason = reason;
    if (error !== undefined) event.error = error;
    this.states.emit('state', event);
  }

  private startReconnecting(reason: StateReason): void {
    this.attempt = 0;
    this.setState('reconnecting', reason);
    this.scheduleAttempt();
  }

  /** Waits `min(max, min * factor^attempt)`, randomised by `±jitter`, then tries once. */
  private scheduleAttempt(): void {
    const { minDelayMs, maxDelayMs, factor, jitter } = this.policy!;
    const base = Math.min(maxDelayMs, minDelayMs * Math.pow(factor, this.attempt));
    const delay = Math.max(0, base * (1 + jitter * (Math.random() * 2 - 1)));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.tryReconnect();
    }, delay);
  }

  private tryReconnect(): void {
    this.connecting = this.openOwnSocket().then(
      () => {
        this.synced = true;
        this.attempt = 0;
        this.setState('open');
        for (const joiner of Array.from(this.joiners)) {
          this.joiners.delete(joiner);
          clearTimeout(joiner.timer);
          joiner.resolve();
        }
      },
      () => {
        this.connecting = null;
        if (this.current === 'reconnecting') {
          this.attempt++;
          this.scheduleAttempt();
        }
      },
    );
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** `connect()` while reconnecting: wait for the connection to come back, for at most `connectTimeoutMs`. */
  private joinReconnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const joiner: Joiner = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.joiners.delete(joiner);
          reject(new ModUiTimeoutError(`Not reconnected within ${this.connectTimeoutMs} ms`));
        }, this.connectTimeoutMs),
      };
      this.joiners.add(joiner);
    });
  }

  private failJoiners(error: Error): void {
    for (const joiner of Array.from(this.joiners)) {
      this.joiners.delete(joiner);
      clearTimeout(joiner.timer);
      joiner.reject(error);
    }
  }

  private removeWaiter(waiter: Waiter): void {
    clearTimeout(waiter.timer);
    this.waiters.delete(waiter);
  }

  private failWaiters(error: Error): void {
    for (const waiter of Array.from(this.waiters)) {
      waiter.reject(error);
    }
  }
}
