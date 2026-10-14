// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { aliases, esbuildVendor } from '../vendor-plugins.mjs';

// The publication build (`npm run build:lib`) bundles mustache.js and sprintf-0.6.js of the classic UI into the package. These tests make
// the same bundles in memory and check that what gets published is self-contained and renders like the classic UI.

const bundle = async (entry: string, format: 'esm' | 'iife') => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format,
    target: 'es2018',
    alias: aliases,
    plugins: [esbuildVendor],
    legalComments: 'inline',
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
};

describe('publication bundle', () => {
  it('has no import left: the ES module needs nothing from the repository nor from npm', async () => {
    const code = await bundle('src/index.ts', 'esm');
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\bfrom\s+["']/);
    expect(code).not.toMatch(/\brequire\(/);
  });

  it('keeps the license notices of the two files it inlines', async () => {
    const code = await bundle('src/index.ts', 'esm');
    expect(code).toContain('mustache.js - Logic-less {{mustache}} templates');
    expect(code).toContain('Copyright (c) Alexandru Marasteanu');
  });

  it('the <script> build sets window.ModUiPluginView, and its Mustache and sprintf behave like the classic UI', async () => {
    const code = await bundle('src/browser.ts', 'iife');
    new Function(code)();
    const api = (window as unknown as { ModUiPluginView: { renderMustache(t: string, v: unknown): string; sprintf(f: string, ...v: unknown[]): string } })
      .ModUiPluginView;
    expect(api.renderMustache('{{u}}', { u: 'a/b' })).toBe('a&#x2F;b');
    expect(api.sprintf('%d %%', 42.6)).toBe('42 %');
  });
});
