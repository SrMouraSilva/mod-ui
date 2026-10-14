// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

// node build.mjs global [--watch]   the <script> build for the classic mod-ui page: ../html/js/lib/modui-plugin-view.js (git-ignored)
// node build.mjs lib                the publication build: dist/index.js (ES module) and dist/modui-plugin-view.global.js (<script>)
// (the .d.ts files come from `npm run build:types`)

import { build, context } from 'esbuild';
import { aliases, esbuildVendor } from './vendor-plugins.mjs';

const [mode, flag] = process.argv.slice(2);
const common = { bundle: true, target: 'es2018', alias: aliases, plugins: [esbuildVendor], legalComments: 'inline', logLevel: 'info' };

if (mode === 'global') {
  const options = { ...common, entryPoints: ['src/browser.ts'], format: 'iife', outfile: '../html/js/lib/modui-plugin-view.js' };
  if (flag === '--watch') {
    await (await context({ ...options, sourcemap: 'inline' })).watch();
  } else {
    await build(options);
  }
} else if (mode === 'lib') {
  await build({ ...common, entryPoints: ['src/index.ts'], format: 'esm', sourcemap: true, outfile: 'dist/index.js' });
  await build({ ...common, entryPoints: ['src/browser.ts'], format: 'iife', sourcemap: true, outfile: 'dist/modui-plugin-view.global.js' });
} else {
  console.error('usage: node build.mjs global [--watch] | lib');
  process.exit(1);
}
