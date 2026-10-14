# Plan: `modui-plugin-view` – render and drive a plugin's GUI outside mod-ui

Status: **implemented** (2026-10-11), first version. Builds on `2026-10-modui-client-plugin-gui.md` (findings about the modgui files,
CORS and the plugin JavaScript contract) and on the live editing of the running pedalboard (`2026-10-modui-client-pedalboard-graph.md`,
`2026-10-modui-client-events.md`, `2026-10-modui-client-patch-params.md`, `2026-10-modui-client-presets.md`).

## Context
New frontends (a React/Vue/Svelte SPA, a kiosk page, a small control surface) should be able to manage a MOD device without loading the
classic UI. `modui-client` covers the data (pedalboards, plugins, params, presets, ...). What is missing is the **plugin GUI**: the pedal
drawn by the plugin's modgui (icon), its settings panel, and the behaviour of its knobs, switches, selectors and scripts.

In the classic UI that is `html/js/modgui.js` (3100 lines of jQuery + jQuery UI + Mustache + sprintf) plus the global stylesheets
`css/pedals.css` and `resources/pedals/default.css`. None of it can be imported by another frontend.

The user asked for a separate library at the repository root, `modui-plugin-view`, that may depend on `modui-client`. This settles open
question 2 of the plugin-GUI plan ("should the runtime live in the client?"): **no, in its own package**.

## Goals and non-goals
Goals:
- Render the **icon** and the **settings** panel of a plugin from its modgui files, exactly as the classic UI does (same template data,
  same `ns` / `cns`, same widgets), into plain `HTMLElement`s that any framework can place.
- Make them **live**: bound to a `PluginInstance` of the running pedalboard, the widgets move when anybody changes a value (classic UI, HMI,
  other clients) and user gestures write through `modui-client` (`param.setValue`, `instance.setActive`, `patchParam.setValue`,
  `instance.presets`).
- Run the plugin's own JavaScript (modgui `api_version` 3) when the page provides jQuery.
- Also render a **preview** of a catalogue plugin (no instance): local values only, for a plugin browser.
- No runtime dependencies (like `modui-client`): Mustache and sprintf are the classic UI's own files, inlined by the build (revised 2026-10-13), jQuery only injected.

Non-goals (first version; see "Future work"):
- Hardware addressing (`mod-address`, `presets-address`, momentary modes driven by an addressing).
- Dragging the block in a canvas (`mod-role=drag-handle`); `instance.setPosition` exists for that.
- Audio/MIDI/CV jack wiring (the `mod-role=*-port` elements are rendered and get the same classes, nothing more).
- T3K browsing, tablet gestures (`gesturestart`), the "blocked by addressing" notification.

## Decisions
| # | Question | Decision |
|---|----------|----------|
| 1 | Package | `modui-plugin-view/` at the root, same layout and toolchain as `modui-client/` (TypeScript, esbuild IIFE, vitest). Build output `html/js/lib/modui-plugin-view.js` (git-ignored), global `window.ModUiPluginView`. `package.json` `exports` pointed at `src/index.ts` in the first version; since 2026-10-13 it points at the publication build in `dist/` (`2026-10-modui-publishing.md`). |
| 2 | Dependency on `modui-client` | **Type-only** (`import type`). The application passes its `ModUiClient`; the view never bundles a second copy of the client (instanceof checks and the shared socket keep working). Resolved with a `paths` alias in `tsconfig.json` / `vitest.config.ts`. |
| 3 | Mustache | **Revised 2026-10-13**: the classic UI's own `html/js/lib/mustache.js` (0.5), imported by `src/vendor.ts` and inlined by the build (first version: a built-in subset, `mustache.ts`, which differed in blank lines and in escaping `/`). `options.mustache` still accepts any `Mustache.render`. |
| 4 | sprintf | **Revised 2026-10-13**: the classic UI's `html/js/lib/sprintf-0.6.js`, same mechanism (first version: a built-in `sprintf.ts`, whose `%d` rounded where the classic truncates and whose `%f` padded to six decimals, so a port limit read `0.00 dB` instead of `0 dB`). Unit formats (`%.1f dB`, `%d %%`) come from the plugin. The wrapper returns the value as text where the original throws. |
| 5 | jQuery | Required by the plugin JavaScript contract (`event.icon.find(...)`); some scripts also use the jQuery plugins the classic page loads (`jquery.svg.js` for x42). The script text is compiled like the classic `eval('method = ' + code)`, because some files put helper declarations after the function. Injected (`options.jQuery`, default `window.jQuery`). Without it the script is not run and the view emits `error` once (`context: 'script'`). The widgets themselves never use jQuery. |
| 6 | Plugins without modgui | The default templates of the classic UI are public static files: `GET /resources/templates/pedal-default.html` and `GET /resources/settings.html`. **No backend change.** (Answers open question 3 of the plugin-GUI plan.) Since 2026-10-13 the client reads them: `plugins.getDefaultTemplates()`. |
| 6b | Who knows the backend's URLs | **`modui-client`** (revised 2026-10-13, `2026-10-modui-client-plugin-assets.md`): the files, URLs, version and cache of a plugin are `plugin.gui`; the user files are `client.files`. The view builds no backend URL and its `fetch` option is only for `css/main.css`. |
| 7 | Root-relative URLs | Templates and stylesheets use `/resources/…` and `/effect/…`. They are rebased onto `client.baseUrl` (`src`, `href`, CSS `url()`); `get_custom_resource_filename` returns an absolute URL. No backend change. |
| 8 | CORS | Unchanged backend: a page on another origin cannot `fetch` the templates. Same origin, or a dev-server proxy (Vite `server.proxy`), is the supported way; documented. |
| 9 | Global stylesheets | `PluginViews` adds `<link>`s to `baseUrl/css/pedals.css`, `baseUrl/resources/pedals/default.css` and `baseUrl/css/fonts.css` once per document (`options.styles: false` turns it off). `css/main.css` (normalize + bootstrap + the plugin fonts Nexa, Questrial, …) is **not** linked: it restyles the whole page. Its `@font-face` rules are extracted and injected (`styles.fonts`, default on), and its `* { box-sizing: border-box }` (Bootstrap) is re-created scoped to the library's elements with `:where()` (no specificity), because pedals are laid out with it (x42 fil4 breaks without it). |
| 10 | Output ports | `modui-client` does not model `output_set`. `PluginViews` subscribes to `client.events.on('output_set')` when it is created and keeps the last value per port, so a view created later starts with the current meter values (the replay sends them). Feeds `change` events of the plugin script and `mod-role=output-control-value` fields. |
| 11 | Port groups | Resolved like `html/js/host.js` (`group`, `groupIndex`, `groupCssIndex`, `groupStart`, `groupEnd`, sorting) before the template data is built. |
| 12 | `sampleRate` ports | The classic UI multiplies their range by `SAMPLERATE` for display, while `Param` keeps the plain range and refuses larger values. The view keeps the plain range (what `Param.setValue` accepts). Documented limitation. |
| 13 | Preset name prompt | Save as / rename ask for a name with `options.promptName(title, current)` (async; default `window.prompt`). |

## API
```ts
import { ModUiClient } from 'modui-client';
import { PluginViews } from 'modui-plugin-view';

const client = new ModUiClient({ baseUrl: location.origin });
const views = new PluginViews(client, { jQuery: window.jQuery });   // once per client

// live: a plugin of the running pedalboard
const [instance] = await client.device.currentPedalboard.plugins.list();
const view = await views.create(instance);
iconBox.append(view.icon);            // <div class="mod-pedal" mod-instance="/graph/…">
settingsBox.append(view.settings);    // <div class="mod-settings">
view.on('change', ({ symbol, value, origin }) => …);
view.destroy();                       // unsubscribes, sends 'end' to the plugin script, removes the elements

// preview: a catalogue plugin, nothing is sent to the device
const plugin = (await client.device.plugins.list()).find((p) => p.label === 'Big Muff');
const preview = await views.create(plugin!);           // or a URI, or a PluginInfo
preview.setValue('gain', 0.5);                          // local only
```

`PluginView`: `icon`, `settings`, `uri`, `instance` (`null` for a preview), `info`, `live`, `alive`, `getValue(symbol)`,
`setValue(symbol, value)`, `getPatchValue(uri)`, `setPatchValue(uri, value)`, `active` / `setActive(active)`, `on(event)` (`change`,
`patch`, `active`, `preset`, `error`), `destroy()`.

`PluginViews`: `create(target, options?)`, URL helpers (`thumbnailUrl(uri)`, `screenshotUrl(uri)`, `resourceUrl(uri, path)`), `clearCache()`,
`destroy()`.

## Flow (live view)
1. `create(instance)`: `GET /effect/get` (the client's cached description, `instance.info`), then in parallel
   `GET /effect/file/{iconTemplate|settingsTemplate|stylesheet|javascript}` (only those the plugin has; default templates otherwise),
   `GET /effect/get_non_cached` through `instance.presets.list()`, and `GET /files/list?types=…` for each path parameter. Cached per
   plugin URI + version, like `loadedIcons` in `modgui.js`.
2. The stylesheet is rendered with `{ ns, cns }`, rebased and injected once per plugin (`<style data-modui-plugin="…">`).
3. Templates are rendered with the template data; `mod-role` elements get their widgets (`film`, `switch`, `bypass`, `select`,
   `custom-select`, `custom-select-path`, `string`), value fields, min/max labels and bypass lights, initialised from `param.value`,
   `instance.isActive()`, `patchParam.value` and `instance.preset`.
4. Subscriptions: `instance.on('param' | 'active' | 'patch' | 'preset' | 'removed')`, `instance.presets.on('list')`, `output_set`. The view's
   own writes carry `{ source: view }` and are ignored on the way back (`ignoreSource`), like the classic UI skips the widget that changed.
5. The plugin script gets `start { ports, parameters }`, `change { symbol | uri, value }`, `end`.

## Files
`modui-plugin-view/`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/views.ts` (`PluginViews`), `src/view.ts`
(`PluginView`), `src/binding.ts` (live / preview backends), `src/controls.ts` (one control: value, format, widgets, fields),
`src/widgets.ts`, `src/template-data.ts`, `src/image.ts`, `src/styles.ts`, `src/script.ts`, `src/urls.ts` (`ns` / `cns`, rebasing), `src/vendor.ts`,
`src/emitter.ts`, `src/types.ts`; tests in `test/` (happy-dom). Docs: `docs/modui-plugin-view.md`, README section,
CLAUDE.md, `.gitignore`, rows of `docs/modui-client/implementation-progress.md`.

## Backend change policy
No backend change. Candidates that would help, **not asked** (record the answer here if they are):

| Date | Change | Decision |
|------|--------|----------|
| – | CORS on `/effect/file/*`, `/resources/*`, `/files/list`, fonts, for a configurable list of origins | not asked; a proxy covers it |
| – | `output_set` in `modui-client` (`instance.outputs`) instead of the view's own cache | client-side, no backend change; future work |

## Tests
happy-dom. Mustache and sprintf against the forms modgui templates use. URL helpers, `ns` / `cns` escaping, rebasing (`src`, `href`,
`url()`, quotes, already absolute). Template data (flags, `steps`, `controls` with comment / scale points, skipped ports, groups, presets
split, parameters `control` / `string` / `path`). Widgets: filmstrip step math (linear, integer, logarithmic, enumeration, toggled,
`rangeSteps`), drag / wheel / click, switch toggle, trigger reset, bypass inversion and lights, custom select nearest value, path list
navigation. View with the **real** `ModUiClient` and a fake socket: initial values, remote `param_set` moves the widget, a drag sends
`param_set`, bypass sends `:bypass`, patch string field, preset load / save as, output values, plugin script events and disabling after a
throw, preview mode sends nothing, `destroy()`.

## Verification
`cd modui-plugin-view && npm test` (58 tests); `npm run build`. Manual (2026-10-11): a mod-ui with the fake host and the LV2 plugins of
`~/.lv2` (Big Muff, DS-1, mod-mixer and mod-arpeggiator with their scripts, x42 fil4 with jquery.svg), the example page on **another
origin** through `examples/serve.mjs`, driven by headless Chrome: every pedal rendered with filmstrip knobs measured, script-drawn meters
and LCDs, a knob drag reached the backend (`param_set`), the footswitch bypassed, the settings panel showed live values and presets; no
console error. Found and fixed on the way: Tornado's WebSocket Origin check behind a proxy (documented in `openapi.yml`), the script
compile form, the scoped `box-sizing`.

## Future work
- `output_set` in `modui-client` (decision 10).
- Addressing (`mod-address`, momentary) once the client covers addressings.
- Drag handle → `instance.setPosition`, jacks → `connections.connect`, for a full pedalboard canvas.
- A small React wrapper (`<PluginIcon instance={…} />`) as an example, not as a dependency.

## Revisions
- **2026-10-13** — Prepared for publication (`2026-10-modui-publishing.md`): `mustache.ts` and `sprintf.ts` removed in favour of the classic UI's files (`vendor.ts`), `index.ts` / `browser.ts` split, `dist/` builds.
- **2026-10-13** — The plugin's files, URLs, version stamp and cache, and the user files, moved to `modui-client` (`plugin.gui`, `plugins.getDefaultTemplates()`,
  `client.files.list()`). Removed from the view: `assets.ts` (`AssetLoader`), the URL builders and `renderedVersion` of `urls.ts` (and their exports),
  `PluginViews.thumbnailUrl/screenshotUrl/resourceUrl`. `ViewClient` gained `files`.
- **2026-10-11** — First version, implemented. After the browser test: scoped `box-sizing`, classic script compile form, `jquery.svg`
  note, proxy Origin rewrite. Known difference left: the bottom row of x42 fil4 overflows its panel (another rule of `main.css`).
