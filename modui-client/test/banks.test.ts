// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { Bank, ModUiError, ModUiHttpError, type PedalboardReference, type PedalboardSummary } from '../src';
import { infoBody, makeClient, setupFakes, type Call } from './helpers';

setupFakes();

function summary(name: string, extra: Partial<PedalboardSummary> = {}): PedalboardSummary {
  return {
    broken: false,
    factory: false,
    hasTrialPlugins: false,
    uri: `file:///root/.pedalboards/${name}.pedalboard/${name}.ttl`,
    bundle: `/root/.pedalboards/${name}.pedalboard`,
    title: name,
    version: 1,
    ...extra,
  };
}

const library: PedalboardSummary[] = [
  summary('A'),
  summary('B'),
  summary('C'),
  summary('Rock', { factory: true, bundle: '/usr/share/mod/pedalboards/Rock.pedalboard' }),
  summary('Broken', { broken: true }),
  summary('Default', { bundle: '/root/.pedalboards/default.pedalboard' }),
];

type StoredBank = { title: string; pedalboards: Array<{ bundle: string; title: string }>; [extra: string]: unknown };

/** The banks endpoints: a stored list that `GET /banks` enriches with the library, and `POST /banks/save` replaces. */
function backend(initial: StoredBank[], options: { saveAnswer?: unknown } = {}) {
  const state = { banks: initial.map((bank) => ({ ...bank })), saves: [] as StoredBank[][], library: [...library] };
  const routes = {
    'GET /banks': () =>
      state.banks.map((bank) => ({
        ...bank,
        pedalboards: bank.pedalboards.map((pb) => state.library.find((item) => item.bundle === pb.bundle)).filter(Boolean),
      })),
    'POST /banks/save': (call: Call) => {
      const body = JSON.parse(call.body!) as StoredBank[];
      state.saves.push(body);
      state.banks = body;
      return options.saveAnswer ?? true;
    },
    'GET /pedalboard/list': () => state.library,
    'GET /pedalboard/info/': () => ({ ...infoBody, title: 'Rock' }),
    'GET /pedalboard/factorycopy/': () => {
      const copy = summary('Rock_2_', { title: 'Rock (2)' });
      state.library.push(copy);
      return { ...infoBody, title: 'Rock (2)', bundlepath: copy.bundle };
    },
  };
  return { state, routes };
}

const stored = (name: string) => ({ bundle: `/root/.pedalboards/${name}.pedalboard`, title: name });

async function setup(initial: StoredBank[] = [{ title: 'Live', pedalboards: [stored('A'), stored('B')] }, { title: 'Studio', pedalboards: [] }]) {
  const fake = backend(initial);
  const made = makeClient(fake.routes);
  const references = await made.client.pedalboards.list();
  const pb = (title: string) => references.find((ref) => ref.title === title) as PedalboardReference;
  return { ...made, ...fake, pb };
}

const requests = (calls: Call[]) => calls.filter((c) => c.url.includes('/banks')).map((c) => `${c.method} ${new URL(c.url).pathname}`);

describe('banks.list() / get()', () => {
  it('lists the banks with their pedalboards as library entries that device.load() accepts', async () => {
    const { client, calls } = await setup();
    const banks = await client.banks.list();

    expect(banks.map((b) => [b.title, b.index, b.pedalboards.map((p) => p.title)])).toEqual([
      ['Live', 0, ['A', 'B']],
      ['Studio', 1, []],
    ]);
    expect(banks[0]).toBeInstanceOf(Bank);
    expect(banks[0].pedalboards[0].bundlepath).toBe('/root/.pedalboards/A.pedalboard');
    expect(typeof banks[0].pedalboards[0].info).toBe('function');
    expect(requests(calls)).toEqual(['GET /banks']);
  });

  it('get() ignores case and returns undefined for an unknown title', async () => {
    const { client } = await setup();
    expect((await client.banks.get('live'))?.title).toBe('Live');
    expect(await client.banks.get('nope')).toBeUndefined();
  });

  it('is an empty list when there are no banks', async () => {
    const { client } = await setup([]);
    expect(await client.banks.list()).toEqual([]);
  });
});

describe('editing a bank is one read and one write of the whole list', () => {
  it('rename', async () => {
    const { client, calls, state } = await setup();
    const [live] = await client.banks.list();
    calls.length = 0;

    await live.rename('  Gig  ');

    expect(requests(calls)).toEqual(['GET /banks', 'POST /banks/save']);
    expect(state.saves[0].map((b) => b.title)).toEqual(['Gig', 'Studio']);
    expect(live.title).toBe('Gig');
    expect(live.pedalboards.map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('remove', async () => {
    const { client, state } = await setup();
    const [live, studio] = await client.banks.list();
    await live.remove();
    expect(state.saves[0].map((b) => b.title)).toEqual(['Studio']);
    await expect(live.rename('x')).rejects.toThrow(/no longer exists/);
    expect(studio.index).toBe(1); // objects not involved are not touched; read again to see the new positions
  });

  it('add appends by default and inserts at a position, sending { bundle, title }', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();

    await live.add(pb('C'));
    await live.add(pb('C'), { at: 0 });

    expect(state.saves[0][0].pedalboards).toEqual([stored('A'), stored('B'), stored('C')]);
    expect(state.saves[1][0].pedalboards).toEqual([stored('C'), stored('A'), stored('B'), stored('C')]);
    expect(live.pedalboards.map((p) => p.title)).toEqual(['C', 'A', 'B', 'C']);
  });

  it('removePedalboard by position or by pedalboard (first occurrence)', async () => {
    const { client, state, pb } = await setup([{ title: 'Live', pedalboards: [stored('A'), stored('B'), stored('A')] }]);
    const [live] = await client.banks.list();

    await live.removePedalboard(1);
    await live.removePedalboard(pb('A'));

    expect(state.saves[0][0].pedalboards.map((p) => p.title)).toEqual(['A', 'A']);
    expect(state.saves[1][0].pedalboards.map((p) => p.title)).toEqual(['A']);
  });

  it('movePedalboard', async () => {
    const { client, state } = await setup([{ title: 'Live', pedalboards: [stored('A'), stored('B'), stored('C')] }]);
    const [live] = await client.banks.list();
    await live.movePedalboard(0, 2);
    expect(state.saves[0][0].pedalboards.map((p) => p.title)).toEqual(['B', 'C', 'A']);
    expect(live.pedalboards.map((p) => p.title)).toEqual(['B', 'C', 'A']);
  });

  it('setPedalboards replaces the content, and may empty the bank', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();
    await live.setPedalboards([pb('C'), pb('A')]);
    await live.setPedalboards([]);
    expect(state.saves[0][0].pedalboards.map((p) => p.title)).toEqual(['C', 'A']);
    expect(state.saves[1][0].pedalboards).toEqual([]);
  });

  it('a new array of pedalboards after every change (the old one is not mutated)', async () => {
    const { client, pb } = await setup();
    const [live] = await client.banks.list();
    const before = live.pedalboards;
    await live.add(pb('C'));
    expect(live.pedalboards).not.toBe(before);
    expect(before.map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('edits the current state of its bank, whatever the object read before', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();
    state.banks[0].pedalboards.push(stored('C')); // another client added one meanwhile

    await live.add(pb('B'));

    expect(state.saves[0][0].pedalboards.map((p) => p.title)).toEqual(['A', 'B', 'C', 'B']);
  });

  it('keeps properties of the stored banks the client does not know', async () => {
    const { client, state, pb } = await setup([{ title: 'Live', pedalboards: [stored('A')], color: 'red', order: 3 }]);
    const [live] = await client.banks.list();
    await live.add(pb('B'));
    expect(state.saves[0][0]).toEqual({ title: 'Live', pedalboards: [stored('A'), stored('B')], color: 'red', order: 3 });
  });

  it('a bank that disappeared between the read and the write is an error, and nothing is written', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();
    state.banks = state.banks.filter((b) => b.title !== 'Live');
    await expect(live.add(pb('C'))).rejects.toThrow(/no longer exists/);
    expect(state.saves).toEqual([]);
  });

  it('queues the calls of one client in order, each reading what the one before wrote', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();
    await Promise.all([live.add(pb('C')), live.add(pb('A')), live.movePedalboard(0, 3)]);
    expect(state.banks[0].pedalboards.map((p) => p.title)).toEqual(['B', 'C', 'A', 'A']);
  });

  it('a failed call does not block the next one', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();
    const failing = live.movePedalboard(0, 9);
    const fine = live.add(pb('C'));
    await expect(failing).rejects.toBeInstanceOf(ModUiError);
    await fine;
    expect(state.saves).toHaveLength(1);
  });
});

describe('rules checked before anything is written', () => {
  it('blank and duplicate titles (ignoring case)', async () => {
    const { client, state } = await setup();
    const [live] = await client.banks.list();
    await expect(live.rename('   ')).rejects.toBeInstanceOf(ModUiError);
    await expect(live.rename('STUDIO')).rejects.toThrow(/already a bank/);
    await live.rename('LIVE'); // its own title, other case: allowed
    await expect(client.banks.create('studio')).rejects.toThrow(/already a bank/);
    await expect(client.banks.create('')).rejects.toBeInstanceOf(ModUiError);
    expect(state.saves).toHaveLength(1);
  });

  it('factory, default and broken pedalboards are refused, pointing to copy()', async () => {
    const { client, state, pb, calls } = await setup();
    const [live] = await client.banks.list();
    calls.length = 0;
    await expect(live.add(pb('Rock'))).rejects.toThrow(/copy/);
    await expect(live.add(pb('Default'))).rejects.toThrow(/copy/);
    await expect(live.add(pb('Broken'))).rejects.toThrow(/broken/);
    await expect(live.setPedalboards([pb('A'), pb('Rock')])).rejects.toThrow(/copy/);
    await expect(live.add({ bundlepath: '/x' } as unknown as PedalboardReference)).rejects.toThrow(/library/);
    expect(calls).toEqual([]);
    expect(state.saves).toEqual([]);
  });

  it('copyFactory copies first and puts the copy in the bank', async () => {
    const { client, state, pb, calls } = await setup();
    const [live] = await client.banks.list();
    calls.length = 0;

    await live.add(pb('Rock'), { copyFactory: true });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /pedalboard/info/',
      'GET /pedalboard/factorycopy/',
      'GET /pedalboard/list',
      'GET /banks',
      'POST /banks/save',
    ]);
    expect(state.saves[0][0].pedalboards[2]).toEqual({
      bundle: '/root/.pedalboards/Rock_2_.pedalboard',
      title: 'Rock (2)',
    });
  });

  it('copyFactory leaves a user pedalboard alone', async () => {
    const { client, pb, calls } = await setup();
    const [live] = await client.banks.list();
    calls.length = 0;
    await live.add(pb('C'), { copyFactory: true });
    expect(calls.some((c) => c.url.includes('factorycopy'))).toBe(false);
  });

  it('positions out of range', async () => {
    const { client, state, pb } = await setup();
    const [live] = await client.banks.list();
    await expect(live.add(pb('C'), { at: 3 })).rejects.toThrow(/out of range/);
    await expect(live.add(pb('C'), { at: -1 })).rejects.toThrow(/out of range/);
    await expect(live.removePedalboard(2)).rejects.toThrow(/out of range/);
    await expect(live.removePedalboard(pb('C'))).rejects.toThrow(/not in the bank/);
    await expect(live.movePedalboard(0, 2)).rejects.toThrow(/out of range/);
    await expect(live.movePedalboard(1.5, 0)).rejects.toThrow(/out of range/);
    expect(state.saves).toEqual([]);
  });

  it('a false answer from the backend is an error', async () => {
    const fake = backend([{ title: 'Live', pedalboards: [] }], { saveAnswer: false });
    const { client } = makeClient(fake.routes);
    const [live] = await client.banks.list();
    await expect(live.rename('x')).rejects.toThrow(/did not save/);
  });

  it('an HTTP error is a ModUiHttpError', async () => {
    const { client } = makeClient({});
    await expect(client.banks.list()).rejects.toBeInstanceOf(ModUiHttpError);
  });
});

describe('banks.create() / move() / save()', () => {
  it('create appends a bank with its pedalboards', async () => {
    const { client, state, pb } = await setup();
    const created = await client.banks.create('  Solo  ', [pb('C')]);

    expect(state.saves[0].map((b) => b.title)).toEqual(['Live', 'Studio', 'Solo']);
    expect(state.saves[0][2].pedalboards).toEqual([stored('C')]);
    expect(created).toMatchObject({ title: 'Solo', index: 2 });
    expect(created.pedalboards.map((p) => p.title)).toEqual(['C']);
  });

  it('move reorders the banks and updates the object', async () => {
    const { client, state } = await setup([
      { title: 'One', pedalboards: [] },
      { title: 'Two', pedalboards: [] },
      { title: 'Three', pedalboards: [] },
    ]);
    const [one] = await client.banks.list();

    const after = await client.banks.move(one, 2);
    expect(state.banks.map((b) => b.title)).toEqual(['Two', 'Three', 'One']);
    expect(one.index).toBe(2);
    expect(after.map((b) => b.title)).toEqual(['Two', 'Three', 'One']);

    await client.banks.move('three', 0);
    expect(state.banks.map((b) => b.title)).toEqual(['Three', 'Two', 'One']);
    await expect(client.banks.move('One', 3)).rejects.toThrow(/out of range/);
    await expect(client.banks.move('Nope', 0)).rejects.toThrow(/no longer exists/);
  });

  it('save writes exactly what it is given, without reading first', async () => {
    const { client, state, pb, calls } = await setup();
    calls.length = 0;
    await client.banks.save([
      { title: 'New', pedalboards: [pb('A'), { bundle: '/root/.pedalboards/Z.pedalboard', title: 'Z' }], color: 'blue' } as never,
    ]);

    expect(requests(calls)).toEqual(['POST /banks/save']);
    expect(calls[0].body).toBe(
      JSON.stringify([{ color: 'blue', title: 'New', pedalboards: [stored('A'), { bundle: '/root/.pedalboards/Z.pedalboard', title: 'Z' }] }]),
    );
    expect(state.banks).toHaveLength(1);
  });

  it('save takes Bank objects and keeps their extra properties', async () => {
    const { client, state } = await setup([{ title: 'Live', pedalboards: [stored('A')], color: 'red' }]);
    const banks = await client.banks.list();
    await client.banks.save(banks);
    expect(state.saves[0]).toEqual([{ title: 'Live', pedalboards: [stored('A')], color: 'red' }]);
  });

  it('save refuses blank or repeated titles, bad entries and unusable pedalboards, without a request', async () => {
    const { client, pb, calls } = await setup();
    calls.length = 0;
    await expect(client.banks.save([{ title: '', pedalboards: [] }])).rejects.toBeInstanceOf(ModUiError);
    await expect(client.banks.save([{ title: 'a', pedalboards: [] }, { title: 'A', pedalboards: [] }])).rejects.toThrow(/two banks/);
    await expect(client.banks.save([{ title: 'a', pedalboards: [pb('Rock')] }])).rejects.toThrow(/copy/);
    await expect(client.banks.save([{ title: 'a', pedalboards: [{ bundle: '', title: 'x' }] }])).rejects.toThrow(/bundle/);
    expect(calls).toEqual([]);
  });

  it('save with no banks empties them all', async () => {
    const { client, state } = await setup();
    await client.banks.save([]);
    expect(state.banks).toEqual([]);
  });
});
