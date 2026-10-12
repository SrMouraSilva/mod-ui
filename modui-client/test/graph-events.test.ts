// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModUiError, ModUiTimeoutError, PluginInstance, type CurrentPedalboard, type PedalboardEvents } from '../src';
import {
  FakeWebSocket,
  connected,
  connectedWith,
  flush,
  gainInfo,
  gainUri,
  hardwareFrames,
  makeClient,
  midiInfo,
  midiUri,
  patchInfo,
  patchUri,
  labelUri,
  pluginSummaries,
  setupFakes,
  summaries,
} from './helpers';

setupFakes();

// Errors of handlers are rethrown from a microtask: collect them instead of failing the run.
let thrown: unknown[];
const realQueueMicrotask = globalThis.queueMicrotask;
beforeEach(() => {
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
});

const known: Record<string, unknown> = { [gainUri]: gainInfo, [midiUri]: midiInfo, [patchUri]: patchInfo };
/** Answers `POST /effect/bulk/` with the descriptions of the requested URIs that exist. */
const bulk = (call: { body?: string }) => {
  const answer: Record<string, unknown> = {};
  for (const uri of JSON.parse(call.body!) as string[]) {
    if (uri in known) answer[uri] = known[uri];
  }
  return answer;
};

function routes(extra: Record<string, unknown> = {}) {
  return { 'GET /effect/list': pluginSummaries, 'POST /effect/bulk/': bulk, ...extra };
}

const gainFrame = (instance: string, x = 10, y = 20) => `add ${instance} ${gainUri} ${x}.0 ${y}.0 0 1.0.0.0 0`;
const midiFrame = (instance: string) => `add ${instance} ${midiUri} 5.0 6.0 0 1.0.0.0 0`;

/** A device with the hardware ports and a Gain plugin wired capture_1 → Gain → playback_1, already in sync. */
async function wired(extra: Record<string, unknown> = {}) {
  const made = makeClient(routes(extra));
  const socket = await connectedWith(made.client, [
    ...hardwareFrames,
    gainFrame('/graph/Gain'),
    'connect /graph/capture_1 /graph/Gain/in',
    'connect /graph/Gain/out /graph/playback_1',
  ]);
  const current = made.client.device.currentPedalboard;
  const [gain] = await current.plugins.list();
  return { ...made, socket, current, gain };
}

type Entry = [keyof PedalboardEvents, any];

/** Records the events of the pedalboard, in order. */
function record(current: CurrentPedalboard, names?: Array<keyof PedalboardEvents>): Entry[] {
  const log: Entry[] = [];
  const all: Array<keyof PedalboardEvents> = names ?? [
    'plugin:added',
    'plugin:removed',
    'connection:added',
    'connection:removed',
    'port:added',
    'port:removed',
    'loading',
    'loaded',
    'cleared',
    'error',
  ];
  for (const name of all) {
    current.on(name, (event: any) => {
      log.push([name, event]);
    });
  }
  return log;
}
const names = (log: Entry[]) => log.map(([name]) => name);

describe('loading bracket', () => {
  it('delivers only "loading" and "loaded" for the first replay, however many frames it has', async () => {
    const { client } = makeClient(routes());
    const log = record(client.device.currentPedalboard);
    await connectedWith(client, [
      ...hardwareFrames,
      gainFrame('/graph/Gain'),
      'connect /graph/capture_1 /graph/Gain/in',
      'param_set /graph/Gain gain 3.0',
      'patch_set /graph/Gain 1 x s y',
    ]);
    await client.device.currentPedalboard.plugins.list();

    expect(names(log)).toEqual(['loading', 'loaded']);
    expect(log[0][1]).toMatchObject({ empty: false, modified: false, origin: 'remote' });
    expect(log[1][1]).toMatchObject({ snapshotId: 0, origin: 'remote' });
  });

  it('delivers "loaded" only after every plugin description is in, so the plugins are complete', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client } = makeClient(routes({ 'POST /effect/bulk/': async (call: { body?: string }) => (await gate, bulk(call)) }));
    const current = client.device.currentPedalboard;
    const log = record(current);
    await connectedWith(client, [gainFrame('/graph/Gain')]);
    await flush();
    expect(names(log)).toEqual(['loading']); // the description is still being read

    release();
    await flush();
    expect(names(log)).toEqual(['loading', 'loaded']);
    const [gain] = await current.plugins.list();
    expect(gain.info).not.toBeNull();
  });

  it('replaces the plugins at a reload: one "loading", one "loaded", the old objects are gone and no granular event', async () => {
    const { socket, current, gain } = await wired();
    const log = record(current);
    const removed = vi.fn();
    gain.on('removed', removed);

    socket.emit('loading_start 0 1');
    socket.emit(gainFrame('/graph/Gain'));
    socket.emit(midiFrame('/graph/Midi'));
    socket.emit('connect /graph/Gain/out /graph/playback_1');
    socket.emit('param_set /graph/Gain gain 6.0');
    socket.emit('plugin_pos /graph/Gain 1 2');
    socket.emit('add_hw_port /graph/capture_3 audio 0 Capture_3 3');
    socket.emit('loading_end 4');
    await flush();

    expect(names(log)).toEqual(['loading', 'loaded']);
    expect(log[0][1]).toMatchObject({ empty: false, modified: true });
    expect(log[1][1]).toMatchObject({ snapshotId: 4 });
    expect(gain.alive).toBe(false);
    expect(removed).toHaveBeenCalledWith(expect.objectContaining({ plugin: gain, reason: 'reloaded' }));
    const instances = await current.plugins.list();
    expect(instances.map((i) => i.instance)).toEqual(['/graph/Gain', '/graph/Midi']);
    expect(instances[0]).not.toBe(gain);
    expect(instances[0].params.get('gain')!.value).toBe(6);
    expect(instances[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('"remove :all" delivers "cleared" alone (no removal per plugin) and ends the plugins', async () => {
    const { socket, current, gain } = await wired();
    const log = record(current);
    const removed = vi.fn();
    gain.on('removed', removed);

    socket.emit('remove :all');

    expect(names(log)).toEqual(['cleared']);
    expect(gain.alive).toBe(false);
    expect(removed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cleared' }));
    expect(await current.plugins.list()).toEqual([]);
  });
});

describe('plugins appearing and disappearing', () => {
  it('"plugin:added" carries the complete, stable PluginInstance, at once when the description is known', async () => {
    const { socket, current, calls } = await wired();
    const log = record(current);
    const bulkCalls = () => calls.filter((c) => new URL(c.url).pathname === '/effect/bulk/').length;
    const before = bulkCalls();

    socket.emit(gainFrame('/graph/Gain_1', 30, 40));

    expect(names(log)).toEqual(['plugin:added']); // synchronous: nothing was awaited
    const { plugin, origin, source } = log[0][1];
    expect(plugin).toBeInstanceOf(PluginInstance);
    expect(plugin).toMatchObject({ instance: '/graph/Gain_1', uri: gainUri, x: 30, y: 40, alive: true });
    expect(plugin.params.get('gain')).toBeDefined(); // complete
    expect([origin, source]).toEqual(['remote', undefined]);
    expect(bulkCalls()).toBe(before);
    expect((await current.plugins.list())[1]).toBe(plugin);
    expect(await current.plugins.get('/graph/Gain_1')).toBe(plugin);
    expect(await current.plugins.get('graph/Gain_1')).toBe(plugin); // the leading slash is optional
    expect(await current.plugins.get('/graph/Nope')).toBeUndefined();
  });

  it('reads an unknown description with one request, and delivers the events in the order of the frames', async () => {
    const { socket, current, calls } = await wired();
    const log = record(current);
    current.on('plugin:added', ({ plugin }) => {
      plugin.on('moved', ({ x, y }) => log.push(['plugin:added', { moved: [x, y] }]));
    });
    const bulkBefore = calls.filter((c) => new URL(c.url).pathname === '/effect/bulk/').length;

    socket.emit(midiFrame('/graph/Midi')); // its description is not known: the request takes a moment
    socket.emit('plugin_pos /graph/Midi 7 8');
    socket.emit('connect /graph/Gain/out /graph/Midi/midi_in');
    expect(log).toEqual([]); // nothing is delivered out of order while the description is read

    await flush();
    expect(log.map(([, event]) => event.plugin?.instance ?? event.moved ?? [event.from, event.to])).toEqual([
      '/graph/Midi',
      [7, 8],
      ['/graph/Gain/out', '/graph/Midi/midi_in'],
    ]);
    expect(calls.filter((c) => new URL(c.url).pathname === '/effect/bulk/').length).toBe(bulkBefore + 1);
    expect(log[0][1].plugin.info).not.toBeNull();
  });

  it('"plugin:removed" arrives with plugin.alive already false, and the plugin keeps its last state', async () => {
    const { socket, current, gain } = await wired();
    socket.emit('param_set /graph/Gain gain 5.0');
    const log = record(current);
    const alive: boolean[] = [];
    current.on('plugin:removed', ({ plugin }) => alive.push(plugin.alive));

    socket.emit('remove /graph/Gain');

    // the backend sends "disconnect" first; without it the connections of the plugin are dropped before the removal
    expect(names(log)).toEqual(['connection:removed', 'connection:removed', 'plugin:removed']);
    expect(log[2][1]).toMatchObject({ plugin: gain, reason: 'removed', origin: 'remote' });
    expect(alive).toEqual([false]);
    expect(gain.alive).toBe(false);
    expect(gain.params.get('gain')!.value).toBe(5);
    await expect(gain.setActive(false)).rejects.toThrow(ModUiError);
    await expect(gain.params.get('gain')!.setValue(1)).rejects.toThrow(/no plugin "\/graph\/Gain"/);
  });

  it('a plugin that appears and is removed before its description arrives is never announced', async () => {
    const { socket, current } = await wired();
    const log = record(current);
    socket.emit(midiFrame('/graph/Midi'));
    socket.emit('remove /graph/Midi');
    await flush();
    expect(names(log)).toEqual([]);
  });

  it('reports a failed description request as an "error" event and fills the plugin in when the request works again', async () => {
    let working = false;
    const { client } = makeClient(
      routes({
        'POST /effect/bulk/': (call: { body?: string }) => (working ? bulk(call) : new Response('nope', { status: 500 })),
      }),
    );
    const current = client.device.currentPedalboard;
    const log = record(current);
    await connectedWith(client, [gainFrame('/graph/Gain')]);
    const [gain] = await current.plugins.list();

    expect(gain.info).toBeNull();
    // the load failed to read the description; list() tried again (and failed again)
    expect(names(log)).toEqual(['loading', 'error', 'loaded', 'error']);
    expect(log[1][1]).toMatchObject({ context: 'plugin-description' });
    expect(log[1][1].error).toBeInstanceOf(Error);
    expect(gain.params.list()).toEqual([]);

    working = true;
    const [again] = await current.plugins.list();
    expect(again).toBe(gain); // the same object, now complete
    expect(gain.info).not.toBeNull();
    expect(gain.params.get('gain')).toBeDefined();
    expect(gain.ports.audio.input.map((p) => p.id)).toEqual(['/graph/Gain/in']);
  });
});

describe('plugin events', () => {
  it('"param": the Param, the value and the previous one (the default when none was known); a repeated value is not an event', async () => {
    const { socket, gain } = await wired();
    const events: any[] = [];
    const changes: any[] = [];
    gain.on('param', (event) => events.push(event));
    const param = gain.params.get('gain')!;
    param.on('change', (event) => changes.push(event));

    socket.emit('param_set /graph/Gain gain 6.5');
    socket.emit('param_set /graph/Gain gain 6.5'); // same value
    socket.emit('param_set /graph/Gain gain -3.0');
    socket.emit('param_set /graph/Gain enabled 0.0'); // another control: not for param.on

    expect(events.map((e) => [e.param.symbol, e.value, e.previous, e.origin])).toEqual([
      ['gain', 6.5, 0, 'remote'],
      ['gain', -3, 6.5, 'remote'],
      ['enabled', 0, 1, 'remote'],
    ]);
    expect(events[0]).toMatchObject({ plugin: gain, param });
    expect(changes.map((e) => e.value)).toEqual([6.5, -3]);
    expect(param.value).toBe(-3); // the handler sees the new state
  });

  it('a handler reads the new state: the value is already in the Param', async () => {
    const { socket, gain } = await wired();
    const seen: number[] = [];
    const param = gain.params.get('gain')!;
    param.on('change', () => seen.push(param.value));
    socket.emit('param_set /graph/Gain gain 2.0');
    socket.emit('param_set /graph/Gain gain 4.0');
    expect(seen).toEqual([2, 4]);
  });

  it('a knob drag is only memory: no request for any of its frames', async () => {
    const { socket, gain, calls } = await wired();
    const before = calls.length;
    const values: number[] = [];
    gain.params.get('gain')!.on('change', ({ value }) => values.push(value));

    for (let i = 0; i < 200; i++) socket.emit(`param_set /graph/Gain gain ${i - 90}.5`);

    expect(values).toHaveLength(200);
    expect(calls).toHaveLength(before);
  });

  it('"active" follows the bypass frame; "moved" follows plugin_pos; repeated states are not events', async () => {
    const { socket, gain } = await wired();
    const active: boolean[] = [];
    const moved: Array<[number, number]> = [];
    gain.on('active', ({ active: value }) => active.push(value));
    gain.on('moved', ({ x, y }) => moved.push([x, y]));

    socket.emit('param_set /graph/Gain :bypass 1.000000');
    socket.emit('param_set /graph/Gain :bypass 1.000000');
    socket.emit('param_set /graph/Gain :bypass 0.000000');
    socket.emit('plugin_pos /graph/Gain 100 200');
    socket.emit('plugin_pos /graph/Gain 100 200');

    expect(active).toEqual([false, true]);
    expect(moved).toEqual([[100, 200]]);
  });

  it('"patch" and PatchParam "change" follow patch_set, with the parsed value', async () => {
    const { client, socket } = await (async () => {
      const made = makeClient(routes());
      const socket = await connectedWith(made.client, [`add /graph/Patcher ${patchUri} 1.0 2.0 0 1.0.0.0 0`]);
      return { ...made, socket };
    })();
    const [patcher] = await client.device.currentPedalboard.plugins.list();
    const label = patcher.patchParams.get(labelUri)!;
    const onPlugin: any[] = [];
    const onParam: any[] = [];
    patcher.on('patch', (event) => onPlugin.push(event));
    label.on('change', (event) => onParam.push(event));

    socket.emit(`patch_set /graph/Patcher 1 ${labelUri} s Verse 2`);
    socket.emit(`patch_set /graph/Patcher 1 ${labelUri} s Verse 2`); // same value
    socket.emit('patch_set /graph/Patcher 1 http://x.org/unknown s whatever'); // a parameter the client does not handle

    expect(onParam.map((e) => [e.value, e.param])).toEqual([['Verse 2', label]]);
    expect(onPlugin.map((e) => [e.uri, e.value, e.param])).toEqual([
      [labelUri, 'Verse 2', label],
      ['http://x.org/unknown', undefined, undefined],
    ]);
  });

  it('subscriptions end by themselves after "removed"; subscribing to a gone plugin does nothing', async () => {
    const { socket, gain } = await wired();
    const handler = vi.fn();
    gain.on('param', handler);
    gain.params.get('gain')!.on('change', handler);
    const order: string[] = [];
    gain.on('removed', () => order.push('removed'));

    socket.emit('remove /graph/Gain');
    expect(order).toEqual(['removed']);
    socket.emit(gainFrame('/graph/Gain')); // the path is used again: that is a new object
    socket.emit('param_set /graph/Gain gain 9.0');
    expect(handler).not.toHaveBeenCalled();

    const late = vi.fn();
    gain.on('param', late);
    gain.on('removed', late);
    expect(late).not.toHaveBeenCalled();
  });

  it('once() delivers a single event', async () => {
    const { socket, gain } = await wired();
    const handler = vi.fn();
    gain.once('param', handler);
    socket.emit('param_set /graph/Gain gain 1.0');
    socket.emit('param_set /graph/Gain gain 2.0');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('connections and ports', () => {
  it('"connection:added" / "connection:removed" carry the port ids; a repeated frame is not an event', async () => {
    const { socket, current } = await wired();
    const log = record(current);

    socket.emit('connect /graph/capture_2 /graph/Gain/in');
    socket.emit('connect /graph/capture_2 /graph/Gain/in');
    socket.emit('disconnect /graph/capture_2 /graph/Gain/in');
    socket.emit('disconnect /graph/capture_2 /graph/Gain/in');

    expect(log.map(([name, e]) => [name, e.from, e.to, e.origin])).toEqual([
      ['connection:added', '/graph/capture_2', '/graph/Gain/in', 'remote'],
      ['connection:removed', '/graph/capture_2', '/graph/Gain/in', 'remote'],
    ]);
  });

  it('"port:added" / "port:removed" describe the ports of the pedalboard itself', async () => {
    const { socket, current } = await wired();
    const log = record(current);

    socket.emit('add_hw_port /graph/capture_3 audio 0 Capture_3 3');
    socket.emit('add_hw_port /graph/capture_3 audio 0 Capture_3 3'); // identical: nothing changed
    socket.emit('remove_hw_port /graph/capture_3');

    expect(log.map(([name]) => name)).toEqual(['port:added', 'port:removed']);
    expect(log[0][1]).toMatchObject({ id: '/graph/capture_3', type: 'audio', direction: 'output', title: 'Capture_3', index: 3 });
    expect(log[1][1]).toMatchObject({ id: '/graph/capture_3' });
  });
});

describe('stable objects', () => {
  it('list(), get(), ports, params and connections are the same objects on every call', async () => {
    const { current, gain } = await wired();
    const [again] = await current.plugins.list();
    expect(again).toBe(gain);
    expect(again.params.get('gain')).toBe(gain.params.get('gain'));
    expect(again.ports.audio.input[0]).toBe(gain.ports.audio.input[0]);
    expect(await current.connections.list()).toEqual(await current.connections.list());
    const first = await current.connections.list();
    const second = await current.connections.list();
    first.forEach((connection, i) => expect(connection).toBe(second[i]));
    const portsA = await current.ports.list();
    const portsB = await current.ports.list();
    portsA.forEach((port, i) => expect(port).toBe(portsB[i]));
  });

  it('a plugin removed and added again under the same path is a new object', async () => {
    const { socket, current, gain } = await wired();
    socket.emit('remove /graph/Gain');
    socket.emit(gainFrame('/graph/Gain'));
    const [again] = await current.plugins.list();
    expect(again).not.toBe(gain);
    expect(gain.alive).toBe(false);
    expect(again.alive).toBe(true);
  });
});

describe('changes made through the client', () => {
  it('setValue(): a local "param" event with the source, after the frame is sent; the others are not told twice', async () => {
    const { socket, gain } = await wired();
    const source = Symbol('slider');
    const events: any[] = [];
    gain.params.get('gain')!.on('change', (event) => events.push(event));

    await gain.params.get('gain')!.setValue(3.5, { source });

    expect(socket.sent).toContain('param_set /graph/Gain/gain 3.5');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value: 3.5, previous: 0, origin: 'local', source });
  });

  it('ignoreSource skips the changes of that source only; ignoreLocal skips every local one', async () => {
    const { socket, gain } = await wired();
    const slider = Symbol('slider');
    const canvas = Symbol('canvas');
    const param = gain.params.get('gain')!;
    const all: number[] = [];
    const notSlider: number[] = [];
    const notLocal: number[] = [];
    param.on('change', ({ value }) => all.push(value));
    param.on('change', ({ value }) => notSlider.push(value), { ignoreSource: slider });
    param.on('change', ({ value }) => notLocal.push(value), { ignoreLocal: true });

    await param.setValue(1, { source: slider });
    await param.setValue(2, { source: canvas });
    socket.emit('param_set /graph/Gain gain 3.0');

    expect(all).toEqual([1, 2, 3]);
    expect(notSlider).toEqual([2, 3]);
    expect(notLocal).toEqual([3]);
  });

  it('a remote change that arrives while a local write waits in the queue is still delivered', async () => {
    const { socket, gain } = await wired();
    const seen: Array<[number, string]> = [];
    gain.params.get('gain')!.on('change', ({ value, origin }) => seen.push([value, origin]));

    const writing = gain.params.get('gain')!.setValue(7, { source: 'me' });
    socket.emit('param_set /graph/Gain gain 5.0'); // another client, before our write runs
    await writing;

    expect(seen).toEqual([[5, 'remote'], [7, 'local']]);
  });

  it('setActive(), toggle() and setPosition() emit local "active" and "moved" events', async () => {
    const { gain } = await wired();
    const events: any[] = [];
    gain.on('active', (e) => events.push(['active', e.active, e.origin, e.source]));
    gain.on('moved', (e) => events.push(['moved', e.x, e.y, e.origin, e.source]));

    await gain.setActive(false, { source: 1 });
    await gain.setActive(false, { source: 2 }); // nothing changed
    await gain.toggle({ source: 3 });
    await gain.setPosition({ x: 11, y: 12 }, { source: 4 });

    expect(events).toEqual([
      ['active', false, 'local', 1],
      ['active', true, 'local', 3],
      ['moved', 11, 12, 'local', 4],
    ]);
  });

  it('PatchParam.setValue() emits a local change', async () => {
    const made = makeClient(routes());
    await connectedWith(made.client, [`add /graph/Patcher ${patchUri} 1.0 2.0 0 1.0.0.0 0`]);
    const [patcher] = await made.client.device.currentPedalboard.plugins.list();
    const label = patcher.patchParams.get(labelUri)!;
    const events: any[] = [];
    label.on('change', (e) => events.push(e));

    await label.setValue('Chorus', { source: 'ui' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ value: 'Chorus', origin: 'local', source: 'ui' });
  });

  it('plugins.add(): the "plugin:added" event is local and carries the source; the description of the answer is used', async () => {
    const holder: { socket?: FakeWebSocket } = {};
    const { client, calls } = makeClient(
      routes({
        // like the real backend, the WebSocket frame comes before the HTTP answer
        'GET /effect/add//graph/Gain': () => {
          holder.socket!.emit(gainFrame('/graph/Gain', 200, 100));
          return gainInfo;
        },
      }),
    );
    holder.socket = await connectedWith(client, hardwareFrames);
    const current = client.device.currentPedalboard;
    const log = record(current, ['plugin:added']);
    const before = calls.filter((c) => new URL(c.url).pathname === '/effect/bulk/').length;

    const created = await current.plugins.add(gainUri, { x: 200, y: 100 }, { source: 'palette' });

    expect(log).toHaveLength(1);
    expect(log[0][1]).toMatchObject({ plugin: created, origin: 'local', source: 'palette' });
    expect(created.params.get('gain')).toBeDefined();
    expect(calls.filter((c) => new URL(c.url).pathname === '/effect/bulk/').length).toBe(before); // no second request
    expect(await current.plugins.get('/graph/Gain')).toBe(created);
  });

  it('plugins.remove(): the disconnections and the removal are local and carry the source', async () => {
    const holder: { socket?: FakeWebSocket } = {};
    const made = makeClient(
      routes({
        'GET /effect/remove//graph/Gain': () => {
          holder.socket!.emit('disconnect /graph/capture_1 /graph/Gain/in');
          holder.socket!.emit('disconnect /graph/Gain/out /graph/playback_1');
          holder.socket!.emit('remove /graph/Gain');
          return true;
        },
      }),
    );
    holder.socket = await connectedWith(made.client, [
      ...hardwareFrames,
      gainFrame('/graph/Gain'),
      'connect /graph/capture_1 /graph/Gain/in',
      'connect /graph/Gain/out /graph/playback_1',
    ]);
    const board = made.client.device.currentPedalboard;
    await board.plugins.list();
    const log = record(board);

    await board.plugins.remove('/graph/Gain', { source: 'trash' });

    expect(log.map(([name, e]) => [name, e.origin, e.source])).toEqual([
      ['connection:removed', 'local', 'trash'],
      ['connection:removed', 'local', 'trash'],
      ['plugin:removed', 'local', 'trash'],
    ]);
  });

  it('connections.connect() and disconnect() are local and carry the source', async () => {
    const holder: { socket?: FakeWebSocket } = {};
    const made = makeClient(
      routes({
        'GET /effect/connect//graph/capture_2,/graph/Gain/in': () => {
          holder.socket!.emit('connect /graph/capture_2 /graph/Gain/in');
          return true;
        },
        'GET /effect/disconnect//graph/capture_2,/graph/Gain/in': () => {
          holder.socket!.emit('disconnect /graph/capture_2 /graph/Gain/in');
          return true;
        },
      }),
    );
    holder.socket = await connectedWith(made.client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    const board = made.client.device.currentPedalboard;
    await board.plugins.list();
    const log = record(board);

    const connection = await board.connections.connect('/graph/capture_2', '/graph/Gain/in', { source: 'wire' });
    await board.connections.disconnect(connection, { source: 'cut' });

    expect(log.map(([name, e]) => [name, e.origin, e.source])).toEqual([
      ['connection:added', 'local', 'wire'],
      ['connection:removed', 'local', 'cut'],
    ]);
  });

  it('a change by someone else while a request is in flight is still "remote" once the request ended', async () => {
    const holder: { socket?: FakeWebSocket } = {};
    const made = makeClient(
      routes({
        'GET /effect/connect//graph/capture_2,/graph/Gain/in': () => {
          holder.socket!.emit('connect /graph/capture_2 /graph/Gain/in');
          return true;
        },
      }),
    );
    holder.socket = await connectedWith(made.client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    const board = made.client.device.currentPedalboard;
    await board.plugins.list();
    const log = record(board);
    await board.connections.connect('/graph/capture_2', '/graph/Gain/in', { source: 'wire' });

    holder.socket.emit('disconnect /graph/capture_2 /graph/Gain/in');
    expect(log.map(([name, e]) => [name, e.origin])).toEqual([
      ['connection:added', 'local'],
      ['connection:removed', 'remote'],
    ]);
  });
});

describe('device.load() and device.reset()', () => {
  const loadRoutes = (holder: { socket?: FakeWebSocket }) => ({
    ...routes(),
    'GET /pedalboard/list': summaries,
    'GET /reset': () => {
      holder.socket!.emit('remove :all');
      return true;
    },
    'POST /pedalboard/load_bundle/': () => {
      holder.socket!.emit('loading_start 0 0');
      holder.socket!.emit(gainFrame('/graph/Gain'));
      holder.socket!.emit('loading_end 3');
      return { ok: true, name: 'My Board' };
    },
  });

  it('load() is local with its source: "cleared", "loading" and "loaded"; the plugins are complete when it resolves', async () => {
    const holder: { socket?: FakeWebSocket } = {};
    const { client } = makeClient(loadRoutes(holder));
    holder.socket = await connected(client);
    const current = client.device.currentPedalboard;
    const log = record(current);

    await client.device.load('/b.pedalboard', { source: 'menu' });
    await current.plugins.list();

    expect(log.map(([name, e]) => [name, e.origin, e.source])).toEqual([
      ['cleared', 'local', 'menu'],
      ['loading', 'local', 'menu'],
      ['loaded', 'local', 'menu'],
    ]);
    expect((await current.plugins.list()).map((i) => i.instance)).toEqual(['/graph/Gain']);
  });

  it('reset() is local with its source, and a later "remove :all" is remote', async () => {
    const holder: { socket?: FakeWebSocket } = {};
    const { client } = makeClient(loadRoutes(holder));
    holder.socket = await connected(client);
    const log = record(client.device.currentPedalboard);

    await client.device.reset({ source: 'new' });
    holder.socket.emit('remove :all');

    expect(log.map(([name, e]) => [name, e.origin, e.source])).toEqual([
      ['cleared', 'local', 'new'],
      ['cleared', 'remote', undefined],
    ]);
  });
});

describe('a socket that is shared', () => {
  it('delivers "loading" and "loaded" when the snapshot is read, and includes the live frames that arrived meanwhile', async () => {
    const shared = new FakeWebSocket();
    shared.open();
    const { client } = makeClient(routes(), { webSocket: shared });
    const current = client.device.currentPedalboard;
    const log = record(current);
    const listing = current.plugins.list();
    await flush();

    const snapshot = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    snapshot.open();
    snapshot.emit('loading_start 0 0');
    snapshot.emit(gainFrame('/graph/Gain'));
    shared.emit(gainFrame('/graph/Gain_1')); // a live frame that arrives while the snapshot is read
    snapshot.emit('loading_end 0');

    const instances = await listing;
    expect(instances.map((i) => i.instance)).toEqual(['/graph/Gain', '/graph/Gain_1']);
    await flush();
    // the live frame that arrived meanwhile is already part of the pedalboard that "loaded" announces
    expect(names(log)).toEqual(['loading', 'loaded']);
  });
});

describe('handlers', () => {
  it('a handler that throws does not affect the others; the error is rethrown asynchronously', async () => {
    const { socket, gain } = await wired();
    const boom = new Error('boom');
    const after = vi.fn();
    gain.on('param', () => {
      throw boom;
    });
    gain.on('param', after);

    socket.emit('param_set /graph/Gain gain 1.0');

    expect(after).toHaveBeenCalledTimes(1);
    expect(thrown).toEqual([boom]);
    expect(gain.params.get('gain')!.value).toBe(1);
  });

  it('a write made by a handler causes an event that is delivered after the current delivery, in order', async () => {
    const { socket, gain } = await wired();
    const param = gain.params.get('gain')!;
    const log: string[] = [];
    param.on('change', ({ value, origin }) => {
      log.push(`${origin} ${value} start`);
      if (origin === 'remote') {
        void param.setValue(20);
      }
      log.push(`${origin} ${value} end`);
    });

    socket.emit('param_set /graph/Gain gain 10.0');
    await flush();

    expect(log).toEqual(['remote 10 start', 'remote 10 end', 'local 20 start', 'local 20 end']);
  });

  it('an AbortSignal ends a pedalboard subscription', async () => {
    const { socket, current } = await wired();
    const controller = new AbortController();
    const handler = vi.fn();
    current.on('connection:added', handler, { signal: controller.signal });

    socket.emit('connect /graph/capture_2 /graph/Gain/in');
    controller.abort();
    socket.emit('disconnect /graph/capture_2 /graph/Gain/in');
    socket.emit('connect /graph/capture_2 /graph/Gain/in');

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('a description request that never answers', () => {
  it('does not hold the events or the calls for good: an "error" event, plugins without a description, the line moves on', async () => {
    const never = new Promise<unknown>(() => undefined);
    const { client } = makeClient(routes({ 'POST /effect/bulk/': () => never }), { graphTimeoutMs: 30 });
    const current = client.device.currentPedalboard;
    const log = record(current);

    const socket = await connectedWith(client, [gainFrame('/graph/Gain')]);
    const [gain] = await current.plugins.list(); // would wait for ever without the time limit

    expect(gain.info).toBeNull();
    const timeouts = log.filter(([name]) => name === 'error');
    expect(timeouts.length).toBeGreaterThan(0);
    expect(timeouts[0][1].error).toBeInstanceOf(ModUiTimeoutError);
    expect(timeouts[0][1]).toMatchObject({ context: 'plugin-description' });
    expect(names(log)).toContain('loaded');

    // later events are not stuck behind it
    const changes: number[] = [];
    gain.params.list(); // no description: no controls
    current.on('connection:added', () => changes.push(1));
    socket.emit('connect /graph/capture_1 /graph/Gain/in');
    expect(changes).toEqual([1]);
  });

  it('a plugin that appears later is announced after the time limit, and the events behind it follow', async () => {
    const never = new Promise<unknown>(() => undefined);
    const { client } = makeClient(
      routes({
        // the description of Gain is known from the start; the one of the MIDI plugin never comes
        'POST /effect/bulk/': (call: { body?: string }) => ((JSON.parse(call.body!) as string[]).includes(midiUri) ? never : bulk(call)),
      }),
      { graphTimeoutMs: 30 },
    );
    const current = client.device.currentPedalboard;
    const socket = await connectedWith(client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    await current.plugins.list();
    const log = record(current);

    socket.emit(midiFrame('/graph/Midi'));
    socket.emit('connect /graph/Gain/out /graph/Midi/midi_in');
    expect(names(log)).toEqual([]); // waiting for the description, in order
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect([...names(log)].sort()).toEqual(['connection:added', 'error', 'plugin:added']);
    expect(names(log).indexOf('plugin:added')).toBeLessThan(names(log).indexOf('connection:added'));
    const added = log.find(([name]) => name === 'plugin:added')![1].plugin;
    expect(added.info).toBeNull();
    expect(log.some(([name, e]) => name === 'error' && e.error instanceof ModUiTimeoutError)).toBe(true);
  });
});

describe('PatchParam.refresh(): which changes are "local"', () => {
  it('a patch_set from someone else while the call waits behind a load is "remote"; the answer is "local"', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client } = makeClient(routes({ 'GET /reset': async () => (await gate, true) }));
    const socket = await connectedWith(client, [`add /graph/Patcher ${patchUri} 1.0 2.0 0 1.0.0.0 0`]);
    const [patcher] = await client.device.currentPedalboard.plugins.list();
    const label = patcher.patchParams.get(labelUri)!;
    const seen: Array<[unknown, string, unknown]> = [];
    label.on('change', ({ value, origin, source }) => seen.push([value, origin, source]));

    const resetting = client.device.reset(); // holds the queue
    const refreshing = label.refresh({ source: 'me', timeoutMs: 1000 }); // waits behind it
    await flush();
    socket.emit(`patch_set /graph/Patcher 1 ${labelUri} s FromTheHmi`);
    release();
    await resetting;
    await flush();
    expect(socket.sent).toContain(`patch_get /graph/Patcher ${labelUri}`);
    socket.emit(`patch_set /graph/Patcher 1 ${labelUri} s Answer`);
    await expect(refreshing).resolves.toBe('Answer');

    expect(seen).toEqual([
      ['FromTheHmi', 'remote', undefined],
      ['Answer', 'local', 'me'],
    ]);
  });
});

describe('what the store keeps', () => {
  const bus = (current: CurrentPedalboard) =>
    (current as unknown as { graph: { store: { bus: { listenerCount(): number }; cacheSizes(): { ports: number; connections: number } } } }).graph.store;

  it('subscriptions that ended (once() that fired, an aborted signal) are not kept while the plugin lives', async () => {
    const { socket, current, gain } = await wired();
    const store = bus(current);
    const baseline = store.bus.listenerCount();
    const param = gain.params.get('gain')!;

    for (let i = 0; i < 50; i++) param.once('change', () => undefined);
    const controllers = Array.from({ length: 50 }, () => new AbortController());
    controllers.forEach((c) => gain.on('param', () => undefined, { signal: c.signal }));
    expect(store.bus.listenerCount()).toBe(baseline + 100);

    socket.emit('param_set /graph/Gain gain 1.0'); // fires the once() ones
    controllers.forEach((c) => c.abort());

    expect(store.bus.listenerCount()).toBe(baseline);
  });

  it('the death of a plugin ends all its subscriptions at once', async () => {
    const { socket, current, gain } = await wired();
    const store = bus(current);
    const baseline = store.bus.listenerCount();
    gain.on('param', () => undefined);
    gain.params.get('gain')!.on('change', () => undefined);
    gain.on('removed', () => undefined);
    gain.once('moved', () => undefined);

    socket.emit('remove /graph/Gain');

    expect(store.bus.listenerCount()).toBe(baseline);
  });

  it('the objects of ports and connections that are gone are forgotten', async () => {
    const { socket, current } = await wired();
    await current.connections.list();
    expect(bus(current).cacheSizes()).toEqual({ ports: 6, connections: 2 });

    socket.emit('disconnect /graph/capture_1 /graph/Gain/in');
    socket.emit('remove /graph/Gain');
    socket.emit('remove_hw_port /graph/capture_2');
    await current.connections.list();
    await current.ports.list();

    expect(bus(current).cacheSizes()).toEqual({ ports: 5, connections: 0 });
  });
});

