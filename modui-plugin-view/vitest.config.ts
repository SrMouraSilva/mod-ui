import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { aliases, viteVendor } from './vendor-plugins.mjs';

export default defineConfig({
  // mustache.js and sprintf-0.6.js of the classic UI get their `export default` (see vendor-plugins.mjs).
  plugins: [viteVendor()],
  resolve: {
    // The tests use the real client, from its sources (the view itself only imports its types).
    alias: { ...aliases, 'modui-client': fileURLToPath(new URL('../modui-client/src/index.ts', import.meta.url)) },
  },
  // The tests read the real default templates of mod-ui (`html/resources`) and the client's sources.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'happy-dom',
    // The <link> stylesheets the library adds are not loaded in tests.
    environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
  },
});
