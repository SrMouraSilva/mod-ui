// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ModUiError, ModUiHttpError, Preset, type PluginInstance, type PresetListEvent } from '../src';
import {
  connectedWith,
  fakePresetBackend,
  flush,
  gainInfo,
  gainUri,
  makeClient,
  pluginSummaries,
  setupFakes,
  type Call,
  type FakePreset,
  type FakeWebSocket,
} from './helpers';

setupFakes();

const path = '/graph/Gain';
const gainFrame = (instance: string) => `add ${instance} ${gainUri} 10.0 20.0 0 1.0.0.0 0`;

const factory = (name: string): FakePreset => ({ valid: true, uri: `http://example.org/presets#${name}`, label: name, path: '' });
const user = (name: string): FakePreset => ({
  valid: true,
  uri: `file:///root/.lv2/Gain-${name}.lv2/${name}.ttl`,
  label: name,
  path: `/root/.lv2/Gain-${name}.lv2`,
});

/** A device running two Gain instances; `/graph/Gain` has the preset endpoints. */
async function device(initial: FakePreset[] = [factory('Clean'), factory('Crunch'), user('Mine')], extraRoutes: Record<string, unknown> = {}) {
  const holder: { socket?: FakeWebSocket } = {};
  const backend = fakePresetBackend(path, initial, holder);
  const made = makeClient({
    ...backend.routes,
    ...extraRoutes,
    'GET /effect/list': pluginSummaries,
    'POST /effect/bulk/': { [gainUri]: { ...gainInfo, presets: [factory('Stale')] } },
  });
  const socket = await connectedWith(made.client, [gainFrame(path), gainFrame('/graph/Gain_1')]);
  holder.socket = socket;
  const [instance, other] = await made.client.device.currentPedalboard.plugins.list();
  return { ...made, ...backend, socket, instance, other, presets: instance.presets };
}

const paths = (calls: Call[]) => calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

describe('presets.list() / get()', () => {
  it('reads GET /effect/get_non_cached (never the cached description) and wraps the presets', async () => {
    const { presets, calls } = await device();
    calls.length = 0;
    const list = await presets.list();

    expect(paths(calls)).toEqual(['GET /effect/get_non_cached']);
    expect(new URL(calls[0].url).searchParams.get('uri')).toBe(gainUri);
    expect(list.map((p) => [p.label, p.isUser, p.bundlepath])).toEqual([
      ['Clean', false, null],
      ['Crunch', false, null],
      ['Mine', true, '/root/.lv2/Gain-Mine.lv2'],
    ]);
    expect(list[0]).toBeInstanceOf(Preset);
    expect(list[0].uri).toBe('http://example.org/presets#Clean');
  });

  it('keeps the same objects across reads, and get() finds one by URI', async () => {
    const { presets } = await device();
    const first = await presets.list();
    const second = await presets.list();
    expect(second[2]).toBe(first[2]);
    expect(await presets.get(first[1].uri)).toBe(first[1]);
    expect(await presets.get('urn:nothing')).toBeUndefined();
  });

  it('reconciles: a user preset is kept by its bundle although uri and label changed, a factory one by uri, a missing one dies', async () => {
    const { presets, state } = await device();
    const [clean, crunch, mine] = await presets.list();
    const events: PresetListEvent[] = [];
    presets.on('list', (e) => events.push(e));

    state.presets = [
      factory('Clean'),
      { ...user('Mine'), uri: 'file:///root/.lv2/Gain-Mine.lv2/renamed.ttl', label: 'Renamed' },
      factory('Brand new'),
    ];
    const after = await presets.list();

    expect(after[0]).toBe(clean);
    expect(after[1]).toBe(mine);
    expect(mine.label).toBe('Renamed');
    expect(mine.uri).toBe('file:///root/.lv2/Gain-Mine.lv2/renamed.ttl');
    expect(crunch.alive).toBe(false);
    expect(crunch.label).toBe('Crunch'); // the last known values stay
    expect(after[2].label).toBe('Brand new');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ origin: 'remote' });
  });

  it('emits no event when a read finds nothing new', async () => {
    const { presets } = await device();
    await presets.list();
    const events: unknown[] = [];
    presets.on('list', (e) => events.push(e));
    await presets.list();
    expect(events).toEqual([]);
  });

  it('updates the cached description in place', async () => {
    const { presets, instance } = await device();
    expect(instance.info?.presets?.map((p) => p.label)).toEqual(['Stale']); // from GET /effect/get
    await presets.list();
    expect(instance.info?.presets?.map((p) => p.label)).toEqual(['Clean', 'Crunch', 'Mine']);
    expect(instance.info?.presets?.[2]).toMatchObject({ path: '/root/.lv2/Gain-Mine.lv2' });
  });

  it('says so when the plugin is not installed (404)', async () => {
    const { presets, calls } = await device([], { 'GET /effect/get_non_cached': new Response('nope', { status: 404 }) });
    calls.length = 0;
    await expect(presets.list()).rejects.toThrow(/not installed/);
  });

  it('passes other HTTP errors through', async () => {
    const { presets } = await device([], { 'GET /effect/get_non_cached': new Response('boom', { status: 500 }) });
    await expect(presets.list()).rejects.toBeInstanceOf(ModUiHttpError);
  });
});

describe('current preset', () => {
  it('currentUri follows instance.preset; current is the object once the list was read', async () => {
    const { presets, socket, instance } = await device();
    expect(presets.currentUri).toBeNull();
    expect(presets.current).toBeNull();

    const list = await presets.list();
    socket.emit(`preset ${path} ${list[1].uri}`);
    expect(presets.currentUri).toBe(list[1].uri);
    expect(instance.preset).toBe(list[1].uri);
    expect(presets.current).toBe(list[1]);
    expect(list[1].isCurrent).toBe(true);
    expect(list[0].isCurrent).toBe(false);
  });
});

describe('presets.load()', () => {
  it('sends the URI, by object or by string, and the model follows the frames', async () => {
    const { presets, calls, state, instance } = await device();
    const list = await presets.list();
    calls.length = 0;

    await presets.load(list[0]);
    await list[1].load();
    await presets.load(list[2].uri);

    expect(state.calls.filter((c) => c.includes('/load/')).map((c) => decodeURIComponent(c.split('uri=')[1]))).toEqual([
      list[0].uri,
      list[1].uri,
      list[2].uri,
    ]);
    expect(instance.preset).toBe(list[2].uri);
    expect(instance.params.get('gain')!.value).toBe(6.5);
  });

  it('tags the frames it provokes as local with the source, and the ones after it as remote', async () => {
    const { presets, socket, instance } = await device();
    const list = await presets.list();
    const seen: Array<[string, unknown, string, unknown]> = [];
    instance.on('preset', (e) => seen.push(['preset', e.preset, e.origin, e.source]));
    instance.on('param', (e) => seen.push(['param', e.value, e.origin, e.source]));

    await presets.load(list[0], { source: 'ui' });
    socket.emit('param_set /graph/Gain gain 9');
    await flush();

    expect(seen).toEqual([
      ['preset', list[0].uri, 'local', 'ui'],
      ['param', 6.5, 'local', 'ui'],
      ['param', 9, 'remote', undefined],
    ]);
  });

  it('does not tag frames of another instance', async () => {
    const { presets, socket, other } = await device();
    const list = await presets.list();
    const origins: string[] = [];
    other.on('param', (e) => origins.push(e.origin));
    await presets.load(list[0]);
    socket.emit('param_set /graph/Gain_1 gain 2');
    await flush();
    expect(origins).toEqual(['remote']);
  });

  it('rejects with the causes when the backend answers false, and stops tagging afterwards', async () => {
    const { presets, state, socket, instance } = await device();
    const list = await presets.list();
    state.loadAnswer = false;
    await expect(presets.load(list[0])).rejects.toThrow(/did not load.*hardware did not answer within 10 s/);

    const origins: string[] = [];
    instance.on('param', (e) => origins.push(e.origin));
    socket.emit('param_set /graph/Gain gain 3');
    await flush();
    expect(origins).toEqual(['remote']);
  });

  it('rejects an unknown URI through the backend, and bad arguments without a request', async () => {
    const { presets, calls } = await device();
    await expect(presets.load('urn:unknown')).rejects.toBeInstanceOf(ModUiError);
    calls.length = 0;
    await expect(presets.load('')).rejects.toBeInstanceOf(ModUiError);
    await expect(presets.load(5 as never)).rejects.toBeInstanceOf(ModUiError);
    expect(calls).toEqual([]);
  });

  it('rejects a preset that is gone, and an instance that is gone, without a request', async () => {
    const { presets, state, socket, calls, instance } = await device();
    const [clean] = await presets.list();
    state.presets = [];
    await presets.list();
    calls.length = 0;
    await expect(clean.load()).rejects.toThrow(/gone/);

    socket.emit(`remove ${path}`);
    await flush();
    expect(instance.alive).toBe(false);
    await expect(presets.load('http://example.org/presets#Clean')).rejects.toThrow(/no plugin/);
    expect(calls).toEqual([]);
  });
});

describe('presets.create()', () => {
  it('saves the live values as a new user preset, becomes current, and tells the model although the backend sends no frame', async () => {
    const { presets, instance, state, calls } = await device();
    await presets.list();
    const seen: Array<[string | null, string, unknown]> = [];
    instance.on('preset', (e) => seen.push([e.preset, e.origin, e.source]));
    calls.length = 0;

    const created = await presets.create('  Warm  ', { source: 'ui' });

    expect(paths(calls)).toEqual(['GET /effect/preset/save_new//graph/Gain', 'GET /effect/get_non_cached']);
    expect(new URL(calls[0].url).searchParams.get('name')).toBe('Warm');
    expect(created).toBeInstanceOf(Preset);
    expect(created).toMatchObject({ label: 'Warm', isUser: true, isCurrent: true });
    expect(created.bundlepath).toBe('/root/.lv2/_graph_Gain-Warm.lv2');
    expect(instance.preset).toBe(created.uri);
    expect(presets.current).toBe(created);
    expect(seen).toEqual([[created.uri, 'local', 'ui']]);
    expect(state.presets).toHaveLength(4);
    expect((await presets.list())[3]).toBe(created);
  });

  it('puts the new preset in the cached description and tells the other instance of the plugin', async () => {
    const { presets, other, instance } = await device();
    await presets.list();
    const events: PresetListEvent[] = [];
    other.presets.on('list', (e) => events.push(e));

    const created = await presets.create('Warm', { source: 7 });

    expect(instance.info?.presets?.map((p) => p.label)).toContain('Warm');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ origin: 'local', source: 7 });
    expect(events[0].presets.map((p) => p.uri)).toContain(created.uri);
    expect(other.presets.current).toBeNull(); // their current preset is unchanged
    expect(other.preset).toBeNull();
  });

  it('checks the name before any request: blank, control characters, backslash', async () => {
    const { presets, calls } = await device();
    calls.length = 0;
    await expect(presets.create('   ')).rejects.toBeInstanceOf(ModUiError);
    await expect(presets.create('two\nlines')).rejects.toThrow(/control characters/);
    await expect(presets.create('ends with \\')).rejects.toThrow(/backslash/);
    await expect(presets.create(5 as never)).rejects.toBeInstanceOf(ModUiError);
    expect(calls).toEqual([]);
  });

  it('rejects when the backend answers ok:false', async () => {
    const { presets } = await device([], { [`GET /effect/preset/save_new/${path}`]: { ok: false } });
    await expect(presets.create('x')).rejects.toThrow(/could not save/);
  });

  it('rejects for an instance that is gone', async () => {
    const { presets, socket } = await device();
    socket.emit(`remove ${path}`);
    await flush();
    await expect(presets.create('x')).rejects.toThrow(/no plugin/);
  });
});

describe('presets.save() / preset.save()', () => {
  async function loaded(name = 'Mine') {
    const made = await device();
    const list = await made.presets.list();
    const preset = list.find((p) => p.label === name)!;
    await made.presets.load(preset);
    made.calls.length = 0;
    return { ...made, preset };
  }

  it('overwrites the current user preset, keeps the object and defaults the name to its label', async () => {
    const { presets, preset, calls, instance } = await loaded();
    const uri = preset.uri;

    const saved = await presets.save(preset);

    expect(saved).toBe(preset);
    expect(preset.uri).toBe(uri.replace(/Mine\.ttl$/, 'Mine.ttl'));
    expect(paths(calls)).toEqual(['GET /effect/preset/save_replace//graph/Gain', 'GET /effect/get_non_cached']);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get('uri')).toBe(uri);
    expect(query.get('bundle')).toBe('/root/.lv2/Gain-Mine.lv2');
    expect(query.get('name')).toBe('Mine');
    expect(instance.preset).toBe(preset.uri);
  });

  it('renames by saving under another name: the object stays, uri and label change, the model gets the new URI', async () => {
    const { presets, preset, instance } = await loaded();
    const seen: Array<string | null> = [];
    instance.on('preset', (e) => seen.push(e.preset));

    await preset.save('Louder', { source: 'ui' });

    expect(preset.label).toBe('Louder');
    expect(preset.uri).toMatch(/Louder\.ttl$/);
    expect(instance.preset).toBe(preset.uri);
    expect(seen).toEqual([preset.uri]);
    expect(preset.isCurrent).toBe(true);
    expect((await presets.list())[2]).toBe(preset);
  });

  it('refuses a factory preset and a preset that is not current, without a request', async () => {
    const { presets, calls } = await device();
    const [clean, , mine] = await presets.list();
    await presets.load(clean);
    calls.length = 0;
    await expect(presets.save(clean)).rejects.toThrow(/factory preset/);
    await expect(presets.save(mine)).rejects.toThrow(/not the current preset/);
    expect(paths(calls)).toEqual([]);
  });

  it('checks the new name before any request', async () => {
    const { presets, preset, calls } = await loaded();
    await expect(presets.save(preset, '')).rejects.toBeInstanceOf(ModUiError);
    await expect(presets.save(preset, 'a\\')).rejects.toBeInstanceOf(ModUiError);
    expect(calls).toEqual([]);
  });

  it('reads the list again when the backend fails, because the preset can be lost', async () => {
    const { presets, preset, state, calls } = await loaded();
    state.failReplace = true;
    await expect(presets.save(preset)).rejects.toThrow(/may have been lost/);
    expect(paths(calls)).toEqual(['GET /effect/preset/save_replace//graph/Gain', 'GET /effect/get_non_cached']);
    expect(preset.alive).toBe(false);
  });

  it('rejects a preset that is gone', async () => {
    const { presets, preset, state } = await loaded();
    state.presets = [];
    await presets.list();
    await expect(preset.save()).rejects.toThrow(/gone/);
  });
});

describe('presets.delete() / preset.delete()', () => {
  it('deletes the current user preset: the model gets null as a local change, the object dies, the list is read again', async () => {
    const { presets, instance, calls, state } = await device();
    const list = await presets.list();
    const mine = list[2];
    await presets.load(mine);
    const seen: Array<[string | null, string, unknown]> = [];
    instance.on('preset', (e) => seen.push([e.preset, e.origin, e.source]));
    const events: PresetListEvent[] = [];
    presets.on('list', (e) => events.push(e));
    calls.length = 0;

    await mine.delete({ source: 'trash' });

    expect(paths(calls)).toEqual(['GET /effect/preset/delete//graph/Gain', 'GET /effect/get_non_cached']);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get('uri')).toBe(mine.uri);
    expect(query.get('bundle')).toBe('/root/.lv2/Gain-Mine.lv2');
    expect(seen).toEqual([[null, 'local', 'trash']]);
    expect(instance.preset).toBeNull();
    expect(mine.alive).toBe(false);
    expect(state.presets).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect((await presets.list()).length).toBe(2);
  });

  it('refuses factory presets, and presets that are not current, without a request', async () => {
    const { presets, calls } = await device();
    const [clean, , mine] = await presets.list();
    await presets.load(clean);
    calls.length = 0;
    await expect(presets.delete(clean)).rejects.toThrow(/factory preset/);
    await expect(presets.delete(mine)).rejects.toThrow(/not the current preset/);
    expect(calls).toEqual([]);
  });

  it('rejects when the backend answers false, and the preset stays alive', async () => {
    const { presets } = await device(undefined, { [`GET /effect/preset/delete/${path}`]: false });
    const mine = (await presets.list())[2];
    await presets.load(mine);
    await expect(mine.delete()).rejects.toThrow(/could not delete/);
    expect(mine.alive).toBe(true);
  });
});

describe('queue and lifetime', () => {
  it('queues writes in order behind each other', async () => {
    const { presets, calls } = await device();
    const list = await presets.list();
    calls.length = 0;
    const created = presets.create('One');
    const loaded = presets.load(list[0]);
    await Promise.all([created, loaded]);
    expect(paths(calls).filter((p) => p.includes('/preset/'))).toEqual([
      'GET /effect/preset/save_new//graph/Gain',
      'GET /effect/preset/load//graph/Gain',
    ]);
  });

  it('a Preset stops being alive when its instance is removed or another pedalboard is loaded', async () => {
    const { presets, socket } = await device();
    const [clean] = await presets.list();
    expect(clean.alive).toBe(true);
    socket.emit('loading_start 0 0');
    socket.emit('loading_end 0');
    await flush();
    expect(clean.alive).toBe(false);
    await expect(clean.load()).rejects.toThrow(/no plugin/);
  });

  it('list subscriptions honour ignoreLocal and end with the instance', async () => {
    const { presets, socket } = await device();
    await presets.list();
    const all: string[] = [];
    const remote: string[] = [];
    presets.on('list', (e) => all.push(e.origin));
    presets.on('list', (e) => remote.push(e.origin), { ignoreLocal: true });

    await presets.create('Warm');
    expect(all).toEqual(['local']);
    expect(remote).toEqual([]);

    socket.emit(`remove ${path}`);
    await flush();
    const dead: PluginInstance = presets.instance;
    expect(dead.alive).toBe(false);
    expect(presets.on('list', () => undefined)).toBeTypeOf('function');
  });
});
