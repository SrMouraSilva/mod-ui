// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ModUiHttpError, PluginGui } from '../src';
import { gainInfo, gainUri, makeClient, pluginSummaries, setupFakes } from './helpers';

setupFakes();

const text = (body: string) => () => new Response(body, { status: 200 });
const paths = (calls: { method: string; url: string }[]) => calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

/** A store plugin (has `buildEnvironment`) with a modgui that lacks a settings template. */
const guiInfo = {
  ...gainInfo,
  buildEnvironment: 'prod',
  builder: 7,
  microVersion: 2,
  minorVersion: 1,
  release: 0,
  gui: {
    resourcesDirectory: '/x/modgui',
    iconTemplate: '/x/modgui/icon.html',
    settingsTemplate: '',
    stylesheet: '/x/modgui/style.css',
    javascript: '/x/modgui/script.js',
  },
};
const guiRoutes = {
  'GET /effect/list': [{ ...pluginSummaries[0], ...pick(guiInfo) }],
  'GET /effect/get': guiInfo,
  'GET /effect/file/iconTemplate': text('<div>{{label}}</div>'),
  'GET /effect/file/stylesheet': text('.x{{{cns}}}{}'),
  'GET /effect/file/javascript': text('function (event) {}'),
};

function pick(info: typeof guiInfo) {
  return { buildEnvironment: info.buildEnvironment, builder: info.builder, microVersion: info.microVersion, minorVersion: info.minorVersion, release: info.release };
}

describe('Plugin.gui URLs', () => {
  it('builds the URLs of the classic UI without a request', async () => {
    const { client, calls } = makeClient(guiRoutes);
    const [plugin] = await client.device.plugins.list();
    const gui = plugin.gui;
    const uri = escape(gainUri);

    expect(gui).toBeInstanceOf(PluginGui);
    expect(gui.version).toBe('7_2_1_0');
    expect(gui.getFileUrl('iconTemplate')).toBe(`http://modduo.local/effect/file/iconTemplate?uri=${uri}&v=7_2_1_0`);
    expect(gui.getFileUrl('documentation')).toBe(`http://modduo.local/effect/file/documentation?uri=${uri}&v=7_2_1_0`);
    expect(gui.getCustomFileUrl('img/a b.png')).toBe(`http://modduo.local/effect/file/custom?filename=img%2Fa%20b.png&uri=${uri}&v=7_2_1_0`);
    expect(gui.getResourceUrl('/pedals/x.png')).toBe(`http://modduo.local/resources/pedals/x.png?uri=${uri}&v=7_2_1_0`);
    expect(gui.getThumbnailUrl()).toBe(`http://modduo.local/effect/image/thumbnail.png?uri=${encodeURIComponent(gainUri)}&v=7_2_1_0`);
    expect(gui.getScreenshotUrl()).toContain('/effect/image/screenshot.png?uri=');
    expect(paths(calls)).toEqual(['GET /effect/list']);
  });

  it('adds the time of the client to the version of a plugin that is not from the store', async () => {
    const now = Date.now();
    const { client } = makeClient({ 'GET /effect/list': pluginSummaries });
    const [plugin] = await client.device.plugins.list();

    expect(plugin.gui.version).toMatch(/^0_0_1_0_\d+$/);
    expect(Number(plugin.gui.version.split('_')[4])).toBeGreaterThanOrEqual(now);
    // the same client gives the same version to every Plugin object
    const [again] = await client.device.plugins.list();
    expect(again.gui.version).toBe(plugin.gui.version);
  });
});

describe('PluginGui.get() / getAll()', () => {
  it('reads only the files the plugin declares, once per version', async () => {
    const { client, calls } = makeClient(guiRoutes);
    const [plugin] = await client.device.plugins.list();

    const files = await plugin.gui.getAll();
    await plugin.gui.getAll();

    expect(files).toEqual({
      iconTemplate: '<div>{{label}}</div>',
      settingsTemplate: null,
      stylesheet: '.x{{{cns}}}{}',
      javascript: 'function (event) {}',
      errors: [],
    });
    expect(paths(calls).sort()).toEqual(
      ['GET /effect/file/iconTemplate', 'GET /effect/file/javascript', 'GET /effect/file/stylesheet', 'GET /effect/get', 'GET /effect/list'].sort(),
    );
    const icon = calls.find((c) => c.url.includes('iconTemplate'))!;
    expect(icon.url).toBe(plugin.gui.getFileUrl('iconTemplate'));
  });

  it('get() answers null for a file the plugin does not declare, without a request', async () => {
    const { client, calls } = makeClient(guiRoutes);
    const [plugin] = await client.device.plugins.list();

    expect(await plugin.gui.get('settingsTemplate')).toBeNull();
    expect(paths(calls)).not.toContain('GET /effect/file/settingsTemplate');
  });

  it('get() throws ModUiHttpError and does not cache the failure', async () => {
    let fail = true;
    const { client, calls } = makeClient({
      ...guiRoutes,
      'GET /effect/file/stylesheet': () => (fail ? new Response('nope', { status: 500 }) : new Response('.ok{}')),
    });
    const [plugin] = await client.device.plugins.list();

    await expect(plugin.gui.get('stylesheet')).rejects.toBeInstanceOf(ModUiHttpError);
    fail = false;
    expect(await plugin.gui.get('stylesheet')).toBe('.ok{}');
    expect(calls.filter((c) => c.url.includes('/stylesheet'))).toHaveLength(2);
  });

  it('getAll() reports a file that fails in errors and keeps the others', async () => {
    const { client } = makeClient({ ...guiRoutes, 'GET /effect/file/javascript': () => new Response('x', { status: 404 }) });
    const [plugin] = await client.device.plugins.list();

    const files = await plugin.gui.getAll();

    expect(files.javascript).toBeNull();
    expect(files.iconTemplate).toBe('<div>{{label}}</div>');
    expect(files.errors).toHaveLength(1);
    expect(files.errors[0].file).toBe('javascript');
    expect(files.errors[0].error).toBeInstanceOf(ModUiHttpError);
  });

  it('getAll() throws when the plugin is not installed', async () => {
    const { client } = makeClient({ 'GET /effect/list': pluginSummaries });
    const [plugin] = await client.device.plugins.list();

    await expect(plugin.gui.getAll()).rejects.toMatchObject({ status: 404 });
  });

  it('clearGuiCache() makes the next read ask again', async () => {
    const { client, calls } = makeClient(guiRoutes);
    const [plugin] = await client.device.plugins.list();

    await plugin.gui.get('iconTemplate');
    client.device.plugins.clearGuiCache();
    await plugin.gui.get('iconTemplate');

    expect(calls.filter((c) => c.url.includes('/iconTemplate'))).toHaveLength(2);
  });
});

describe('client.device.plugins.get()', () => {
  it('reads the description for a URI and shares the cache with Plugin.info()', async () => {
    const { client, calls } = makeClient(guiRoutes);

    const plugin = await client.device.plugins.get(gainUri);
    await plugin.info();

    expect(plugin.uri).toBe(gainUri);
    expect(plugin.gui.version).toBe('7_2_1_0');
    expect(paths(calls)).toEqual(['GET /effect/get']);
  });

  it('wraps a summary or a description without a request', async () => {
    const { client, calls } = makeClient({});

    const plugin = await client.device.plugins.get(guiInfo);

    expect(plugin.gui.getFileUrl('stylesheet')).toContain('/effect/file/stylesheet');
    expect(await plugin.info()).toBe(guiInfo);
    expect(calls).toHaveLength(0);
  });

  it('throws ModUiHttpError 404 for a plugin that is not installed', async () => {
    const { client } = makeClient({});

    await expect(client.device.plugins.get('http://example.org/none')).rejects.toMatchObject({ status: 404 });
  });
});

describe('client.device.plugins.getDefaultTemplates()', () => {
  it('reads the two shared templates once', async () => {
    const { client, calls } = makeClient({
      'GET /resources/templates/pedal-default.html': text('<icon/>'),
      'GET /resources/settings.html': text('<settings/>'),
    });

    const first = await client.device.plugins.getDefaultTemplates();
    await client.device.plugins.getDefaultTemplates();

    expect(first).toEqual({ iconTemplate: '<icon/>', settingsTemplate: '<settings/>' });
    expect(paths(calls).sort()).toEqual(['GET /resources/settings.html', 'GET /resources/templates/pedal-default.html']);
  });
});
