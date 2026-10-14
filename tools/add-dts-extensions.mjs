// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

// node tools/add-dts-extensions.mjs <dir>
//
// tsc writes `from './banks'` in the .d.ts files it emits. A package with `"type": "module"` is read by TypeScript's `node16` / `nodenext`
// resolution as native ESM, which wants `from './banks.js'`. Rewrites every relative specifier in the .d.ts files of <dir> (it also resolves
// with `bundler` resolution, which is what the sources use). Used by the `build:types` script of modui-client and modui-plugin-view.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/add-dts-extensions.mjs <dir>');
  process.exit(1);
}

const RELATIVE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*?)(?<!\.js)(?<!\.json)\2/g;
let changed = 0;
for (const name of readdirSync(dir).filter((file) => file.endsWith('.d.ts'))) {
  const path = join(dir, name);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(RELATIVE, (_all, lead, quote, specifier) => `${lead}${quote}${specifier}.js${quote}`);
  if (after !== before) {
    writeFileSync(path, after);
    changed++;
  }
}
console.log(`add-dts-extensions: ${changed} declaration files updated in ${dir}`);
