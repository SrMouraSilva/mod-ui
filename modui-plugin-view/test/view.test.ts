// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInfo } from 'modui-client';
import { PluginViewError, namespace, type ViewChangeEvent, type ViewErrorEvent } from '../src';
import { fuzzFrame, fuzzInfo, fuzzUri, labelUri, liveSetup, loopUri, mouse, sentWith, settle, stepsUri } from './helpers';

declare global {
  interface Window {
    fuzzEvents?: { type: string; symbol?: string; uri?: string; value?: unknown; api?: number }[];
    fuzzStart?: Record<string, unknown>;
  }
}

beforeEach(() => {
  window.fuzzEvents = [];
  window.fuzzStart = undefined;
});

const q = (root: Element, selector: string) => root.querySelector<HTMLElement>(selector)!;

describe('live view', () => {
  it('renders the icon and settings with the live values', async () => {
    const { views, instance } = await liveSetup({
      frames: [fuzzFrame(), 'param_set /graph/fuzz gain 1.000000', 'param_set /graph/fuzz mode 1.000000', `patch_set /graph/fuzz 1 ${stepsUri} i 8`],
    });
    const view = await views.create(instance);
    expect(view.live).toBe(true);
    expect(view.instance).toBe(instance);
    expect(view.icon.getAttribute('mod-instance')).toBe('/graph/fuzz');
    expect(view.icon.className).toBe('mod-pedal');
    expect(view.settings.className).toBe('mod-settings');

    const pedal = view.icon.firstElementChild!;
    expect(pedal.className).toMatch(/^fuzz_http_3A__example_org_plugins_fuzz7_2_1_0 mod-red$/);
    expect(q(view.icon, '.brand').textContent).toBe('Example FUZZ');
    expect(q(view.icon, '[data-symbol=gain]').title).toBe('gain comment');
    expect(q(view.icon, '.logo').getAttribute('src')).toBe(`http://modduo.local/resources/logo.png?uri=${escape(fuzzUri)}&v=7_2_1_0`);
    expect(q(view.icon, '.jack').classList.contains('mod-audio-input')).toBe(true);

    expect(q(view.icon, '.knob').style.transform).toBe('rotate(135deg)');
    expect(q(view.icon, '.gain-value').textContent).toBe('1.00 dB');
    expect(q(view.icon, '[mod-role=input-control-minimum]').textContent).toBe('0 dB');
    expect(q(view.icon, '[mod-role=input-control-maximum]').textContent).toBe('1 dB');
    expect(q(view.icon, '.mode .selected').textContent).toBe('Hard');
    expect(q(view.icon, '.mode [mod-role=input-control-value]').textContent).toBe('Hard');
    expect(q(view.icon, '.steps-value').textContent).toBe('8');
    expect(q(view.icon, '.knob').getAttribute('mod-port')).toBe('/graph/fuzz/gain');

    // No settingsTemplate: the default one of mod-ui, with the same live values.
    expect(q(view.settings, '.mod-pedal-settings h1').textContent).toBe('Fuzz');
    expect(q(view.settings, '[mod-role=input-control-value][mod-port-symbol=gain]').textContent).toBe('1.00 dB');
    expect(view.getValue('gain')).toBe(1);
    expect(view.getPatchValue(stepsUri)).toBe(8);
    expect(view.active).toBe(true);
    // Addressing is not supported: its buttons are hidden.
    expect(view.settings.querySelectorAll('.mod-address').length).toBeGreaterThan(0);
    for (const address of Array.from(view.settings.querySelectorAll<HTMLElement>('.mod-address'))) expect(address.style.display).toBe('none');
  });

  it('adds the global stylesheets once and the plugin stylesheet rendered and rebased', async () => {
    const { views, instance } = await liveSetup();
    await views.create(instance);
    await views.create(instance);
    await settle();
    const links = Array.from(document.head.querySelectorAll('link')).map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      'http://modduo.local/css/pedals.css',
      'http://modduo.local/resources/pedals/default.css',
      'http://modduo.local/css/fonts.css',
    ]);
    const styles = Array.from(document.head.querySelectorAll('style')).map((style) => style.textContent);
    expect(styles).toHaveLength(3);
    expect(styles[0]).toContain('box-sizing: border-box');
    expect(styles).toContain(`.fuzz_http_3A__example_org_plugins_fuzz7_2_1_0 { background: url(http://modduo.local/resources/fuzz.png?uri=${escape(fuzzUri)}&v=7_2_1_0); width: 200px; }`);
    expect(styles).toContain("@font-face { font-family: 'Nexa'; src: url('http://modduo.local/fonts/nexa/Nexa.woff') format('woff'); }");
    views.destroy();
    expect(document.head.children).toHaveLength(0);
  });

  it('follows changes made elsewhere', async () => {
    const { views, instance, socket } = await liveSetup();
    const view = await views.create(instance);
    const changes: ViewChangeEvent[] = [];
    view.on('change', (event) => changes.push(event));
    const actives: boolean[] = [];
    view.on('active', ({ active }) => actives.push(active));
    const presets: (string | null)[] = [];
    view.on('preset', ({ preset }) => presets.push(preset));

    socket.emit('param_set /graph/fuzz gain 0.000000');
    expect(q(view.icon, '.knob').style.transform).toBe('rotate(-135deg)');
    expect(q(view.icon, '.gain-value').textContent).toBe('0.00 dB');
    expect(changes).toEqual([{ symbol: 'gain', value: 0, origin: 'external' }]);

    socket.emit('param_set /graph/fuzz :bypass 1.000000');
    expect(q(view.icon, '.mod-footswitch').classList.contains('on')).toBe(true);
    expect(q(view.icon, '.mod-light').classList.contains('off')).toBe(true);
    expect(actives).toEqual([false]);
    expect(view.active).toBe(false);

    socket.emit(`patch_set /graph/fuzz 1 ${loopUri} b 1`);
    expect(q(view.icon, '.loop').classList.contains('on')).toBe(true);
    socket.emit(`patch_set /graph/fuzz 1 ${labelUri} s Hello world`);
    expect((q(view.settings, `textarea[mod-parameter-uri="${labelUri}"]`) as HTMLTextAreaElement).value).toBe('Hello world');

    socket.emit(`preset /graph/fuzz ${fuzzUri}#preset-soft`);
    expect(q(view.settings, '.mod-presets .selected').textContent).toBe('Soft');
    expect(presets).toEqual([`${fuzzUri}#preset-soft`]);
  });

  it('writes gestures through the client and does not hear them back', async () => {
    const { views, instance, socket } = await liveSetup();
    const view = await views.create(instance);
    const changes: ViewChangeEvent[] = [];
    view.on('change', (event) => changes.push(event));

    const knob = q(view.icon, '.knob');
    mouse(knob, 'mousedown', { pageY: 100 });
    mouse(document, 'mousemove', { pageY: 73 });
    mouse(document, 'mouseup', { pageY: 73 });
    await settle();
    expect(sentWith(socket, 'param_set /graph/fuzz/gain')).toEqual(['param_set /graph/fuzz/gain 0.6']);
    expect(instance.params.get('gain')!.value).toBe(0.6);
    expect(changes).toEqual([{ symbol: 'gain', value: 0.6, origin: 'user' }]);
    // The settings knob moved too, the icon's value field shows it.
    expect(q(view.settings, '[mod-role=input-control-value][mod-port-symbol=gain]').textContent).toBe('0.60 dB');

    mouse(q(view.icon, '.mod-footswitch'), 'click');
    await settle();
    expect(sentWith(socket, 'param_set /graph/fuzz/:bypass')).toEqual(['param_set /graph/fuzz/:bypass 1.0']);
    expect(await instance.isActive()).toBe(false);
    expect(q(view.icon, '.mod-light').classList.contains('off')).toBe(true);

    (q(view.icon, '.mode').querySelectorAll('[mod-role=enumeration-option]')[2] as HTMLElement).click();
    await settle();
    expect(sentWith(socket, 'param_set /graph/fuzz/mode')).toEqual(['param_set /graph/fuzz/mode 2']);

    mouse(q(view.icon, '.loop'), 'click');
    await settle();
    expect(sentWith(socket, 'patch_set /graph/fuzz')).toEqual([`patch_set /graph/fuzz ${loopUri} b 1`]);

    // Only the changes of the view itself were announced; nothing came back as 'external'.
    expect(changes.map((change) => change.origin)).toEqual(['user', 'user']);
  });

  it('edits values in the value fields and the string fields', async () => {
    const { views, instance, socket } = await liveSetup();
    const view = await views.create(instance);
    const field = q(view.icon, '.gain-value');
    field.dispatchEvent(new FocusEvent('focus'));
    expect(field.textContent).toBe('0.50 dB');
    field.textContent = '7';
    field.dispatchEvent(new FocusEvent('blur'));
    await settle();
    // Clamped to the range.
    expect(sentWith(socket, 'param_set /graph/fuzz/gain')).toEqual(['param_set /graph/fuzz/gain 1']);
    expect(q(view.icon, '.knob').style.transform).toBe('rotate(135deg)');
    expect(field.textContent).toBe('1.00 dB');

    const text = q(view.settings, `textarea[mod-parameter-uri="${labelUri}"]`) as HTMLTextAreaElement;
    text.value = 'Verse';
    text.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(sentWith(socket, 'patch_set /graph/fuzz')).toEqual([`patch_set /graph/fuzz ${labelUri} s Verse`]);
  });

  it('puts a trigger back to its default after 100 ms', async () => {
    const { views, instance, socket } = await liveSetup();
    const view = await views.create(instance);
    vi.useFakeTimers();
    try {
      const tap = q(view.icon, '.tap');
      mouse(tap, 'mousedown');
      mouse(document, 'mouseup');
      expect(tap.classList.contains('on')).toBe(true);
      vi.advanceTimersByTime(100);
      expect(tap.classList.contains('off')).toBe(true);
      expect(view.getValue('tap')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(sentWith(socket, 'param_set /graph/fuzz/tap')).toEqual(['param_set /graph/fuzz/tap 1']);
  });

  it('runs the plugin script: start, changes both ways, outputs, funcs, and disables it after a throw', async () => {
    const { views, instance, socket } = await liveSetup({ frames: [fuzzFrame(), 'output_set /graph/fuzz level 0.250000'] });
    const errors: ViewErrorEvent[] = [];
    views.on('error', (event) => errors.push(event));
    const view = await views.create(instance);
    expect(view.scriptActive).toBe(true);

    const start = window.fuzzStart!;
    expect(start.ports).toEqual([
      { symbol: ':bypass', value: 0 },
      { symbol: 'gain', value: 0.5 },
      { symbol: 'mode', value: 0 },
      { symbol: 'boost', value: 0 },
      { symbol: 'tap', value: 0 },
      { symbol: 'enabled', value: 1 },
      { symbol: 'level', value: 0.25 },
    ]);
    expect(start.parameters).toEqual([
      { uri: labelUri, value: 'Hi' },
      { uri: fuzzUri + '#sample', value: '' },
      { uri: loopUri, value: 0 },
      { uri: stepsUri, value: 4 },
    ]);
    expect(start.url).toBe(`http://modduo.local/effect/file/custom?filename=a.png&uri=${escape(fuzzUri)}&v=7_2_1_0`);
    expect(start.index).toBe(7);
    expect(start.symbol).toBe('mode');
    expect(window.fuzzEvents![0]).toMatchObject({ type: 'start', api: 3 });

    // Output values reach the script, which draws them.
    const outputs: number[] = [];
    view.on('output', ({ value }) => outputs.push(value));
    socket.emit('output_set /graph/fuzz level 0.500000');
    expect(q(view.icon, '[mod-role=level]').textContent).toBe('L0.50');
    expect(view.getOutput('level')).toBe(0.5);
    expect(outputs).toEqual([0.5]);

    // A remote change reaches the script; the script answers with set_port_value, which is written and shown.
    socket.emit('param_set /graph/fuzz gain 1.000000');
    await settle();
    expect(window.fuzzEvents!.filter((event) => event.type === 'change' && event.symbol === 'gain')).toEqual([
      { type: 'change', symbol: 'gain', value: 1, api: 3, uri: undefined },
    ]);
    expect(sentWith(socket, 'param_set /graph/fuzz/boost')).toEqual(['param_set /graph/fuzz/boost 1']);
    expect(q(view.icon, '.boost').classList.contains('on')).toBe(true);
    // The script's own change is not sent back to it.
    expect(window.fuzzEvents!.some((event) => event.symbol === 'boost')).toBe(false);

    // Mode 2 makes the script throw: it is disabled, an error is reported, the view goes on.
    socket.emit('param_set /graph/fuzz mode 2.000000');
    expect(view.scriptActive).toBe(false);
    expect(errors.map((error) => error.context)).toEqual(['script']);
    const count = window.fuzzEvents!.length;
    socket.emit('param_set /graph/fuzz gain 0.000000');
    expect(window.fuzzEvents!.length).toBe(count);
    expect(q(view.icon, '.knob').style.transform).toBe('rotate(-135deg)');
  });

  it('sends end to the script and removes the elements when the plugin leaves the pedalboard', async () => {
    const { views, instance, socket } = await liveSetup();
    const view = await views.create(instance);
    document.body.append(view.icon, view.settings);
    const destroyed: string[] = [];
    view.on('destroyed', ({ reason }) => destroyed.push(reason));
    socket.emit('remove /graph/fuzz');
    await settle();
    expect(view.alive).toBe(false);
    expect(destroyed).toEqual(['removed']);
    expect(view.icon.isConnected).toBe(false);
    expect(window.fuzzEvents![window.fuzzEvents!.length - 1].type).toBe('end');
    expect(views.list()).toEqual([]);
    await expect(views.create(instance)).rejects.toThrow(PluginViewError);
  });

  it('loads presets from the settings panel and saves new ones with the name asked for', async () => {
    const userPreset = { valid: true, uri: fuzzUri + '#mine', label: 'Mine', path: '/root/.lv2/fuzz-mine.lv2' };
    let presets = [{ valid: true, uri: fuzzUri + '#preset-soft', label: 'Soft', path: '' }];
    const promptName = vi.fn(async () => 'Mine');
    const { views, instance, socket, calls } = await liveSetup({
      views: { promptName },
      routes: {
        'GET /effect/get_non_cached': () => ({ licensed: 0, presets }),
        'GET /effect/preset/load//graph/fuzz': () => {
          socket.emit(`preset /graph/fuzz ${fuzzUri}#preset-soft`);
          return true;
        },
        'GET /effect/preset/save_new//graph/fuzz': () => {
          presets = [...presets, userPreset];
          return { ok: true, bundle: userPreset.path, uri: userPreset.uri };
        },
      },
    });
    const view = await views.create(instance);
    const panel = q(view.settings, '.mod-presets');
    expect(panel.style.display).not.toBe('none');
    expect(q(panel, '.preset-btn-save').classList.contains('disabled')).toBe(true);

    q(panel, '.mod-preset-factory [mod-role=enumeration-option]').click();
    await settle();
    expect(calls.some((call) => call.url.includes('/effect/preset/load//graph/fuzz?uri='))).toBe(true);
    expect(view.preset).toBe(fuzzUri + '#preset-soft');
    expect(q(panel, '.selected').textContent).toBe('Soft');

    q(panel, '.preset-btn-save-as').click();
    await settle();
    expect(promptName).toHaveBeenCalledWith('Saving Preset', 'Soft');
    expect(calls.some((call) => call.url.includes('/effect/preset/save_new//graph/fuzz?name=Mine'))).toBe(true);
    // The list is rebuilt from the client's catalog, and the new preset is current, so it can be saved over, renamed and deleted.
    expect(q(panel, '.mod-preset-user [mod-role=enumeration-option]').textContent).toBe('Mine');
    expect(view.preset).toBe(userPreset.uri);
    expect(q(panel, '.preset-btn-save').classList.contains('disabled')).toBe(false);
    expect(q(panel, '.preset-btn-delete').classList.contains('disabled')).toBe(false);
  });

  it('lists the user files of a path parameter in the settings panel', async () => {
    const { views, instance, socket } = await liveSetup();
    const view = await views.create(instance);
    const list = q(view.settings, '.mod-file-list [mod-widget=custom-select-path]');
    const values = Array.from(list.querySelectorAll('[mod-role=enumeration-option]')).map((option) => option.getAttribute('mod-parameter-value'));
    expect(values).toEqual(['dir:///data/user-files/Audio Samples/drums', '/data/user-files/Audio Samples/kick.wav', '/data/user-files/Audio Samples/drums/snare.wav']);
    q(list, '[mod-parameter-value="/data/user-files/Audio Samples/kick.wav"]').click();
    await settle();
    expect(sentWith(socket, 'patch_set /graph/fuzz')).toEqual([`patch_set /graph/fuzz ${fuzzUri}#sample p /data/user-files/Audio Samples/kick.wav`]);
  });

  it('reports a refused write and keeps working', async () => {
    const { views, instance } = await liveSetup();
    const view = await views.create(instance);
    const errors: ViewErrorEvent[] = [];
    view.on('error', (event) => errors.push(event));
    await expect(view.setValue('enabled', 0)).rejects.toThrow(/driven by the host/);
    expect(errors.map((error) => error.context)).toEqual(['write']);
    await expect(view.setValue('nope', 1)).rejects.toThrow(PluginViewError);
  });

  it('skips the script without jQuery and says so', async () => {
    const { views, instance } = await liveSetup({ views: { jQuery: null } });
    const errors: ViewErrorEvent[] = [];
    views.on('error', (event) => errors.push(event));
    const view = await views.create(instance);
    expect(view.scriptActive).toBe(false);
    expect(window.fuzzStart).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(String(errors[0].error)).toMatch(/needs jQuery/);
  });

  it('draws the default pedal for a plugin without modgui', async () => {
    const info = fuzzInfo({ gui: { resourcesDirectory: '', iconTemplate: '', settingsTemplate: '', stylesheet: '', javascript: '' } });
    const { views, instance, calls } = await liveSetup({ info });
    const view = await views.create(instance);
    expect(view.icon.firstElementChild!.className).toBe('mod-pedal mod-pedal-default');
    expect(q(view.icon, '.mod-plugin-name h1').textContent).toBe('Fuzz');
    expect(q(view.icon, '[mod-role=bypass]').getAttribute('mod-port')).toBe('/graph/fuzz/:bypass');
    expect(calls.some((call) => call.url.includes('/effect/file/'))).toBe(false);
  });
});

describe('a plugin without a bypass', () => {
  it('hides the bypass switch of the settings and keeps it for the others', async () => {
    const normal = await liveSetup({ frames: [fuzzFrame()] });
    const withBypass = await normal.views.create(normal.instance);
    expect(q(withBypass.settings, '.mod-switch.bypass').style.display).not.toBe('none');

    const buffer = await liveSetup({ frames: [fuzzFrame()], info: fuzzInfo({ bypassable: false }) });
    const view = await buffer.views.create(buffer.instance);
    expect(q(view.settings, '.mod-switch.bypass').style.display).toBe('none');
    // the icon's footswitch comes from the plugin's own template and is left alone
    expect(q(view.icon, '[mod-role=bypass]').style.display).not.toBe('none');
  });
});

describe('preview', () => {
  it('renders a catalogue plugin with local values and sends nothing', async () => {
    const { views, socket, client, calls } = await liveSetup({ frames: [] });
    const view = await views.create(fuzzUri, { values: { gain: 1 }, bypassed: true });
    expect(view.live).toBe(false);
    expect(view.instance).toBeNull();
    expect(view.icon.hasAttribute('mod-instance')).toBe(false);
    expect(q(view.icon, '.knob').style.transform).toBe('rotate(135deg)');
    expect(view.active).toBe(false);
    // No preset panel and no close button for a preview; no file list requested.
    expect(q(view.settings, '.mod-presets').style.display).toBe('none');
    expect(q(view.settings, '.js-close').style.display).toBe('none');
    expect(calls.some((call) => call.url.includes('/files/list'))).toBe(false);

    const sentBefore = socket.sent.length;
    mouse(q(view.icon, '.mod-footswitch'), 'click');
    await view.setValue('gain', 0);
    expect(view.active).toBe(true);
    expect(view.getValue('gain')).toBe(0);
    expect(socket.sent.length).toBe(sentBefore);

    const info = (await client.device.plugins.info(fuzzUri)) as PluginInfo;
    const again = await views.create(info);
    expect(again.getValue('gain')).toBe(0.5);
  });

  it('reads the plugin files through the client, with the version of plugin.gui in every URL and template', async () => {
    const { client, views, calls } = await liveSetup({ frames: [] });
    const plugin = await client.device.plugins.get(fuzzUri);
    const view = await views.create(plugin);

    const fileCalls = calls.filter((call) => call.url.includes('/effect/file/')).map((call) => call.url);
    expect(fileCalls).toContain(plugin.gui.getFileUrl('iconTemplate'));
    expect(fileCalls).toContain(plugin.gui.getFileUrl('stylesheet'));
    expect(plugin.gui.version).toBe('7_2_1_0');
    expect(view.icon.innerHTML).toContain(namespace(fuzzUri, plugin.gui.version).cns);
  });
});
