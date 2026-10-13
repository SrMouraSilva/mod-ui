// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { makeClient, setupFakes } from './helpers';

setupFakes();

const file = (name: string) => ({
  fullname: `/data/user-files/NAM Models/${name}`,
  dirname: '',
  basename: name,
  basepath: '/data/user-files/NAM Models',
  filetype: 'nammodel',
});

describe('client.files.list()', () => {
  it('asks for the types, comma separated, and returns the files', async () => {
    const { client, calls } = makeClient({ 'GET /files/list': { ok: true, files: [file('a.nam'), file('b.nam')] } });

    const files = await client.files.list(['nammodel', 'cabsim']);

    expect(files.map((f) => f.basename)).toEqual(['a.nam', 'b.nam']);
    expect(new URL(calls[0].url).searchParams.get('types')).toBe('nammodel,cabsim');
  });

  it('never caches: every call asks again', async () => {
    const { client, calls } = makeClient({ 'GET /files/list': { ok: true, files: [] } });

    await client.files.list(['ir']);
    await client.files.list(['ir']);

    expect(calls).toHaveLength(2);
  });

  it('answers an empty list without a request for no types', async () => {
    const { client, calls } = makeClient({});

    expect(await client.files.list([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
