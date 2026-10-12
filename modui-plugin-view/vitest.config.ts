import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The tests use the real client, from its sources (the view itself only imports its types).
    alias: { 'modui-client': fileURLToPath(new URL('../modui-client/src/index.ts', import.meta.url)) },
  },
  // The tests read the real default templates of mod-ui (`html/resources`) and the client's sources.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'happy-dom',
    // The <link> stylesheets the library adds are not loaded in tests.
    environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
  },
});
