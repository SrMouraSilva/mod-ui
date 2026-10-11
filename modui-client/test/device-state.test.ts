// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { connected, connectedWith, gainInfo, gainUri, makeClient, setupFakes } from './helpers';

setupFakes();

const gainFrame = (instance: string) => `add ${instance} ${gainUri} 10.0 20.0 0 1.0.0.0 0`;
const routes = () => ({ 'POST /effect/bulk/': { [gainUri]: gainInfo } });

describe('device state: getters', () => {
  it('are null until the device reports, and seeded by the state replay (a late subscriber reads them)', async () => {
    const { client } = makeClient(routes());
    const { device } = client;
    expect([device.stats, device.sysStats, device.transport, device.bufferSize, device.trueBypass, device.snapshot]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);

    await connectedWith(client, [
      'sys_stats 41.5 1200000 54000',
      'stats 12.5 3',
      'transport 1 4.000000 120.500000 link',
      'truebypass 1 0',
      'bufsize 128',
      'pedal_snapshot 2 Verse and chorus',
    ]);

    expect(device.stats).toEqual({ cpuLoad: 12.5, xruns: 3 });
    expect(device.sysStats).toEqual({ memLoad: 41.5, cpuFreqKhz: 1200000, cpuTempMilli: 54000 });
    expect(device.transport).toEqual({ rolling: true, beatsPerBar: 4, bpm: 120.5, syncMode: 'link' });
    expect(device.trueBypass).toEqual({ left: true, right: false });
    expect(device.bufferSize).toEqual({ frames: 128 });
    expect(device.snapshot).toEqual({ index: 2, name: 'Verse and chorus' });
  });

  it('keep the last value while the connection is down', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    socket.emit('stats 7.0 1');
    socket.close();
    expect(client.device.stats).toEqual({ cpuLoad: 7, xruns: 1 });
  });
});

describe('device events', () => {
  it('"stats" and "sysStats" arrive every time, even with the same values', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    const stats = vi.fn();
    const sys = vi.fn();
    client.device.on('stats', stats);
    client.device.on('sysStats', sys);

    socket.emit('stats 3.0 0');
    socket.emit('stats 3.0 0');
    socket.emit('sys_stats 20.0 800000 0');
    socket.emit('sys_stats 20.0 800000 0');

    expect(stats).toHaveBeenCalledTimes(2);
    expect(stats).toHaveBeenCalledWith({ cpuLoad: 3, xruns: 0 });
    expect(sys).toHaveBeenCalledTimes(2);
  });

  it('"sysStats": "??" and 0 mean "not available" (null)', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    const events: unknown[] = [];
    client.device.on('sysStats', (event) => events.push(event));

    socket.emit('sys_stats ?? 0 0');
    socket.emit('sys_stats 0.0 1500000 61000');

    expect(events).toEqual([
      { memLoad: null, cpuFreqKhz: null, cpuTempMilli: null },
      { memLoad: 0, cpuFreqKhz: 1500000, cpuTempMilli: 61000 },
    ]);
  });

  it('the states ("transport", "bufferSize", "trueBypass", "snapshot") arrive when they change', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    const log: Array<[string, unknown]> = [];
    for (const name of ['transport', 'bufferSize', 'trueBypass', 'snapshot'] as const) {
      client.device.on(name, (event) => log.push([name, event]));
    }

    socket.emit('transport 0 4.000000 120.000000 none');
    socket.emit('transport 0 4.000000 120.000000 none'); // same
    socket.emit('transport 1 4.000000 120.000000 none');
    socket.emit('bufsize 128');
    socket.emit('bufsize 128');
    socket.emit('bufsize 256');
    socket.emit('truebypass 0 0');
    socket.emit('truebypass 0 0');
    socket.emit('truebypass 1 0');
    socket.emit('pedal_snapshot 0 First');
    socket.emit('pedal_snapshot 0 First');
    socket.emit('pedal_snapshot 1 Second one');

    expect(log).toEqual([
      ['transport', { rolling: false, beatsPerBar: 4, bpm: 120, syncMode: 'none' }],
      ['transport', { rolling: true, beatsPerBar: 4, bpm: 120, syncMode: 'none' }],
      ['bufferSize', { frames: 128 }],
      ['bufferSize', { frames: 256 }],
      ['trueBypass', { left: false, right: false }],
      ['trueBypass', { left: true, right: false }],
      ['snapshot', { index: 0, name: 'First' }],
      ['snapshot', { index: 1, name: 'Second one' }],
    ]);
  });

  it('a "transport" frame without the sync mode keeps the last one', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    socket.emit('transport 0 4.000000 120.000000 link');
    socket.emit('transport 1 3.000000 90.000000');
    expect(client.device.transport).toEqual({ rolling: true, beatsPerBar: 3, bpm: 90, syncMode: 'link' });
  });

  it('ignores malformed frames', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    const handler = vi.fn();
    for (const name of ['stats', 'transport', 'bufferSize', 'trueBypass', 'snapshot'] as const) client.device.on(name, handler);

    socket.emit('stats nope');
    socket.emit('transport x y z');
    socket.emit('bufsize many');
    socket.emit('truebypass 2 9');
    socket.emit('pedal_snapshot first One');

    expect(handler).not.toHaveBeenCalled();
    expect(client.device.stats).toEqual({ cpuLoad: 3, xruns: 0 }); // the one of the replay of connected(): untouched
  });

  it('once(), the unsubscribe function and an AbortSignal work like every on()', async () => {
    const { client } = makeClient(routes());
    const socket = await connected(client);
    const once = vi.fn();
    const removed = vi.fn();
    const aborted = vi.fn();
    const controller = new AbortController();
    client.device.once('stats', once);
    client.device.on('stats', removed)();
    client.device.on('stats', aborted, { signal: controller.signal });

    socket.emit('stats 1.0 0');
    controller.abort();
    socket.emit('stats 2.0 0');

    expect([once.mock.calls.length, removed.mock.calls.length, aborted.mock.calls.length]).toEqual([1, 0, 1]);
  });
});

describe('plugin preset', () => {
  async function plugin() {
    const { client } = makeClient(routes());
    const socket = await connectedWith(client, [gainFrame('/graph/Gain')]);
    const [gain] = await client.device.currentPedalboard.plugins.list();
    return { client, socket, gain };
  }

  it('is null at first, follows "preset" frames, and "null" means none', async () => {
    const { socket, gain } = await plugin();
    const events: unknown[] = [];
    gain.on('preset', ({ preset, previous, origin }) => events.push([preset, previous, origin]));
    expect(gain.preset).toBeNull();

    socket.emit('preset /graph/Gain urn:preset:bright');
    socket.emit('preset /graph/Gain urn:preset:bright'); // same
    expect(gain.preset).toBe('urn:preset:bright');
    socket.emit('preset /graph/Gain null');
    expect(gain.preset).toBeNull();

    expect(events).toEqual([
      ['urn:preset:bright', null, 'remote'],
      [null, 'urn:preset:bright', 'remote'],
    ]);
  });

  it('is part of the pedalboard snapshot, and ignores plugins that are not in the pedalboard', async () => {
    const { client, socket } = await plugin();
    socket.emit('preset /graph/Gain urn:preset:dark');
    socket.emit('preset /graph/Other urn:preset:x');
    expect(client.device.currentPedalboard.getSnapshot().plugins[0].preset).toBe('urn:preset:dark');
  });

  it('the replay of a load sets the preset without events', async () => {
    const { client, socket, gain } = await plugin();
    const handler = vi.fn();
    gain.on('preset', handler);

    socket.emit('loading_start 0 0');
    socket.emit(gainFrame('/graph/Gain'));
    socket.emit('preset /graph/Gain urn:preset:replayed');
    socket.emit('loading_end 0');
    const [reloaded] = await client.device.currentPedalboard.plugins.list();

    expect(handler).not.toHaveBeenCalled();
    expect(reloaded.preset).toBe('urn:preset:replayed');
    expect(gain.alive).toBe(false);
  });
});
