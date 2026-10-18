// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { BufferSize, ModUiError } from '../src';
import { connected, makeClient, setupFakes } from './helpers';

setupFakes();

describe('client.device.setBufferSize()', () => {
  it('posts the size and answers what the engine uses', async () => {
    const { client, calls } = makeClient({ 'POST /set_buffersize/256': { ok: true, size: 256 } });

    expect(await client.device.setBufferSize(BufferSize.Frames256)).toEqual({ frames: 256 });
    expect(calls).toHaveLength(1);
    expect(client.device.bufferSize).toEqual({ frames: 256 });
  });

  it('emits bufferSize once, even if the bufsize frame arrives afterwards', async () => {
    const { client } = makeClient({ 'POST /set_buffersize/128': { ok: true, size: 128 } });
    const socket = await connected(client);
    const seen: number[] = [];
    client.device.on('bufferSize', (event) => seen.push(event.frames));

    await client.device.setBufferSize(BufferSize.Frames128);
    socket.emit('bufsize 128');

    expect(seen).toEqual([128]);
  });

  it('refuses a number that is not a BufferSize, without a request', async () => {
    const { client, calls } = makeClient({});

    await expect(client.device.setBufferSize(512 as BufferSize)).rejects.toThrow(ModUiError);
    expect(calls).toHaveLength(0);
  });

  it('fails when the engine did not take it', async () => {
    const { client } = makeClient({ 'POST /set_buffersize/128': { ok: false, size: 256 } });

    await expect(client.device.setBufferSize(BufferSize.Frames128)).rejects.toThrow(/did not take/);
    expect(client.device.bufferSize).toBeNull();
  });
});

describe('client.device.setTrueBypass()', () => {
  it('sends one request per channel given', async () => {
    const { client, calls } = makeClient({ 'GET /truebypass/Left/true': true, 'GET /truebypass/Right/false': true });

    await client.device.setTrueBypass({ left: true, right: false });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/truebypass/Left/true', '/truebypass/Right/false']);
  });

  it('touches only the channel given and follows the answer', async () => {
    const { client, calls } = makeClient({ 'GET /truebypass/Right/true': true });
    const socket = await connected(client);
    socket.emit('truebypass 0 0');
    const seen: Array<{ left: boolean; right: boolean }> = [];
    client.device.on('trueBypass', (event) => seen.push(event));

    await client.device.setTrueBypass({ right: true });

    expect(calls).toHaveLength(1);
    expect(client.device.trueBypass).toEqual({ left: false, right: true });
    expect(seen).toEqual([{ left: false, right: true }]);
  });

  it('does not request anything for an empty change', async () => {
    const { client, calls } = makeClient({});

    await client.device.setTrueBypass({});

    expect(calls).toHaveLength(0);
  });

  it('fails when the backend answers false', async () => {
    const { client } = makeClient({ 'GET /truebypass/Left/true': false });

    await expect(client.device.setTrueBypass({ left: true })).rejects.toThrow(/refused/);
  });

  it('refuses a value that is not a boolean', async () => {
    const { client, calls } = makeClient({});

    await expect(client.device.setTrueBypass({ left: 1 as unknown as boolean })).rejects.toThrow(ModUiError);
    expect(calls).toHaveLength(0);
  });
});

describe('client.device.resetXruns() and switchCpuFrequency()', () => {
  it('resetXruns posts to /reset_xruns/', async () => {
    const { client, calls } = makeClient({ 'POST /reset_xruns/': true });

    await client.device.resetXruns();

    expect(calls[0].method).toBe('POST');
  });

  it('switchCpuFrequency posts to /switch_cpu_freq/ and fails on false', async () => {
    const ok = makeClient({ 'POST /switch_cpu_freq/': true });
    await expect(ok.client.device.switchCpuFrequency()).resolves.toBeUndefined();

    const refused = makeClient({ 'POST /switch_cpu_freq/': false });
    await expect(refused.client.device.switchCpuFrequency()).rejects.toThrow(/CPU frequency/);
  });
});
