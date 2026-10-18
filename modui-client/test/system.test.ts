// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { BufferSize, ModUiError } from '../src';
import { makeClient, setupFakes, type Call } from './helpers';

setupFakes();

const form = (call: Call) => {
  const values: Record<string, string> = {};
  new URLSearchParams(call.body).forEach((value, key) => (values[key] = value));
  return values;
};
const path = (call: Call) => new URL(call.url).pathname;

describe('client.system', () => {
  it('info() returns the backend answer', async () => {
    const info = { release: 'v1.14', hwname: 'MOD Duo', uptime: 12, python: { version: '3.11' } };
    const { client } = makeClient({ 'GET /system/info': info });

    expect(await client.system.info()).toEqual(info);
  });

  it('ping() renames the answer', async () => {
    const online = makeClient({ 'GET /ping': { ihm_online: true, ihm_time: 7 } });
    const offline = makeClient({ 'GET /ping': { ihm_online: false, ihm_time: 0 } });

    expect(await online.client.system.ping()).toEqual({ online: true, roundTripMs: 7 });
    expect(await offline.client.system.ping()).toEqual({ online: false, roundTripMs: 0 });
  });

  it('settings.get() gives friendly names', async () => {
    const { client } = makeClient({
      'GET /system/prefs': {
        bluetooth_name: 'Duo',
        jack_buffer_size: 256,
        jack_mono_copy: true,
        jack_sync_mode: false,
        separate_spdif_outs: false,
        service_mod_peakmeter: true,
        service_mod_sdk: false,
        service_netmanager: true,
        autorestart_hmi: false,
      },
    });

    expect(await client.system.settings.get()).toEqual({
      bluetoothName: 'Duo',
      jackBufferSize: 256,
      jackMonoCopy: true,
      jackSyncMode: false,
      separateSpdifOuts: false,
      modPeakmeter: true,
      modSdk: false,
      netmanager: true,
      autorestartHmi: false,
    });
  });
});

describe('client.system.danger.settings.set()', () => {
  it('maps each setting to the right exechange request, in order', async () => {
    const { client, calls } = makeClient({ 'POST /system/exechange': true });

    await client.system.danger.settings.set({
      jackMonoCopy: true,
      autorestartHmi: false,
      bluetoothName: 'My pedal',
      jackBufferSize: BufferSize.Frames256,
      modSdk: true,
      modPeakmeter: false,
    });

    expect(calls.map(form)).toEqual([
      { type: 'filecreate', path: 'jack-mono-copy', create: '1' },
      { type: 'filecreate', path: 'autorestart-hmi', create: '0' },
      { type: 'filewrite', path: 'bluetooth/name', content: 'My pedal' },
      { type: 'filewrite', path: 'jack-buffer-size', content: '256' },
      { type: 'service', name: 'mod-sdk', enable: '1', inverted: '0', persistent: '1' },
      { type: 'service', name: 'mod-peakmeter', enable: '0', inverted: '1', persistent: '1' },
    ]);
  });

  it('does nothing for an empty patch', async () => {
    const { client, calls } = makeClient({});

    await client.system.danger.settings.set({});

    expect(calls).toHaveLength(0);
  });

  it('validates the whole patch before the first request', async () => {
    const { client, calls } = makeClient({ 'POST /system/exechange': true });

    await expect(client.system.danger.settings.set({ jackMonoCopy: true, jackBufferSize: 512 as BufferSize })).rejects.toThrow(ModUiError);
    await expect(client.system.danger.settings.set({ jackMonoCopy: 'yes' as unknown as boolean })).rejects.toThrow(ModUiError);
    await expect(client.system.danger.settings.set({ nope: true } as never)).rejects.toThrow(/not a system setting/);
    expect(calls).toHaveLength(0);
  });

  it('fails when the backend answers false', async () => {
    const { client } = makeClient({ 'POST /system/exechange': false });

    await expect(client.system.danger.settings.set({ jackSyncMode: true })).rejects.toThrow(/refused/);
  });
});

describe('client.system.danger', () => {
  it('reboot() and restoreFactory() send the commands', async () => {
    const { client, calls } = makeClient({ 'POST /system/exechange': true });

    await client.system.danger.reboot();
    await client.system.danger.restoreFactory();

    expect(calls.map(form)).toEqual([
      { type: 'command', cmd: 'reboot' },
      { type: 'command', cmd: 'restore' },
    ]);
  });

  it('startHmiUpdate() starts the unit without keeping it', async () => {
    const { client, calls } = makeClient({ 'POST /system/exechange': true });

    await client.system.danger.startHmiUpdate();

    expect(form(calls[0])).toEqual({ type: 'service', name: 'hmi-update', enable: '1', inverted: '0', persistent: '0' });
  });

  it('backup.export() and import() say what they include, and fail with the tool error', async () => {
    const ok = makeClient({ 'POST /system/exechange': { ok: true, error: '' } });
    await ok.client.system.danger.backup.export({ data: true, pedalboards: false });
    await ok.client.system.danger.backup.import({ data: false, pedalboards: true });
    expect(ok.calls.map((call) => form(call).cmd)).toEqual(['backup-export 1,0', 'backup-import 0,1']);

    const failed = makeClient({ 'POST /system/exechange': { ok: false, error: 'No space left.' } });
    await expect(failed.client.system.danger.backup.export({ data: true })).rejects.toThrow('No space left.');
  });

  it('backup refuses an empty selection without a request', async () => {
    const { client, calls } = makeClient({});

    await expect(client.system.danger.backup.import({})).rejects.toThrow(ModUiError);
    expect(calls).toHaveLength(0);
  });

  it('cleanup() sends the flags and fails on {ok:false}', async () => {
    const { client, calls } = makeClient({ 'POST /system/cleanup': { ok: true, error: '' } });

    await client.system.danger.cleanup({ banks: true, plugins: true });

    expect(form(calls[0])).toEqual({ banks: '1', favorites: '0', hmiSettings: '0', licenseKeys: '0', pedalboards: '0', plugins: '1' });

    const failed = makeClient({ 'POST /system/cleanup': { ok: false, error: 'Nothing to delete' } });
    await expect(failed.client.system.danger.cleanup({ banks: true })).rejects.toThrow('Nothing to delete');
  });

  it('cleanup() refuses to run with nothing selected', async () => {
    const { client, calls } = makeClient({});

    await expect(client.system.danger.cleanup({})).rejects.toThrow(/Nothing selected/);
    await expect(client.system.danger.cleanup({ banks: false })).rejects.toThrow(/Nothing selected/);
    expect(calls).toHaveLength(0);
  });

  it('saveUserId() posts name and e-mail, and does not read anything', async () => {
    const { client, calls } = makeClient({ 'POST /save_user_id/': true });

    await client.system.danger.saveUserId({ name: 'Ana', email: 'ana@example.com' });

    expect(calls).toHaveLength(1);
    expect(form(calls[0])).toEqual({ name: 'Ana', email: 'ana@example.com' });
  });

  it('uploads the firmware as a binary body and can discard it', async () => {
    const { client, calls } = makeClient({
      'POST /controlchain/download/': { ok: true, result: true },
      'POST /controlchain/cancel/': true,
    });

    await client.system.danger.uploadControlChainFirmware(new Uint8Array([1, 2, 3]));
    await client.system.danger.cancelControlChainUpdate();

    expect(path(calls[0])).toBe('/controlchain/download/');
    expect(calls[0].body).toBeInstanceOf(Uint8Array);
    expect(path(calls[1])).toBe('/controlchain/cancel/');
  });

  it('cancelControlChainUpdate() fails when there was nothing to discard', async () => {
    const { client } = makeClient({ 'POST /controlchain/cancel/': false });

    await expect(client.system.danger.cancelControlChainUpdate()).rejects.toThrow(/no Control Chain firmware/);
  });
});
