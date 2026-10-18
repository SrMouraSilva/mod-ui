// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { APP_CONFIG_KEY, APP_CONFIG_MAX_BYTES, ModConfigKey, ModUiConfigTooLargeError, ModUiError } from '../src';
import { makeClient, setupFakes, type Call } from './helpers';

setupFakes();

/** A device whose preferences file is `prefs`: `/config/get` answers it, `/config/set` changes it. */
function device(prefs: Record<string, unknown>) {
  const sets: Call[] = [];
  const made = makeClient({
    'GET /config/get': () => ({ ...prefs }),
    'POST /config/set': (call: Call) => {
      const form = new URLSearchParams(call.body);
      prefs[form.get('key')!] = form.get('value')!;
      sets.push(call);
      return true;
    },
  });
  return { ...made, prefs, sets };
}

describe('client.config.mod', () => {
  it('returns an object keyed by ModConfigKey, only with the keys mod-ui owns', async () => {
    const { client } = device({
      'dev-mode': 'on',
      'pb-view-mode': 'list',
      'display-brightness': 3,
      'modui-client': '{"zoom":2}',
    });

    expect(await client.config.mod.getAll()).toEqual({
      [ModConfigKey.DevMode]: 'on',
      [ModConfigKey.PedalboardsViewMode]: 'list',
    });
  });

  it('leaves out a stored value mod-ui would not understand', async () => {
    const { client } = device({ 'dev-mode': 'maybe', 'update-channel': 'testing' });

    expect(await client.config.mod.getAll()).toEqual({ [ModConfigKey.UpdateChannel]: 'testing' });
  });

  it('get() answers one key, undefined when it was never set', async () => {
    const { client } = device({ 'dev-mode': 'off' });

    expect(await client.config.mod.get(ModConfigKey.DevMode)).toBe('off');
    expect(await client.config.mod.get(ModConfigKey.UpdateChannel)).toBeUndefined();
  });

  it('set() posts the key and the value', async () => {
    const { client, sets } = device({});

    await client.config.mod.set(ModConfigKey.PluginsFolded, 'true');

    expect(new URLSearchParams(sets[0].body).get('key')).toBe('plugins-folded');
    expect(new URLSearchParams(sets[0].body).get('value')).toBe('true');
  });

  it('set() refuses a value the key does not take, and a key outside the enum', async () => {
    const { client, sets } = device({});

    await expect(client.config.mod.set(ModConfigKey.DevMode, 'yes' as 'on')).rejects.toThrow(ModUiError);
    await expect(client.config.mod.set('modui-client' as ModConfigKey, '{}' as never)).rejects.toThrow(/not a ModConfigKey/);
    await expect(client.config.mod.set('t3k-api-key' as ModConfigKey, 'x' as never)).rejects.toThrow(ModUiError);
    expect(sets).toHaveLength(0);
  });
});

describe('client.config.app', () => {
  it('is empty when nothing was saved', async () => {
    const { client } = device({ 'dev-mode': 'on' });

    expect(await client.config.app.getAll()).toEqual({});
    expect(await client.config.app.get('zoom')).toBeUndefined();
  });

  it('keeps everything in the single preference modui-client, as JSON', async () => {
    const { client, prefs, sets } = device({ 'dev-mode': 'on' });

    await client.config.app.set('zoom', 2);
    await client.config.app.set('layout', { left: ['a'], right: [] });

    expect(JSON.parse(prefs[APP_CONFIG_KEY] as string)).toEqual({ zoom: 2, layout: { left: ['a'], right: [] } });
    expect(sets.every((call) => new URLSearchParams(call.body).get('key') === 'modui-client')).toBe(true);
    expect(prefs['dev-mode']).toBe('on');
    expect(await client.config.app.get('zoom')).toBe(2);
  });

  it('delete() removes one value and does not write when it was not there', async () => {
    const { client, sets } = device({ 'modui-client': '{"a":1,"b":2}' });

    await client.config.app.delete('a');
    await client.config.app.delete('nothing');

    expect(await client.config.app.getAll()).toEqual({ b: 2 });
    expect(sets).toHaveLength(1);
  });

  it('replaceAll() replaces the whole object', async () => {
    const { client } = device({ 'modui-client': '{"a":1}' });

    await client.config.app.replaceAll({ b: true });

    expect(await client.config.app.getAll()).toEqual({ b: true });
  });

  it('queues writes, so none is lost', async () => {
    const { client } = device({});

    await Promise.all([client.config.app.set('a', 1), client.config.app.set('b', 2), client.config.app.set('c', 3)]);

    expect(await client.config.app.getAll()).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('refuses a write that would pass 10 KiB, before any request', async () => {
    const { client, sets } = device({ 'modui-client': '{"keep":1}' });

    const error = await client.config.app.set('big', 'x'.repeat(APP_CONFIG_MAX_BYTES)).catch((e) => e);

    expect(error).toBeInstanceOf(ModUiConfigTooLargeError);
    expect(error.limit).toBe(10240);
    expect(error.size).toBeGreaterThan(10240);
    await expect(client.config.app.replaceAll({ big: 'x'.repeat(APP_CONFIG_MAX_BYTES) })).rejects.toBeInstanceOf(ModUiConfigTooLargeError);
    expect(sets).toHaveLength(0);
    expect(await client.config.app.getAll()).toEqual({ keep: 1 });
  });

  it('counts bytes, not characters', async () => {
    const { client } = device({});

    // 4000 three-byte characters are 12000 bytes of UTF-8 (and only 4000 characters)
    await expect(client.config.app.set('text', '€'.repeat(4000))).rejects.toBeInstanceOf(ModUiConfigTooLargeError);
    await expect(client.config.app.set('text', 'x'.repeat(4000))).resolves.toBeUndefined();
  });

  it('accepts exactly 10 KiB', async () => {
    const { client, prefs } = device({});
    const overhead = JSON.stringify({ k: '' }).length;

    await client.config.app.set('k', 'x'.repeat(APP_CONFIG_MAX_BYTES - overhead));

    expect((prefs[APP_CONFIG_KEY] as string).length).toBe(APP_CONFIG_MAX_BYTES);
  });

  it('delete() is never refused for size, so an oversized object can shrink', async () => {
    const { client } = device({ 'modui-client': JSON.stringify({ big: 'x'.repeat(APP_CONFIG_MAX_BYTES + 1), small: 1 }) });

    await client.config.app.delete('big');

    expect(await client.config.app.getAll()).toEqual({ small: 1 });
  });

  it('refuses values that are not JSON and bad keys', async () => {
    const { client, sets } = device({});
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    await expect(client.config.app.set('a', undefined as never)).rejects.toThrow(ModUiError);
    await expect(client.config.app.set('a', cycle as never)).rejects.toThrow(/not JSON/);
    await expect(client.config.app.set('', 1)).rejects.toThrow(ModUiError);
    await expect(client.config.app.set('__proto__', 1)).rejects.toThrow(ModUiError);
    expect(sets).toHaveLength(0);
  });

  it('does not overwrite text that is not a JSON object; replaceAll() repairs it', async () => {
    const { client, sets } = device({ 'modui-client': 'not json' });

    await expect(client.config.app.getAll()).rejects.toThrow(/does not hold JSON/);
    await expect(client.config.app.set('a', 1)).rejects.toThrow(ModUiError);
    expect(sets).toHaveLength(0);

    await client.config.app.replaceAll({ a: 1 });
    expect(await client.config.app.getAll()).toEqual({ a: 1 });
  });

  it('a failed write does not block the next one', async () => {
    const { client } = device({});

    await expect(client.config.app.set('a', undefined as never)).rejects.toThrow(ModUiError);
    await client.config.app.set('b', 1);

    expect(await client.config.app.getAll()).toEqual({ b: 1 });
  });
});
