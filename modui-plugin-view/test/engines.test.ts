// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { customFileUrl, guiFileUrl, imageUrl, namespace, rebaseUrls, renderMustache, renderedVersion, resourceUrl, sprintf } from '../src';

describe('renderMustache', () => {
  it('escapes variables and leaves {{{triple}}} and {{& x}} raw', () => {
    expect(renderMustache('{{a}}|{{{a}}}|{{& a}}', { a: '<b>&"\'' })).toBe('&lt;b&gt;&amp;&quot;&#39;|<b>&"\'|<b>&"\'');
  });

  it('prints 0 and false, and nothing for null or missing names', () => {
    expect(renderMustache('[{{zero}}][{{no}}][{{nil}}][{{missing}}]', { zero: 0, no: false, nil: null })).toBe('[0][false][][]');
  });

  it('repeats a section over a list, with the item as context and outer names still visible', () => {
    const view = { cns: '_x', ports: [{ symbol: 'a' }, { symbol: 'b' }] };
    expect(renderMustache('{{#ports}}<i class="k{{cns}}">{{symbol}}</i>{{/ports}}', view)).toBe('<i class="k_x">a</i><i class="k_x">b</i>');
  });

  it('enters an object section, shows a truthy one once, skips falsy and empty lists', () => {
    const view = { group: { name: 'G' }, flag: true, off: 0, empty: [] };
    expect(renderMustache('{{#group}}{{name}}{{/group}}{{#flag}}F{{/flag}}{{#off}}X{{/off}}{{#empty}}E{{/empty}}', view)).toBe('GF');
  });

  it('shows inverted sections for false, missing and empty values', () => {
    expect(renderMustache('{{^a}}A{{/a}}{{^b}}B{{/b}}{{^c}}C{{/c}}{{^d}}D{{/d}}', { a: false, c: [], d: 1 })).toBe('ABC');
  });

  it('resolves dotted names and {{.}}', () => {
    expect(renderMustache('{{effect.ports.audio.input.length}}', { effect: { ports: { audio: { input: [1, 2] } } } })).toBe('2');
    expect(renderMustache('{{#list}}<{{.}}>{{/list}}', { list: ['x', 'y'] })).toBe('<x><y>');
  });

  it('nests sections like the default settings template ({{#effect.parameters}}{{#writable}}{{#path}}...)', () => {
    const view = { effect: { parameters: [{ writable: true, path: true, uri: 'u', files: [{ fullname: 'f' }] }, { writable: false, path: true }] } };
    const template = '{{#effect.parameters}}{{#writable}}{{#path}}[{{uri}}:{{#files}}{{fullname}}{{/files}}]{{/path}}{{/writable}}{{/effect.parameters}}';
    expect(renderMustache(template, view)).toBe('[u:f]');
  });

  it('ignores comments and keeps a } that follows a tag (CSS)', () => {
    expect(renderMustache('.a{{{cns}}} {x}{{! note }}.b{{cns}}}', { cns: '_1' })).toBe('.a_1 {x}.b_1}');
  });
});

describe('sprintf', () => {
  it('formats the unit renders of LV2 ports', () => {
    expect(sprintf('%.2f dB', -3.14159)).toBe('-3.14 dB');
    expect(sprintf('%d %%', 42.6)).toBe('43 %');
    expect(sprintf('%f', 1)).toBe('1.000000');
    expect(sprintf('%s Hz', 'abc')).toBe('abc Hz');
    expect(sprintf('%.1f', -0.01)).toBe('-0.0');
    expect(sprintf('%d', -0.2)).toBe('0');
  });

  it('supports flags, width and the other conversions', () => {
    expect(sprintf('%5.1f|%-4d|%04d|%+d|%x|%#X|%e', 1.25, 7, -7, 3, 255, 255, 1234.5)).toBe('  1.3|7   |-007|+3|ff|0XFF|1.234500e+3');
    expect(sprintf('%g %c %.2s', 0.0001234, 65, 'abc')).toBe('0.0001234 A ab');
  });
});

describe('URLs', () => {
  const info = { uri: 'http://example.org/plugins/fuzz#1', builder: 7, microVersion: 2, minorVersion: 1, release: 0, buildEnvironment: 'prod' };

  it('builds the version and ns / cns exactly like modgui.js', () => {
    expect(renderedVersion(info)).toBe('7_2_1_0');
    expect(renderedVersion({ ...info, buildEnvironment: '' }, 99)).toBe('7_2_1_0_99');
    expect(renderedVersion(info, 99)).toBe('7_2_1_0');
    expect(namespace(info.uri, '7_2_1_0')).toEqual({
      ns: '?uri=http%3A//example.org/plugins/fuzz%231&v=7_2_1_0',
      cns: '_http_3A__example_org_plugins_fuzz_2317_2_1_0',
    });
  });

  it('builds the file, resource and image URLs', () => {
    const base = 'http://modduo.local';
    expect(guiFileUrl(base, 'iconTemplate', info.uri, 'v')).toBe('http://modduo.local/effect/file/iconTemplate?uri=http%3A//example.org/plugins/fuzz%231&v=v');
    expect(customFileUrl(base, 'img/a b.png', info.uri, 'v')).toBe(
      'http://modduo.local/effect/file/custom?filename=img%2Fa%20b.png&uri=http%3A//example.org/plugins/fuzz%231&v=v',
    );
    expect(resourceUrl(base, '/pedals/x.png', info.uri, 'v')).toBe('http://modduo.local/resources/pedals/x.png?uri=http%3A//example.org/plugins/fuzz%231&v=v');
    expect(resourceUrl(base, 'settings.html')).toBe('http://modduo.local/resources/settings.html');
    expect(imageUrl(base, 'thumbnail', info.uri)).toBe('http://modduo.local/effect/image/thumbnail.png?uri=http%3A%2F%2Fexample.org%2Fplugins%2Ffuzz%231');
  });

  it('rebases root-relative src, href and url() onto the base URL, and nothing else', () => {
    const html = `<img src="/resources/a.png"><a href='/x'>x</a><i style="background:url(/r/b.png)"></i>
      <b style="background:url('/r/c.png')"></b><img src="http://other/x.png"><img src="//cdn/x.png"><img src="rel.png">`;
    const out = rebaseUrls(html, 'http://modduo.local');
    expect(out).toContain('src="http://modduo.local/resources/a.png"');
    expect(out).toContain("href='http://modduo.local/x'");
    expect(out).toContain('url(http://modduo.local/r/b.png)');
    expect(out).toContain("url('http://modduo.local/r/c.png')");
    expect(out).toContain('src="http://other/x.png"');
    expect(out).toContain('src="//cdn/x.png"');
    expect(out).toContain('src="rel.png"');
    expect(rebaseUrls('url(/a)', '')).toBe('url(/a)');
  });
});
