// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ModUiError, Snapshot, type SnapshotCurrentEvent, type SnapshotListEvent } from '../src';
import {
  connectedAt,
  fakeSnapshotBackend,
  flush,
  gainInfo,
  gainUri,
  makeClient,
  pluginSummaries,
  setupFakes,
  FakeWebSocket,
} from './helpers';

setupFakes();

const gainFrame = `add /graph/Gain ${gainUri} 10.0 20.0 0 1.0.0.0 0`;

/** A device whose pedalboard has the given snapshots; `current` is what `loading_end` reports. */
async function device(names = ['Default', 'Clean', 'Lead'], current = 0) {
  const backend = fakeSnapshotBackend(names, current);
  const made = makeClient({
    ...backend.routes,
    'GET /effect/list': pluginSummaries,
    'POST /effect/bulk/': { [gainUri]: gainInfo },
  });
  const socket = await connectedAt(made.client, current, [gainFrame]);
  const snapshots = made.client.device.currentPedalboard.snapshots;
  await made.client.device.currentPedalboard.plugins.list(); // the store delivered `loaded`
  return { ...made, ...backend, socket, snapshots };
}

const writes = (calls: Array<{ method: string; url: string }>) =>
  calls.filter((c) => c.url.includes('/snapshot/')).map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`);

/** Records the events of both kinds. */
function record(snapshots: Awaited<ReturnType<typeof device>>['snapshots']) {
  const current: SnapshotCurrentEvent[] = [];
  const list: SnapshotListEvent[] = [];
  snapshots.on('current', (e) => current.push(e));
  snapshots.on('list', (e) => list.push(e));
  return { current, list };
}

describe('snapshots.list() / get()', () => {
  it('reads the names, ordered by index (keys are strings), as Snapshot objects', async () => {
    const { snapshots, calls } = await device(['Default', 'Clean', 'Lead', 'Solo', 'Crunch', 'Dirty', 'Ambient', 'Drive', 'Fx', 'Last']);
    const list = await snapshots.list();

    expect(list.map((s) => [s.index, s.name])).toEqual([
      [0, 'Default'], [1, 'Clean'], [2, 'Lead'], [3, 'Solo'], [4, 'Crunch'], [5, 'Dirty'], [6, 'Ambient'], [7, 'Drive'], [8, 'Fx'], [9, 'Last'],
    ]);
    expect(list[0]).toBeInstanceOf(Snapshot);
    expect(writes(calls)).toEqual(['GET /snapshot/list']);
  });

  it('keeps the same objects across reads, and get() finds one by index without GET /snapshot/name', async () => {
    const { snapshots, calls } = await device();
    const first = await snapshots.list();
    const second = await snapshots.list();

    expect(second[1]).toBe(first[1]);
    expect(await snapshots.get(2)).toBe(first[2]);
    expect(await snapshots.get(7)).toBeUndefined();
    expect(calls.some((c) => c.url.includes('/snapshot/name'))).toBe(false);
  });

  it('reconciles by name: a change made elsewhere keeps the objects that survive and retires the others', async () => {
    const { snapshots, state } = await device();
    const [def, clean, lead] = await snapshots.list();
    const { list } = record(snapshots);

    state.names = ['Default', 'Lead', 'Brand new']; // "Clean" removed, "Brand new" added by another client
    const after = await snapshots.list();

    expect(after[0]).toBe(def);
    expect(after[1]).toBe(lead);
    expect(lead.index).toBe(1);
    expect(clean.alive).toBe(false);
    expect(clean.name).toBe('Clean'); // the last known values stay readable
    expect(after[2].name).toBe('Brand new');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ origin: 'remote' });
  });

  it('emits no event when the list is read again unchanged', async () => {
    const { snapshots } = await device();
    await snapshots.list();
    const { list, current } = record(snapshots);
    await snapshots.list();
    expect(list).toEqual([]);
    expect(current).toEqual([]);
  });

  it('rejects a bad index in get() without failing, returning undefined', async () => {
    const { snapshots } = await device();
    expect(await snapshots.get(-1)).toBeUndefined();
  });
});

describe('current snapshot', () => {
  it('is known as an index from loading_end, before the names are read, and as an object after list()', async () => {
    const { snapshots } = await device(['Default', 'Clean', 'Lead'], 1);
    expect(snapshots.currentIndex).toBe(1);
    expect(snapshots.current).toBeNull();

    const list = await snapshots.list();
    expect(snapshots.current).toBe(list[1]);
    expect(list[1].isCurrent).toBe(true);
    expect(list[0].isCurrent).toBe(false);
  });

  it('follows the device report pedal_snapshot (name with spaces), tagged remote', async () => {
    const { snapshots, socket } = await device();
    const [, clean, lead] = await snapshots.list();
    const { current, list } = record(snapshots);

    socket.emit('pedal_snapshot 2 Lead');
    expect(snapshots.currentIndex).toBe(2);
    expect(snapshots.current).toBe(lead);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ snapshot: lead, index: 2, previous: 0, origin: 'remote' });
    expect(list).toEqual([]);

    // a name that differs from the known one updates the list
    socket.emit('pedal_snapshot 1 Clean tone');
    expect(clean.name).toBe('Clean tone');
    expect(list).toHaveLength(1);
  });

  it('marks the list stale when the device reports a snapshot it has not seen', async () => {
    const { snapshots, socket, state } = await device();
    await snapshots.list();
    state.names.push('Added by the HMI');
    socket.emit('pedal_snapshot 3 Added by the HMI');

    expect(snapshots.currentIndex).toBe(3);
    expect(snapshots.current).toBeNull(); // names not trusted any more
    const list = await snapshots.list();
    expect(snapshots.current).toBe(list[3]);
  });

  it('ignores a malformed pedal_snapshot', async () => {
    const { snapshots, socket } = await device();
    socket.emit('pedal_snapshot nope');
    socket.emit('pedal_snapshot -1 x');
    expect(snapshots.currentIndex).toBe(0);
  });
});

describe('snapshots.create()', () => {
  it('creates a snapshot, makes it current and returns the object with the unique name; no list request after the first read', async () => {
    const { snapshots, calls } = await device();
    const before = await snapshots.list();
    const { current, list } = record(snapshots);

    const created = await snapshots.create('Lead', { source: 'ui' });

    expect(created.name).toBe('Lead (2)');
    expect(created.index).toBe(3);
    expect(created.isCurrent).toBe(true);
    expect(snapshots.current).toBe(created);
    expect(writes(calls)).toEqual(['GET /snapshot/list', 'GET /snapshot/saveas?title=Lead']);
    expect(await snapshots.list()).toEqual([...before, created]);
    expect(list[0]).toMatchObject({ origin: 'local', source: 'ui' });
    expect(current[0]).toMatchObject({ snapshot: created, index: 3, previous: 0, origin: 'local', source: 'ui' });
  });

  it('reads the list itself when the names were never read', async () => {
    const { snapshots, calls } = await device();
    const created = await snapshots.create('Solo');

    expect(writes(calls)).toEqual(['GET /snapshot/saveas?title=Solo', 'GET /snapshot/list']);
    expect(created.index).toBe(3);
    expect(created.name).toBe('Solo');
    expect(snapshots.current).toBe(created);
  });

  it('refuses a blank name without a request', async () => {
    const { snapshots, calls } = await device();
    await expect(snapshots.create('   ')).rejects.toBeInstanceOf(ModUiError);
    expect(writes(calls)).toEqual([]);
  });

  it('rejects when the backend cannot create it', async () => {
    const { client } = makeClient({ 'GET /snapshot/saveas': { ok: false, id: null, title: 'x' } });
    await connectedAt(client, 0);
    await expect(client.device.currentPedalboard.snapshots.create('x')).rejects.toThrow(/could not create/);
  });
});

describe('snapshots.save()', () => {
  it('overwrites the current snapshot', async () => {
    const { snapshots, state, calls } = await device(['A', 'B'], 1);
    await snapshots.save();
    expect(state.saved).toBe(1);
    expect(writes(calls)).toEqual(['POST /snapshot/save']);
  });

  it('is refused without a request when there is no current snapshot', async () => {
    const { snapshots, calls } = await device(['A', 'B'], 1);
    const [, b] = await snapshots.list();
    await snapshots.list();
    await b.delete(); // the current one: the backend now has -1
    expect(snapshots.currentIndex).toBeNull();

    calls.length = 0;
    await expect(snapshots.save()).rejects.toThrow(/no current snapshot/);
    expect(calls).toEqual([]);
  });

  it('rejects when the backend answers false', async () => {
    const { client } = makeClient({ 'POST /snapshot/save': false });
    await connectedAt(client, 0);
    await expect(client.device.currentPedalboard.snapshots.save()).rejects.toBeInstanceOf(ModUiError);
  });
});

describe('snapshot.rename()', () => {
  it('renames and resolves with the unique name the backend chose', async () => {
    const { snapshots, calls } = await device();
    const [, clean] = await snapshots.list();
    const { list } = record(snapshots);

    expect(await clean.rename('Lead')).toBe('Lead (2)');
    expect(clean.name).toBe('Lead (2)');
    expect(list).toHaveLength(1);
    expect(writes(calls).slice(-1)).toEqual(['GET /snapshot/rename?id=1&title=Lead']);
  });

  it('keeps the object when renamed through the client', async () => {
    const { snapshots } = await device();
    const [, clean] = await snapshots.list();
    await clean.rename('Shiny');
    expect((await snapshots.list())[1]).toBe(clean);
  });

  it('refuses a blank name, and a snapshot that is gone, without a request', async () => {
    const { snapshots, calls } = await device();
    const [def, clean] = await snapshots.list();
    calls.length = 0;
    await expect(clean.rename('')).rejects.toBeInstanceOf(ModUiError);
    await clean.delete();
    calls.length = 0;
    await expect(clean.rename('Again')).rejects.toThrow(/gone/);
    expect(calls).toEqual([]);
    expect(def.alive).toBe(true);
  });

  it('rejects when the backend answers ok:false', async () => {
    const { client } = makeClient({ 'GET /snapshot/list': { '0': 'A' }, 'GET /snapshot/rename': { ok: false, title: 'x' } });
    await connectedAt(client, 0);
    const [a] = await client.device.currentPedalboard.snapshots.list();
    await expect(a.rename('x')).rejects.toBeInstanceOf(ModUiError);
  });
});

describe('snapshot.delete()', () => {
  it('removes it, shifts the later indices and retires the object', async () => {
    const { snapshots, calls } = await device(['A', 'B', 'C', 'D'], 3);
    const [a, b, c, d] = await snapshots.list();
    const { list } = record(snapshots);

    await b.delete();

    expect(b.alive).toBe(false);
    expect([a.index, c.index, d.index]).toEqual([0, 1, 2]);
    expect(await snapshots.list()).toEqual([a, c, d]);
    expect(list[0].snapshots).toEqual([a, c, d]);
    expect(writes(calls)).toContain('GET /snapshot/remove?id=1');
  });

  it('clears the current index when the current one is removed', async () => {
    const { snapshots } = await device(['A', 'B'], 1);
    const [, b] = await snapshots.list();
    const { current } = record(snapshots);
    await b.delete();
    expect(snapshots.currentIndex).toBeNull();
    expect(snapshots.current).toBeNull();
    expect(current[0]).toMatchObject({ snapshot: null, index: null, previous: 1 });
  });

  it('mirrors the backend when an earlier snapshot is removed: the current index keeps its number', async () => {
    const { snapshots, state } = await device(['A', 'B', 'C'], 2);
    const [a, , c] = await snapshots.list();
    await a.delete();
    expect(state.current).toBe(2); // the backend's own number
    expect(snapshots.currentIndex).toBe(2);
    expect(c.index).toBe(1);
    expect(snapshots.current).toBeNull(); // out of range now: nothing at index 2
  });

  it('refuses the last snapshot without a request', async () => {
    const { snapshots, calls } = await device(['Only']);
    const [only] = await snapshots.list();
    calls.length = 0;
    await expect(only.delete()).rejects.toThrow(/last snapshot/);
    expect(calls).toEqual([]);
  });

  it('rejects when the backend answers false', async () => {
    const { client } = makeClient({ 'GET /snapshot/list': { '0': 'A', '1': 'B' }, 'GET /snapshot/remove': false });
    await connectedAt(client, 0);
    const [a] = await client.device.currentPedalboard.snapshots.list();
    await expect(a.delete()).rejects.toBeInstanceOf(ModUiError);
    expect(a.alive).toBe(true);
  });
});

describe('snapshots.load()', () => {
  it('applies a snapshot given by index or object, and makes it current', async () => {
    const { snapshots, state, calls } = await device();
    const [, clean, lead] = await snapshots.list();
    const { current } = record(snapshots);

    await snapshots.load(1);
    await lead.load({ source: 'pedal' });

    expect(state.loads).toEqual([1, 2]);
    expect(snapshots.current).toBe(lead);
    expect(current.map((e) => [e.index, e.origin, e.source])).toEqual([[1, 'local', undefined], [2, 'local', 'pedal']]);
    expect(writes(calls).filter((c) => c.includes('load'))).toEqual(['GET /snapshot/load?id=1', 'GET /snapshot/load?id=2']);
    expect(clean.isCurrent).toBe(false);
  });

  it('tags the value frames it provokes as local with the source, and not the ones after it', async () => {
    const { snapshots, socket, state, client } = await device();
    const gain = (await client.device.currentPedalboard.plugins.list())[0];
    const seen: Array<[number | boolean, string, unknown]> = [];
    gain.on('param', (e) => seen.push([e.value, e.origin, e.source]));
    gain.on('active', (e) => seen.push([e.active, e.origin, e.source]));
    state.onLoad = () => {
      socket.emit('pedal_snapshot 1 Clean');
      socket.emit('param_set /graph/Gain gain 6');
      socket.emit('param_set /graph/Gain :bypass 1');
    };

    await snapshots.load(1, { source: 'ui' });
    socket.emit('param_set /graph/Gain gain 9');
    await flush();

    expect(seen).toEqual([[6, 'local', 'ui'], [false, 'local', 'ui'], [9, 'remote', undefined]]);
    expect(gain.params.get('gain')!.value).toBe(9);
  });

  it('tags the pedal_snapshot frame it provokes as local', async () => {
    const { snapshots, socket, state } = await device();
    await snapshots.list();
    const { current } = record(snapshots);
    state.onLoad = () => socket.emit('pedal_snapshot 2 Lead');
    await snapshots.load(2, { source: 'x' });
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ index: 2, origin: 'local', source: 'x' });
  });

  it('rejects an index that is not a non-negative integer without a request', async () => {
    const { snapshots, calls } = await device();
    await expect(snapshots.load(-1)).rejects.toBeInstanceOf(ModUiError);
    await expect(snapshots.load(1.5)).rejects.toBeInstanceOf(ModUiError);
    await expect(snapshots.load('1' as unknown as number)).rejects.toBeInstanceOf(ModUiError);
    expect(calls.filter((c) => c.url.includes('/snapshot/'))).toEqual([]);
  });

  it('rejects an index out of range once the names are known, without a request', async () => {
    const { snapshots, calls } = await device();
    await snapshots.list();
    calls.length = 0;
    await expect(snapshots.load(9)).rejects.toThrow(/no snapshot 9/);
    expect(calls).toEqual([]);
  });

  it('rejects when the backend answers false (unknown index when the names were not read, or interrupted)', async () => {
    const { snapshots } = await device();
    await expect(snapshots.load(9)).rejects.toThrow(/did not apply/);
    expect(snapshots.currentIndex).toBe(0);
  });

  it('stops tagging frames after a failed request', async () => {
    const { snapshots, socket, client } = await device();
    const gain = (await client.device.currentPedalboard.plugins.list())[0];
    const origins: string[] = [];
    gain.on('param', (e) => origins.push(e.origin));
    await expect(snapshots.load(9)).rejects.toBeInstanceOf(ModUiError);
    socket.emit('param_set /graph/Gain gain 3');
    await flush();
    expect(origins).toEqual(['remote']);
  });
});

describe('pedalboard loads and resets', () => {
  it('a new pedalboard replaces the list: old objects die, list is emptied, current follows loading_end', async () => {
    const { snapshots, socket } = await device();
    const [def] = await snapshots.list();
    const { list, current } = record(snapshots);

    socket.emit('loading_start 0 0');
    socket.emit('loading_end 1');
    await flush();

    expect(def.alive).toBe(false);
    expect(snapshots.currentIndex).toBe(1);
    expect(snapshots.current).toBeNull();
    expect(list).toHaveLength(1);
    expect(list[0].snapshots).toEqual([]);
    expect(current.map((e) => e.index)).toEqual([null, 1]);
    await expect(def.load()).rejects.toThrow(/gone/);
  });

  it('device.reset() leaves one snapshot, the current index 0', async () => {
    const { snapshots, socket } = await device(['A', 'B'], 1);
    const [a] = await snapshots.list();
    socket.emit('remove :all');
    await flush();
    expect(a.alive).toBe(false);
    expect(snapshots.currentIndex).toBe(0);
  });

  it('the first connection seeds the current index from loading_end', async () => {
    const { snapshots } = await device(['A', 'B', 'C'], 2);
    expect(snapshots.currentIndex).toBe(2);
  });
});

describe('queue and events', () => {
  it('runs writes in order behind earlier ones', async () => {
    const { snapshots, calls } = await device();
    const created = snapshots.create('One');
    const loaded = snapshots.load(0);
    await Promise.all([created, loaded]);
    const order = writes(calls).filter((c) => !c.includes('list'));
    expect(order).toEqual(['GET /snapshot/saveas?title=One', 'GET /snapshot/load?id=0']);
  });

  it('honours ignoreLocal, ignoreSource and once', async () => {
    const { snapshots } = await device();
    await snapshots.list();
    const mine = Symbol('mine');
    const seen: unknown[] = [];
    snapshots.on('current', (e) => seen.push(['all', e.index]));
    snapshots.on('current', (e) => seen.push(['remote', e.index]), { ignoreLocal: true });
    snapshots.on('current', (e) => seen.push(['notMine', e.index]), { ignoreSource: mine });
    snapshots.once('current', (e) => seen.push(['once', e.index]));

    await snapshots.load(1, { source: mine });
    await snapshots.load(2);

    expect(seen).toEqual([['all', 1], ['once', 1], ['all', 2], ['notMine', 2]]);
  });
});

describe('shared WebSocket', () => {
  it('uses the snapshot id of the state read through the second socket', async () => {
    const backend = fakeSnapshotBackend(['A', 'B', 'C'], 2);
    const shared = {
      readyState: 1,
      send: () => undefined,
      close: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const { client } = makeClient({ ...backend.routes }, { webSocket: shared as never });
    const pending = client.device.currentPedalboard.snapshots.list();
    await flush();
    const second = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    second.open();
    second.emit('loading_start 0 0');
    second.emit('loading_end 2');
    const list = await pending;
    expect(client.device.currentPedalboard.snapshots.currentIndex).toBe(2);
    expect(list.map((s) => s.name)).toEqual(['A', 'B', 'C']);
  });
});
