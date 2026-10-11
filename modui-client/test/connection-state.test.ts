// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModUiClient, ModUiError, ModUiTimeoutError, type StateEvent } from '../src';
import {
  FakeWebSocket,
  connected,
  connectedWith,
  gainInfo,
  gainUri,
  hardwareFrames,
  makeClient,
  setupFakes,
} from './helpers';

setupFakes();

const gainFrame = (instance: string) => `add ${instance} ${gainUri} 10.0 20.0 0 1.0.0.0 0`;
const routes = (extra: Record<string, unknown> = {}) => ({ 'POST /effect/bulk/': { [gainUri]: gainInfo }, ...extra });
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

/** Records the state events of a client: `[state, reason]` pairs. */
function watch(client: ModUiClient) {
  const events: StateEvent[] = [];
  client.on('state', (event) => events.push(event));
  return {
    events,
    pairs: () => events.map((e) => [e.state, e.reason] as const),
    states: () => events.map((e) => e.state),
  };
}

let thrown: unknown[];
const realQueueMicrotask = globalThis.queueMicrotask;
beforeEach(() => {
  vi.useFakeTimers();
  thrown = [];
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
  vi.restoreAllMocks();
});

describe('client.state', () => {
  it('goes idle -> connecting -> open, and tells the previous state', async () => {
    const { client } = makeClient(routes());
    const seen = watch(client);
    expect(client.state).toBe('idle');

    const connecting = client.connect();
    expect(client.state).toBe('connecting');
    latest().replay();
    await connecting;

    expect(client.state).toBe('open');
    expect(seen.events).toEqual([
      { state: 'connecting', previous: 'idle' },
      { state: 'open', previous: 'connecting' },
    ]);
  });

  it('closed with reason "timeout" when the backend does not answer, and connect() tries again', async () => {
    const { client } = makeClient(routes(), { connectTimeoutMs: 1000 });
    const seen = watch(client);

    const connecting = client.connect();
    const failed = expect(connecting).rejects.toThrow(ModUiTimeoutError);
    latest().open(); // open, but the state replay never ends
    await tick(1000);
    await failed;

    expect(client.state).toBe('closed');
    expect(seen.events[1]).toMatchObject({ state: 'closed', previous: 'connecting', reason: 'timeout' });
    expect(seen.events[1].error).toBeInstanceOf(ModUiTimeoutError);

    const again = client.connect();
    latest().replay();
    await again;
    expect(client.state).toBe('open');
  });

  it('closed with reason "closed" when the socket closes before it is in sync', async () => {
    const { client } = makeClient(routes());
    const seen = watch(client);
    const connecting = client.connect();
    const failed = expect(connecting).rejects.toThrow(ModUiError);
    latest().open();
    latest().close();
    await failed;
    expect(seen.pairs()).toEqual([
      ['connecting', undefined],
      ['closed', 'closed'],
    ]);
  });

  it('a lost connection is "closed" (reason "closed") when reconnect is off, and the pending waits fail', async () => {
    const { client } = makeClient(routes());
    const first = await connected(client);
    const seen = watch(client);
    const waiting = client.events.waitFor('never', 60000);
    const failed = expect(waiting.promise).rejects.toThrow('WebSocket closed');

    first.close();
    await failed;

    expect(seen.pairs()).toEqual([['closed', 'closed']]);
    expect(client.events.connected).toBe(false);
    await tick(60000);
    expect(FakeWebSocket.instances).toHaveLength(1); // nothing tries again
  });

  it('the "stop" frame gives the reason "backend-stopped" to the close that follows it', async () => {
    const { client } = makeClient(routes());
    const first = await connected(client);
    const seen = watch(client);

    first.emit('stop');
    first.close();

    expect(seen.pairs()).toEqual([['closed', 'backend-stopped']]);
    // the next loss is a plain one again
    const again = client.connect();
    latest().replay();
    await again;
    latest().close();
    expect(seen.pairs().slice(-1)).toEqual([['closed', 'closed']]);
  });

  it('close() makes the state "closed" with reason "manual", and connect() opens it again', async () => {
    const { client } = makeClient(routes());
    await connected(client);
    const seen = watch(client);

    client.close();
    client.close(); // twice: one event only
    expect(seen.pairs()).toEqual([['closed', 'manual']]);

    const again = client.connect();
    latest().replay();
    await again;
    expect(seen.states()).toEqual(['closed', 'connecting', 'open']);
  });

  it('a socket that is shared and closes leaves the client "closed", even with reconnect on', async () => {
    const shared = new FakeWebSocket();
    shared.open();
    const { client } = makeClient(routes(), { webSocket: shared, reconnect: true });
    await client.connect();
    const seen = watch(client);

    shared.close();
    await tick(60000);

    expect(seen.pairs()).toEqual([['closed', 'closed']]);
    expect(FakeWebSocket.instances).toEqual([shared]); // the client never opens another one
  });

  it('client.once() and the unsubscribe function work like every on()', async () => {
    const { client } = makeClient(routes());
    const once = vi.fn();
    const off = vi.fn();
    client.once('state', once);
    const unsubscribe = client.on('state', off);
    unsubscribe();
    const connecting = client.connect();
    latest().replay();
    await connecting;
    expect(once).toHaveBeenCalledTimes(1);
    expect(off).not.toHaveBeenCalled();
  });
});

describe('reconnect', () => {
  const policy = { minDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: 0 };

  it('reconnects after the delay, opens a new socket, and goes back to "open"', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const first = await connected(client);
    const seen = watch(client);

    first.close();
    expect(client.state).toBe('reconnecting');
    await tick(99);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await tick(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    latest().replay();
    await tick();
    expect(client.state).toBe('open');
    expect(client.events.connected).toBe(true);
    expect(seen.pairs()).toEqual([
      ['reconnecting', 'closed'],
      ['open', undefined],
    ]);
  });

  it('keeps the reason of the loss ("backend-stopped") on the "reconnecting" state', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const first = await connected(client);
    const seen = watch(client);
    first.emit('stop');
    first.close();
    expect(seen.pairs()).toEqual([['reconnecting', 'backend-stopped']]);
  });

  it('waits longer after each failed attempt (min * factor^n), up to the maximum, and starts over after a success', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const first = await connected(client);
    first.close();

    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const before = FakeWebSocket.instances.length;
      let waited = 0;
      while (FakeWebSocket.instances.length === before) {
        await tick(1);
        waited++;
        expect(waited).toBeLessThan(5000);
      }
      delays.push(waited);
      latest().open();
      latest().close(); // this attempt fails
    }
    expect(delays).toEqual([100, 200, 400, 800, 1000, 1000]);
    expect(client.state).toBe('reconnecting');

    // a success resets the sequence
    await tick(1000);
    latest().replay();
    await tick();
    expect(client.state).toBe('open');
    latest().close();
    const before = FakeWebSocket.instances.length;
    await tick(100);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('randomises the wait by +-jitter', async () => {
    const random = vi.spyOn(Math, 'random');
    const { client } = makeClient(routes(), { reconnect: { minDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: 0.5 } });
    const first = await connected(client);

    random.mockReturnValue(0); // the shortest wait: 100 * (1 - 0.5)
    first.close();
    await tick(49);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await tick(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    random.mockReturnValue(1); // the longest wait: 200 * (1 + 0.5)
    latest().open();
    latest().close();
    await tick(299);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await tick(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('reconnect: true uses the defaults (500 ms first)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter
    const { client } = makeClient(routes(), { reconnect: true });
    const first = await connected(client);
    first.close();
    await tick(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await tick(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('close() cancels the retries; the state is "closed" (manual)', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const first = await connected(client);
    const seen = watch(client);
    first.close();

    client.close();
    await tick(10000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(seen.pairs()).toEqual([
      ['reconnecting', 'closed'],
      ['closed', 'manual'],
    ]);
  });

  it('connect() while reconnecting waits for the connection and resolves when it is back', async () => {
    const { client } = makeClient(routes(), {
      reconnect: { minDelayMs: 500, maxDelayMs: 500, factor: 1, jitter: 0 },
      connectTimeoutMs: 1000,
    });
    const first = await connected(client);
    first.close();

    const joined = client.connect();
    await tick(500);
    latest().replay();
    await expect(joined).resolves.toBeUndefined();
    expect(client.state).toBe('open');
  });

  it('connect() while reconnecting fails after connectTimeoutMs, and the attempts go on', async () => {
    const { client } = makeClient(routes(), {
      reconnect: { minDelayMs: 5000, maxDelayMs: 5000, factor: 1, jitter: 0 },
      connectTimeoutMs: 1000,
    });
    const first = await connected(client);
    first.close();

    const waiting = client.connect();
    const timedOut = expect(waiting).rejects.toThrow(ModUiTimeoutError);
    await tick(1000);
    await timedOut;
    expect(client.state).toBe('reconnecting');
    await tick(4000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('close() fails a connect() that is waiting for the reconnection', async () => {
    const { client } = makeClient(routes(), { reconnect: { minDelayMs: 5000, jitter: 0 }, connectTimeoutMs: 60000 });
    const first = await connected(client);
    first.close();

    const waiting = client.connect();
    const cancelled = expect(waiting).rejects.toThrow('Client closed');
    client.close();
    await cancelled;
    expect(client.state).toBe('closed');
  });

  it('keeps the raw subscriptions: events.on() handlers hear the new socket', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const first = await connected(client);
    const stats = vi.fn();
    client.events.on('stats', stats);

    first.close();
    await tick(100);
    latest().replay();
    await tick();
    latest().emit('stats 12.5 3');

    expect(stats).toHaveBeenCalledWith('12.5 3', 'stats');
  });

  it('a call made while reconnecting waits and gives the state of the new connection', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const socket = await connectedWith(client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    const board = client.device.currentPedalboard;
    expect((await board.plugins.list()).map((i) => i.instance)).toEqual(['/graph/Gain']);

    socket.close();
    const listing = board.plugins.list(); // asks while the connection is down
    await tick(100);
    const next = latest();
    next.open();
    next.emit('loading_start 0 0');
    next.emit('loading_end 0'); // the pedalboard is empty now
    const instances = await listing;

    expect(instances).toEqual([]);
  });
});

describe('the state after a reconnection', () => {
  const policy = { minDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: 0 };

  it('forgets what disappeared: plugins, pedalboard ports and connections; one "loading" and one "loaded"', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const board = client.device.currentPedalboard;
    const first = await connectedWith(client, [
      ...hardwareFrames,
      gainFrame('/graph/Gain'),
      'connect /graph/capture_1 /graph/Gain/in',
    ]);
    const [gain] = await board.plugins.list();
    const paramEvents = vi.fn();
    gain.params.get('gain')!.on('change', paramEvents);
    const removed = vi.fn();
    gain.on('removed', removed);
    const log: string[] = [];
    board.on('loading', () => log.push('loading'));
    board.on('loaded', () => log.push('loaded'));
    board.on('plugin:added', () => log.push('plugin:added'));

    first.close();
    await tick(100);
    // the device came back with other ports and a plugin of the same path
    const next = latest();
    next.open();
    next.emit('add_hw_port /graph/capture_1 audio 0 Capture_1 1');
    next.emit('loading_start 0 0');
    next.emit(gainFrame('/graph/Gain'));
    next.emit('loading_end 0');
    await tick();

    expect(log).toEqual(['loading', 'loaded']);
    expect(gain.alive).toBe(false);
    expect(removed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reloaded' }));
    const [again] = await board.plugins.list();
    expect(again).not.toBe(gain);
    expect((await board.ports.list()).map((port) => port.id)).toEqual(['/graph/capture_1']); // capture_2 and the others are gone
    expect(await board.connections.list()).toEqual([]);

    next.emit('param_set /graph/Gain gain 5.0');
    expect(paramEvents).not.toHaveBeenCalled(); // the subscription ended with the old plugin
    expect(again.params.get('gain')!.value).toBe(5);
  });

  it('delivers "loaded" again after every reconnection', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const board = client.device.currentPedalboard;
    const first = await connectedWith(client, [gainFrame('/graph/Gain')]);
    await board.plugins.list();
    const loaded = vi.fn();
    board.on('loaded', loaded);

    let socket: FakeWebSocket = first;
    for (let round = 1; round <= 2; round++) {
      socket.close();
      await tick(1000);
      socket = latest();
      socket.replay();
      await tick();
      expect(loaded).toHaveBeenCalledTimes(round);
    }
  });
});

describe('races and edge cases of the connection', () => {
  const policy = { minDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: 0 };

  it('close() followed by connect() at once: the old attempt cannot disturb the new one', async () => {
    const { client } = makeClient(routes());
    const seen = watch(client);

    const first = client.connect();
    const abandoned = expect(first).rejects.toThrow('Client closed');
    latest().open(); // the first socket is open but its replay never came
    client.close();
    const second = client.connect(); // a React effect that is cleaned up and run again
    const socket = latest();
    expect(FakeWebSocket.instances).toHaveLength(2);
    await abandoned; // the rejection of the old attempt is handled now (a microtask later)

    socket.replay();
    await second;

    expect(client.state).toBe('open');
    expect(client.events.connected).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2); // nothing opened a third socket
    const stats = vi.fn();
    client.events.on('stats', stats);
    socket.emit('stats 9.0 1');
    expect(stats).toHaveBeenCalled(); // the listeners of the new socket were not taken away
    expect(seen.pairs()).toEqual([
      ['connecting', undefined],
      ['closed', 'manual'],
      ['connecting', undefined],
      ['open', undefined],
    ]);
  });

  it('a state handler that closes the client when it starts reconnecting stops the reconnection', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const first = await connected(client);
    client.on('state', ({ state }) => {
      if (state === 'reconnecting') client.close();
    });

    first.close();
    await tick(10000);

    expect(client.state).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('an option that is undefined or invalid falls back to its default (no NaN delay, no tight loop)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { client } = makeClient(routes(), {
      reconnect: { minDelayMs: undefined, maxDelayMs: undefined, factor: NaN, jitter: undefined },
    });
    const first = await connected(client);
    first.close();
    await tick(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await tick(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    latest().open();
    latest().close(); // the second attempt waits 500 * 2 (the default factor)
    await tick(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await tick(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('a failed attempt does not touch what the application shows: the state is replaced when the replay starts', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const board = client.device.currentPedalboard;
    const first = await connectedWith(client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    const [gain] = await board.plugins.list();
    await tick();
    const loading = vi.fn();
    board.on('loading', loading);

    first.close();
    await tick(100);
    latest().open(); // the backend accepted the socket but sent nothing
    latest().close();
    await tick();

    expect(gain.alive).toBe(true);
    expect(board.getSnapshot()).toMatchObject({ ready: true, loading: false });
    expect(board.getSnapshot().plugins).toHaveLength(1);
    expect(board.getSnapshot().ports).toHaveLength(6); // (list() would wait for the reconnection: read the snapshot)
    expect(loading).not.toHaveBeenCalled();

    await tick(200);
    latest().open();
    latest().emit('stats 1.0 0'); // the replay begins
    expect(gain.alive).toBe(false);
    expect(board.getSnapshot()).toMatchObject({ ready: false, loading: true, plugins: [] });
  });

  it('"loading" carries the values of the loading_start frame of the replay', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const board = client.device.currentPedalboard;
    const first = await connectedWith(client, [gainFrame('/graph/Gain')]);
    await board.plugins.list();
    await tick();
    const events: unknown[] = [];
    board.on('loading', (e) => events.push([e.empty, e.modified]));
    board.on('loaded', () => events.push('loaded'));

    first.close();
    await tick(100);
    const next = latest();
    next.open();
    next.emit('stats 1.0 0');
    next.emit('loading_start 1 1');
    next.emit('loading_end 0');
    await tick();

    expect(events).toEqual([[true, true], 'loaded']);
  });

  it('a replay without loading_start still delivers "loading" before "loaded"', async () => {
    const { client } = makeClient(routes(), { reconnect: policy });
    const board = client.device.currentPedalboard;
    const first = await connectedWith(client, [gainFrame('/graph/Gain')]);
    await board.plugins.list();
    await tick();
    const events: string[] = [];
    board.on('loading', () => events.push('loading'));
    board.on('loaded', () => events.push('loaded'));

    first.close();
    await tick(100);
    latest().open();
    latest().emit('stats 1.0 0');
    latest().emit('loading_end 0');
    await tick();

    expect(events).toEqual(['loading', 'loaded']);
  });
});

describe('client.on("error")', () => {
  it('forwards the failures of the background requests (the same as currentPedalboard.on("error"))', async () => {
    const { client } = makeClient({ 'POST /effect/bulk/': () => new Response('nope', { status: 500 }) });
    const forwarded = vi.fn();
    const direct = vi.fn();
    client.on('error', forwarded);
    client.device.currentPedalboard.on('error', direct);

    await connectedWith(client, [gainFrame('/graph/Gain')]);
    await client.device.currentPedalboard.plugins.list();

    expect(forwarded).toHaveBeenCalled();
    expect(forwarded.mock.calls[0][0]).toMatchObject({ context: 'plugin-description' });
    expect(direct).toHaveBeenCalledTimes(forwarded.mock.calls.length);
    expect(thrown).toEqual([]);
  });
});
