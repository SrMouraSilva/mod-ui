// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

// The two files of the classic UI that src/vendor.ts imports are plain scripts: `mustache.js` declares `var Mustache` (and exports it only
// under CommonJS), `sprintf-0.6.js` declares a global `function sprintf`. Both get the `export default` they lack when they are loaded,
// by an esbuild plugin (build.mjs) and a Vite plugin (vitest.config.ts). The files in html/js/lib are never modified.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The specifiers src/vendor.ts imports, and the files they stand for (an alias in esbuild and in Vite, an ambient module in src/vendor-modules.d.ts). */
const lib = resolve(dirname(fileURLToPath(import.meta.url)), '../html/js/lib');
export const aliases = {
  'modui-vendor/mustache': resolve(lib, 'mustache.js'),
  'modui-vendor/sprintf': resolve(lib, 'sprintf-0.6.js'),
};

const FILES = /html[\\/]js[\\/]lib[\\/](mustache|sprintf-0\.6)\.js$/;
const NAMES = { mustache: 'Mustache', 'sprintf-0.6': 'sprintf' };

/**
 * The source of a vendored file with its default export. A leading `/**` comment (the BSD notice of sprintf-0.6.js) becomes `/*!`, which
 * esbuild keeps in the output (`legalComments: 'inline'`): the license says the notice must travel with the code.
 */
const withDefaultExport = (file, code) => `${code.replace(/^\/\*\*/, '/*!')}\nexport default ${NAMES[FILES.exec(file)[1]]};\n`;

/** esbuild plugin. */
export const esbuildVendor = {
  name: 'modui-vendor',
  setup(build) {
    build.onLoad({ filter: FILES }, (args) => ({ contents: withDefaultExport(args.path, readFileSync(args.path, 'utf8')), loader: 'js' }));
  },
};

/** Vite plugin (vitest). */
export const viteVendor = () => ({
  name: 'modui-vendor',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0];
    return FILES.test(file) ? { code: withDefaultExport(file, code), map: null } : null;
  },
});
