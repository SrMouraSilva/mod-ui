// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PedalboardSnapshot } from '../src';
import {
  connectedWith,
  gainInfo,
  gainUri,
  hardwareFrames,
  makeClient,
  midiInfo,
  midiUri,
  setupFakes,
} from './helpers';

setupFakes();

const gainFrame = (instance: string, x = 10, y = 20) => `add ${instance} ${gainUri} ${x}.0 ${y}.0 0 1.0.0.0 0`;
const routes = () => ({ 'POST /effect/bulk/': { [gainUri]: gainInfo, [midiUri]: midiInfo } });

/** A scheduler the test drives by hand: nothing is notified until `tick()`. */
function manualSchedule() {
  const queue: Array<() => void> = [];
  return {
    schedule: (callback: () => void) => queue.push(callback),
    tick: () => queue.splice(0).forEach((callback) => callback()),
    pending: () => queue.length,
  };
}

/** Two Gain plugins, the pedalboard ports and two connections, in sync. */
async function device() {
  const clock = manualSchedule();
  const made = makeClient(routes(), { schedule: clock.schedule });
  const socket = await connectedWith(made.client, [
    ...hardwareFrames,
    gainFrame('/graph/Gain'),
    gainFrame('/graph/Gain_1', 30, 40),
    'connect /graph/capture_1 /graph/Gain/in',
    'connect /graph/Gain/out /graph/playback_1',
    'param_set /graph/Gain gain 6.5',
  ]);
  const pedalboard = made.client.device.currentPedalboard;
  await pedalboard.plugins.list(); // the plugins are complete: "loaded" was announced
  clock.tick();
  return { ...made, ...clock, socket, pedalboard };
}

let thrown: unknown[];
const realQueueMicrotask = globalThis.queueMicrotask;
beforeEach(() => {
  thrown = [];
});
afterEach(() => {
  globalThis.queueMicrotask = realQueueMicrotask;
  delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
});

describe('getSnapshot()', () => {
  it('starts empty and not ready, and is the same object until something changes', () => {
    const { client } = makeClient(routes());
    const { getSnapshot } = client.device.currentPedalboard; // usable without `this`
    const first = getSnapshot();
    expect(first).toEqual({ version: 0, ready: false, loading: false, plugins: [], connections: [], ports: [] });
    expect(getSnapshot()).toBe(first);
  });

  it('describes the pedalboard once the state replay is complete', async () => {
    const { pedalboard } = await device();
    const snapshot = pedalboard.getSnapshot();

    expect(snapshot).toMatchObject({ ready: true, loading: false });
    expect(snapshot.plugins.map((p) => [p.instance, p.uri, p.x, p.y, p.active, p.preset])).toEqual([
      ['/graph/Gain', gainUri, 10, 20, true, null],
      ['/graph/Gain_1', gainUri, 30, 40, true, null],
    ]);
    expect({ ...snapshot.plugins[0].values }).toEqual({ gain: 6.5 });
    expect({ ...snapshot.plugins[1].values }).toEqual({});
    expect(snapshot.connections).toEqual([
      { from: '/graph/capture_1', to: '/graph/Gain/in' },
      { from: '/graph/Gain/out', to: '/graph/playback_1' },
    ]);
    // by type, sources before sinks, then by index
    expect(snapshot.ports.map((p) => p.id)).toEqual([
      '/graph/capture_1',
      '/graph/capture_2',
      '/graph/playback_1',
      '/graph/playback_2',
      '/graph/midi_merger_out',
      '/graph/midi_broadcaster_in',
    ]);
    expect(snapshot.ports[0]).toEqual({ id: '/graph/capture_1', type: 'audio', direction: 'output', title: 'Capture_1', index: 1 });
  });

  it('is frozen and survives a JSON round trip', async () => {
    const { pedalboard } = await device();
    const snapshot = pedalboard.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.plugins)).toBe(true);
    expect(Object.isFrozen(snapshot.plugins[0])).toBe(true);
    expect(Object.isFrozen(snapshot.plugins[0].values)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(JSON.parse(JSON.stringify({ ...snapshot })));
    expect(JSON.parse(JSON.stringify(snapshot)).plugins[0].values).toEqual({ gain: 6.5 });
  });

  it('only what changed gets a new object (structural sharing)', async () => {
    const { pedalboard, socket } = await device();
    const before = pedalboard.getSnapshot();

    socket.emit('param_set /graph/Gain gain -3.0');
    const after = pedalboard.getSnapshot();

    expect(after).not.toBe(before);
    expect(after.version).toBe(before.version + 1);
    expect(after.plugins).not.toBe(before.plugins);
    expect(after.plugins[0]).not.toBe(before.plugins[0]);
    expect(after.plugins[0].values.gain).toBe(-3);
    expect(after.plugins[1]).toBe(before.plugins[1]); // untouched
    expect(after.connections).toBe(before.connections);
    expect(after.ports).toBe(before.ports);
    expect(pedalboard.getSnapshot()).toBe(after); // stable again
  });

  it('keeps the maps of a plugin that moved only', async () => {
    const { pedalboard, socket } = await device();
    const before = pedalboard.getSnapshot().plugins[0];
    socket.emit('plugin_pos /graph/Gain 100 200');
    const after = pedalboard.getSnapshot().plugins[0];
    expect(after).not.toBe(before);
    expect([after.x, after.y]).toEqual([100, 200]);
    expect(after.values).toBe(before.values);
    expect(after.patches).toBe(before.patches);
  });

  it('a connection change leaves the plugins as they were; a port change leaves the connections', async () => {
    const { pedalboard, socket } = await device();
    const before = pedalboard.getSnapshot();

    socket.emit('connect /graph/capture_2 /graph/Gain_1/in');
    const connected = pedalboard.getSnapshot();
    expect(connected.plugins).toBe(before.plugins);
    expect(connected.ports).toBe(before.ports);
    expect(connected.connections).toHaveLength(3);

    socket.emit('add_hw_port /graph/capture_3 audio 0 Capture_3 3');
    const ported = pedalboard.getSnapshot();
    expect(ported.connections).toBe(connected.connections);
    expect(ported.plugins).toBe(connected.plugins);
    expect(ported.ports.map((p) => p.id)).toContain('/graph/capture_3');
  });

  it('follows bypass, patch parameters, plugins added and removed, and the writes made through the client', async () => {
    const { pedalboard, socket } = await device();
    const [gain] = await pedalboard.plugins.list();

    socket.emit('param_set /graph/Gain :bypass 1.0');
    expect(pedalboard.getSnapshot().plugins[0].active).toBe(false);
    socket.emit('patch_set /graph/Gain 1 http://x.org/label s Hello world');
    expect({ ...pedalboard.getSnapshot().plugins[0].patches }).toEqual({ 'http://x.org/label': 'Hello world' });
    socket.emit(gainFrame('/graph/Gain_2'));
    expect(pedalboard.getSnapshot().plugins.map((p) => p.instance)).toEqual(['/graph/Gain', '/graph/Gain_1', '/graph/Gain_2']);
    socket.emit('remove /graph/Gain_1');
    expect(pedalboard.getSnapshot().plugins.map((p) => p.instance)).toEqual(['/graph/Gain', '/graph/Gain_2']);

    await gain.params.get('gain')!.setValue(12); // local
    expect(pedalboard.getSnapshot().plugins[0].values.gain).toBe(12);
    await gain.setPosition({ x: 1, y: 2 });
    expect([pedalboard.getSnapshot().plugins[0].x, pedalboard.getSnapshot().plugins[0].y]).toEqual([1, 2]);
  });

  it('a pedalboard reload: "loading" empties plugins and connections (ports stay), "loaded" fills them again', async () => {
    const { pedalboard, socket } = await device();
    const ports = pedalboard.getSnapshot().ports;

    socket.emit('loading_start 0 0');
    const loading = pedalboard.getSnapshot();
    expect(loading).toMatchObject({ ready: false, loading: true, plugins: [], connections: [] });
    expect(loading.ports).toBe(ports);

    socket.emit(gainFrame('/graph/Gain'));
    socket.emit('connect /graph/capture_1 /graph/Gain/in');
    socket.emit('param_set /graph/Gain gain 1.0');
    expect(pedalboard.getSnapshot()).toBe(loading); // nothing partial is ever published

    socket.emit('loading_end 3');
    await pedalboard.plugins.list();
    const loaded = pedalboard.getSnapshot();
    expect(loaded).toMatchObject({ ready: true, loading: false });
    expect(loaded.plugins.map((p) => p.instance)).toEqual(['/graph/Gain']);
    expect(loaded.plugins[0].values.gain).toBe(1);
    expect(loaded.connections).toHaveLength(1);
  });

  it('"remove :all" empties the plugins and connections and keeps the ports', async () => {
    const { pedalboard, socket } = await device();
    socket.emit('remove :all');
    expect(pedalboard.getSnapshot()).toMatchObject({ ready: true, plugins: [], connections: [] });
    expect(pedalboard.getSnapshot().ports).toHaveLength(6);
  });
});

describe('identity of what did not change', () => {
  it('connections and ports that did not change are the same objects when another one is added or removed', async () => {
    const { pedalboard, socket } = await device();
    const before = pedalboard.getSnapshot();

    socket.emit('connect /graph/capture_2 /graph/Gain_1/in');
    const connected = pedalboard.getSnapshot();
    expect(connected.connections).toHaveLength(3);
    connected.connections.slice(0, 2).forEach((item, i) => expect(item).toBe(before.connections[i]));

    socket.emit('add_hw_port /graph/capture_3 audio 0 Capture_3 3');
    const ported = pedalboard.getSnapshot();
    before.ports.forEach((port) => expect(ported.ports.find((p) => p.id === port.id)).toBe(port));
    socket.emit('remove_hw_port /graph/capture_3');
    const removed = pedalboard.getSnapshot();
    expect(removed.ports).toHaveLength(6);
    removed.ports.forEach((port, i) => expect(port).toBe(before.ports[i]));
    expect(removed.ports).toEqual(before.ports);
  });

  it('a change that cancels itself before the tick publishes nothing: same snapshot, no notification', async () => {
    const { pedalboard, socket, tick } = await device();
    const before = pedalboard.getSnapshot();
    const listener = vi.fn();
    pedalboard.subscribe(listener);

    socket.emit('param_set /graph/Gain :bypass 1.0');
    socket.emit('param_set /graph/Gain :bypass 0.0'); // back to what it was
    tick();

    expect(pedalboard.getSnapshot()).toBe(before);
    expect(pedalboard.getSnapshot().plugins[0]).toBe(before.plugins[0]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('still notifies when getSnapshot() already rebuilt the change before the tick', async () => {
    const { pedalboard, socket, tick } = await device();
    const listener = vi.fn();
    pedalboard.subscribe(listener);

    socket.emit('param_set /graph/Gain gain 1.0');
    pedalboard.getSnapshot(); // a render read it in between
    tick();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('subscribe()', () => {
  it('notifies once per tick, however many changes happened, and getSnapshot() then has the last state', async () => {
    const { pedalboard, socket, tick, pending } = await device();
    const listener = vi.fn();
    pedalboard.subscribe(listener);

    for (let i = 0; i < 200; i++) socket.emit(`param_set /graph/Gain gain ${i - 90}.5`); // a knob drag
    expect(listener).not.toHaveBeenCalled();
    expect(pending()).toBe(1);

    tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pedalboard.getSnapshot().plugins[0].values.gain).toBe(109.5); // the last of the 200 frames

    socket.emit('param_set /graph/Gain gain 1.0');
    tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when nothing changed, nor for a repeated value', async () => {
    const { pedalboard, socket, tick, pending } = await device();
    const listener = vi.fn();
    pedalboard.subscribe(listener);

    socket.emit('param_set /graph/Gain gain 6.5'); // already 6.5
    socket.emit('connect /graph/capture_1 /graph/Gain/in'); // already connected
    expect(pending()).toBe(0);
    tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function, works destructured, and a throwing listener does not affect the others', async () => {
    globalThis.queueMicrotask = (task: () => void) => {
      try {
        task();
      } catch (error) {
        thrown.push(error);
      }
    };
    const { pedalboard, socket, tick } = await device();
    const { subscribe } = pedalboard;
    const first = vi.fn();
    const second = vi.fn();
    const boom = new Error('boom');
    subscribe(() => {
      throw boom;
    });
    const off = subscribe(first);
    subscribe(second);

    socket.emit('param_set /graph/Gain gain 1.0');
    tick();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
    expect(thrown).toEqual([boom]);

    off();
    off();
    socket.emit('param_set /graph/Gain gain 2.0');
    tick();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 2]);
  });

  it('a reload is two notifications ("loading", "loaded"), not one per frame', async () => {
    const { pedalboard, socket, tick } = await device();
    const seen: PedalboardSnapshot[] = [];
    pedalboard.subscribe(() => seen.push(pedalboard.getSnapshot()));

    socket.emit('loading_start 0 0');
    tick();
    for (let i = 0; i < 50; i++) socket.emit(`param_set /graph/Gain gain ${i}.0`);
    tick();
    socket.emit(gainFrame('/graph/Gain'));
    socket.emit('loading_end 0');
    await pedalboard.plugins.list();
    tick();

    expect(seen.map((s) => [s.loading, s.ready])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('notifies the subscribers that were registered before the connection, when the first state replay ends', async () => {
    const clock = manualSchedule();
    const { client } = makeClient(routes(), { schedule: clock.schedule });
    const pedalboard = client.device.currentPedalboard;
    const listener = vi.fn();
    pedalboard.subscribe(listener);

    await connectedWith(client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    await pedalboard.plugins.list();
    clock.tick();

    expect(listener).toHaveBeenCalled();
    expect(pedalboard.getSnapshot()).toMatchObject({ ready: true, loading: false });
    expect(pedalboard.getSnapshot().plugins).toHaveLength(1);
  });
});

describe('the default scheduler', () => {
  it('uses requestAnimationFrame when the page has it: one notification per frame', async () => {
    const frames: Array<() => void> = [];
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (callback: () => void) => frames.push(callback);
    const { client } = makeClient(routes());
    const socket = await connectedWith(client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    const pedalboard = client.device.currentPedalboard;
    await pedalboard.plugins.list();
    frames.splice(0).forEach((frame) => frame());

    const listener = vi.fn();
    pedalboard.subscribe(listener);
    for (let i = 0; i < 20; i++) socket.emit(`param_set /graph/Gain gain ${i}.0`);

    expect(frames).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    frames[0]();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to a microtask where there is no animation frame (Node)', async () => {
    const { client } = makeClient(routes());
    const socket = await connectedWith(client, [...hardwareFrames, gainFrame('/graph/Gain')]);
    const pedalboard = client.device.currentPedalboard;
    await pedalboard.plugins.list();
    await Promise.resolve();

    const listener = vi.fn();
    pedalboard.subscribe(listener);
    socket.emit('param_set /graph/Gain gain 1.0');
    socket.emit('param_set /graph/Gain gain 2.0');
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
