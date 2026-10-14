# Plan: publish `modui-client` and `modui-plugin-view` to npm

Status: **implemented** (2026-10-13). Builds on `2026-10-modui-client-pedalboard.md` (the client) and `2026-10-modui-plugin-view.md` (the view).

## Context
Both packages were `private`, built only as browser globals (`html/js/lib/*.js`, git-ignored), and `modui-plugin-view` pointed its `exports` at
`src/index.ts`. That works inside the repository only: a package installed from a registry has no sources a bundler should compile, and
the view's own `mustache.ts` / `sprintf.ts` were re-implementations of two files mod-ui already ships (`html/js/lib/mustache.js`, `sprintf-0.6.js`).

Goal: a published package works when installed on its own (`npm install`, ESM import with types, or one `<script>` tag), without copying
or re-implementing any file of mod-ui, and without a backend change.

## Decisions
| # | Question | Decision |
|---|----------|----------|
| 1 | What is published | A build in `dist/`: `index.js` (ESM, one file, no dependencies), `index.d.ts` (+ one `.d.ts` per module) and `<name>.global.js` (the IIFE for a `<script>` tag). Sources are not published (`files: ["dist"]`). |
| 2 | Entry points | `src/index.ts` only exports (no side effect); `src/browser.ts` imports it and sets the `window` globals. The ESM build uses `index.ts`, the IIFE uses `browser.ts`, so `sideEffects: false` is true and importing the package never touches `window`. |
| 3 | Mustache and sprintf in the view | **Not re-implemented, not copied, not installed**: `src/vendor.ts` imports `html/js/lib/mustache.js` and `html/js/lib/sprintf-0.6.js` of the repository, and the build inlines them into `dist/`. The published package therefore has no `../../html` path and no runtime dependency. Result: exact parity with the classic UI (checked on the templates of the 182 bundles shipped by mod-desktop: whitespace, `&#x2F;` escaping, `%d` truncation). `mustache.js` is a CommonJS-compatible script and `sprintf-0.6.js` a script that declares a global function: a small build step (`vendor-plugins.mjs`: an esbuild plugin for the build and a Vite plugin for vitest) appends `export default <name>`. |
| 4 | `modui-client` from the view | Unchanged: type-only. In `package.json` it is an **optional peer dependency** (`"*"`), because the published `.d.ts` files import its types. |
| 5 | Monorepo development | `tsconfig.json` `paths` and the vitest alias keep resolving `modui-client` to its sources, so tests never need a build. The `exports` of each package point only at `dist/`. |
| 6 | Package names | Unscoped `modui-client` and `modui-plugin-view` (both free on the registry on 2026-10-13). A scope (`@mod-audio/…`) is a rename of the `name`, the imports in the docs and the `paths` alias; not decided here. |
| 7 | `private` | Removed from both. Publishing stays manual: `prepublishOnly` runs tests and the build, and `publishConfig.access` is `public`. Nothing in the repository runs `npm publish`. |
| 8 | License file | The repository's `LICENSE` is copied into each package by `prepack` (git-ignored there), so there is one license file in version control. The bundled Mustache (MIT) and sprintf (BSD-3-Clause) keep their notices, which are in the files themselves and survive the bundling (`--legal-comments=inline`). |
| 9 | README | One short `README.md` per package (the registry page): install, 10-line example, links to the guides in the repository. The long guides stay in `docs/`. |
| 10 | Tests of the engines | `engines.test.ts` now checks the behaviour the classic UI has (`&#x2F;`, `%d` truncates, `{{=…=}}`-free templates), plus a test that the bundle contains no `html/` path. |
| 11 | Install from GitHub | Verified 2026-10-13: `npm install github:mod-audio/mod-ui` installs the repository root (the `mod-ui` test package), npm has no subfolder syntax and `dist/` is not committed, so a git dependency cannot work; pnpm's `#path:/modui-client` refuses to build a git-hosted package unless the consumer allowlists it. Cloning and building was documented first and dropped. **Decided**: GitHub Releases, see decisions 12 to 15. |
| 12 | Release workflow | `.github/workflows/modui-packages.yml`: pull requests test and build; a push to `master` (and `feature/docs-api` until merged) that touches `modui-client/**`, `modui-plugin-view/**`, the two vendored files, `tools/**` or `LICENSE`, or a manual run from any branch, also creates the release. All the logic that can run on a laptop is `tools/pack-modui-packages.sh`. |
| 13 | Tag and version | The pipeline makes the tag, `YYYYMMDD-HHMMSS-<commit>` (UTC; `gh release create --target $GITHUB_SHA`). The tarballs carry `<version>-<YYYYMMDDHHMMSS>.g<commit>` (a prerelease of the `package.json` version). The `g` is needed: `0.1.0-….0123456` is not valid semver. Releases made with `GITHUB_TOKEN` do not trigger other workflows. |
| 14 | One release, both packages | The view's declarations are built against the client's, so both are built and released together. The release notes carry the install command. |
| 15 | Pre-release, no "latest" link, no cleanup | Releases are marked pre-release so the repository's "latest release" is never one of them. No `releases/latest/download/…` link (a lockfile pins the file's integrity; a link whose content changes fails `npm install` with `EINTEGRITY`). Old releases are not deleted. |

## Files
- `modui-client/`: `package.json` (scripts `build:esm`, `build:global`, `build:types`, `build:lib`, `prepack`, `prepublishOnly`), `tsconfig.build.json`, `README.md`, `src/index.ts` (exports only), `src/browser.ts` (globals).
- `modui-plugin-view/`: the same with `build.mjs` (esbuild API), plus `vendor-plugins.mjs` (+ `.d.mts`), `src/vendor.ts`, `src/vendor-modules.d.ts`, `test/bundle.test.ts`; removed `src/mustache.ts`, `src/sprintf.ts`.
- `.github/workflows/modui-packages.yml` and `tools/pack-modui-packages.sh` (release pipeline).
- `tools/add-dts-extensions.mjs`: adds `.js` to the relative imports of the emitted `.d.ts` files (needed by `node16` / `nodenext` consumers).
- `.gitignore`: `dist/` (already ignored) and the copied `LICENSE`.
- Docs: `CLAUDE.md`, `README.rst`, `docs/modui-client.md`, `docs/modui-plugin-view.md`, `docs/plans/2026-10-modui-plugin-view.md` (decision 3, 4).

## Verification
Done 2026-10-13: `npm test` in both (391 and 63 tests); `npm run build` and `npm run build:lib`; `npm pack` of each, installed into an empty project: an ESM `import` in
Node (`window` stays undefined), a TypeScript file that type-checks against the `.d.ts` with `moduleResolution` `bundler` and `node16`, and both IIFE files run in a bare
`window`. `npm pack --dry-run`: `dist/`, `package.json`, `LICENSE`, `README.md` and nothing else.

## Not done (needs the maintainers)
- Publishing to the npm registry (final names / scope, `npm login`, `npm publish`, ideally with `--provenance` in CI): not decided. The releases above do not need it.
- A `CHANGELOG` per package.
- The workflow has not run on GitHub yet: the script it calls was run locally end to end (tests, builds, stamped tarballs, installed into an empty project) and the release step's notes were generated with simulated variables.
