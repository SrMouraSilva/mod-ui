// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { PluginInfo } from 'modui-client';
import { buildTemplateData, fileEntries, renderMustache, resolvePortGroups } from '../src';
import { defaultSettings, fuzzInfo, fuzzUri, labelUri, loopUri, sampleUri, stepsUri } from './helpers';

const info = () => fuzzInfo() as unknown as PluginInfo;

describe('buildTemplateData', () => {
  it('fills ns, cns, brand, label and the gui fields, and does not change the description it was given', () => {
    const source = info();
    const before = JSON.stringify(source);
    const { data } = buildTemplateData({ info: source, version: '7_2_1_0' });
    expect(data.ns).toBe(`?uri=${escape(fuzzUri)}&v=7_2_1_0`);
    expect(data.cns).toMatch(/^_http_3A__example_org_plugins_fuzz7_2_1_0$/);
    expect(data).toMatchObject({ brand: 'Example', label: 'FUZZ', color: 'red', knob: 'black', model: 'boxy', panel: '3-knobs' });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('prefers gui.templateData', () => {
    const source = info();
    (source.gui as Record<string, unknown>).templateData = { brand: 'Custom', extra: 1 };
    const { data } = buildTemplateData({ info: source, version: 'v' });
    expect(data).toMatchObject({ brand: 'Custom', extra: 1, label: 'FUZZ' });
  });

  it('removes the ports the GUI skips from ports.control.input and flags the others', () => {
    const { effect } = buildTemplateData({ info: info(), version: 'v' });
    expect(effect.ports.control.input.map((port) => port.symbol)).toEqual(['gain', 'mode', 'boost', 'tap']);
    expect(effect.all_control_in_ports.map((port) => port.symbol)).toEqual(['gain', 'mode', 'boost', 'tap', 'enabled']);
    const mode = effect.ports.control.input[1];
    expect(mode).toMatchObject({ enumeration: true, integer: true, logarithmic: false, toggled: false, trigger: false, steps: 3 });
    expect(effect.ports.control.input[3]).toMatchObject({ trigger: true, toggled: true });
  });

  it('adds comment and scale points to the gui controls', () => {
    const { data } = buildTemplateData({ info: info(), version: 'v' });
    const controls = data.controls as { symbol: string; comment: string; scalePoints: unknown[] }[];
    expect(controls[0]).toMatchObject({ symbol: 'gain', comment: 'gain comment', scalePoints: [] });
    expect(controls[1].scalePoints).toHaveLength(3);
  });

  it('describes the controls: ranges, formats, :bypass and :presets', () => {
    const { controls } = buildTemplateData({ info: info(), version: 'v' });
    expect(controls.get('gain')).toMatchObject({ kind: 'port', format: '%.2f dB', ranges: { minimum: 0, maximum: 1, default: 0.5 } });
    expect(controls.get('mode')!.format).toBe('%d');
    expect(controls.get(':bypass')).toMatchObject({ kind: 'bypass', properties: ['toggled', 'integer'] });
    expect(controls.get(':presets')!.kind).toBe('presets');
    // Hidden ports are still controls (the script can set them).
    expect(controls.has('enabled')).toBe(true);
  });

  it('flags the parameters: control (with integer / toggled), string, path (with files)', () => {
    const files = new Map([[sampleUri, { files: [{ fullname: '/u/S/a/b.wav', basename: 'b.wav', dirname: 'a', basepath: '/u/S' }] }]]);
    const { effect, parameters } = buildTemplateData({ info: info(), version: 'v', files });
    const byUri = new Map(effect.parameters.map((parameter) => [parameter.uri, parameter]));
    expect(byUri.get(labelUri)).toMatchObject({ control: false, string: true });
    expect(byUri.get(loopUri)).toMatchObject({ control: true, integer: true, toggled: true });
    expect(byUri.get(stepsUri)).toMatchObject({ control: true, integer: true, toggled: false });
    expect(byUri.get(sampleUri)).toMatchObject({ control: false, string: false, path: true, t3k: false });
    expect(byUri.get(sampleUri)!.files!.map((file) => file.fullname)).toEqual(['dir:///u/S/a', '/u/S/a/b.wav']);
    expect(parameters.get(labelUri)).toMatchObject({ valuetype: 's', format: '%s', string: true });
    expect(parameters.get(stepsUri)).toMatchObject({ valuetype: 'i', format: '%d', ranges: { minimum: 1, maximum: 16, default: 4 } });
    expect(parameters.get(loopUri)).toMatchObject({ valuetype: 'b', properties: ['toggled', 'integer'] });
  });

  it('splits the presets into factory and user', () => {
    const presets = [
      { valid: true, uri: 'p:1', label: 'One', path: '' },
      { valid: true, uri: 'p:2', label: 'Mine', path: '/presets/mine.lv2' },
    ];
    const { data } = buildTemplateData({ info: info(), version: 'v', presets });
    expect(data.presets).toEqual({ factory: [presets[0]], user: [presets[1]] });
  });

  it('renders the real default settings template of mod-ui', () => {
    const { data } = buildTemplateData({ info: info(), version: 'v' });
    const html = renderMustache(defaultSettings, data);
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('h1')!.textContent).toBe('Fuzz');
    // Knob for gain, enumeration for mode, switches for boost / trigger; the host-driven port is not drawn.
    expect(root.querySelector('[mod-role=input-control-port][mod-port-symbol=gain]')!.getAttribute('mod-widget')).toBe('film');
    expect(root.querySelectorAll('[mod-port-symbol=mode] [mod-role=enumeration-option]')).toHaveLength(3);
    expect(root.querySelector('[mod-port-symbol=enabled]')).toBeNull();
    expect(root.querySelector(`.mod-string [mod-parameter-uri="${labelUri}"]`)).not.toBeNull();
    expect(root.querySelector(`.mod-knob [mod-parameter-uri="${stepsUri}"]`)).not.toBeNull();
    expect(root.querySelector(`.mod-switch [mod-parameter-uri="${loopUri}"]`)).not.toBeNull();
    expect(root.querySelectorAll('.mod-preset-factory [mod-role=enumeration-option]')).toHaveLength(1);
  });
});

describe('resolvePortGroups', () => {
  it('resolves, sorts and flags the groups like host.js', () => {
    const ports = [
      { index: 0, symbol: 'a', name: 'A' },
      { index: 1, symbol: 'b', name: 'B', group: 'g:2' },
      { index: 2, symbol: 'c', name: 'C', group: 'g:1' },
      { index: 3, symbol: 'd', name: 'D', group: 'g:2' },
    ];
    resolvePortGroups(ports, [{ uri: 'g:1' }, { uri: 'g:2' }]);
    expect(ports.map((port) => port.symbol)).toEqual(['a', 'c', 'b', 'd']);
    expect(ports[1]).toMatchObject({ groupIndex: 0, groupCssIndex: 0, groupStart: true, groupEnd: true });
    expect(ports[2]).toMatchObject({ groupIndex: 1, groupStart: true, groupEnd: false });
    expect(ports[3]).toMatchObject({ groupIndex: 1, groupStart: false, groupEnd: true });
    expect(ports[0].group).toBeUndefined();
  });
});

describe('fileEntries', () => {
  it('lists every folder below the type folder first, then the files, then the default', () => {
    const { files, basepaths } = fileEntries(
      {
        files: [
          { fullname: '/u/S/x.wav', basename: 'x.wav', dirname: '', basepath: '/u/S' },
          { fullname: '/u/S/a/b/y.wav', basename: 'y.wav', dirname: 'a/b', basepath: '/u/S' },
        ],
      },
      '/plugin/default.wav',
    );
    expect(files.map((file) => file.fullname)).toEqual(['dir:///u/S/a', 'dir:///u/S/a/b', '/u/S/x.wav', '/u/S/a/b/y.wav', '/plugin/default.wav']);
    expect(files[1]).toMatchObject({ basename: 'b', filetype: 'dir' });
    expect(files[4].basename).toBe('default.wav');
    expect(basepaths).toEqual(['/u/S']);
  });

  it('copes with a failed list', () => {
    expect(fileEntries(null, '')).toEqual({ files: [], basepaths: [] });
  });
});
