# Plan: `ModUiClient` – plugin GUI (modgui) for external frontends, and pedalboard metadata

Status: **plugin GUI part superseded** (2026-10-11) by `2026-10-modui-plugin-view.md`: the rendering and the runtime live in a
separate package, `modui-plugin-view/`, which answers open questions 1-3 (phases 1-3 implemented there; jQuery injected; default templates
read from `/resources/`). The pedalboard metadata part below is still a proposal. Original status: proposal (2026-10-07). Builds on `2026-10-modui-client-pedalboard.md` (client, `Device`, `events`)
and on `2026-10-modui-client-pedalboard-graph.md`, which already proposes `device.plugins.list()` and `Plugin.info()`.
This plan **adds** to `Plugin`; it does not redefine the catalogue.

## Context
New frontends will not necessarily be served by mod-ui; they will use `modui-client` to talk to the backend. Two questions came up:

1. Can metadata be saved for a pedalboard (even only the loaded one)?
2. Can a plugin be rendered in a frontend that has nothing of mod-ui, using the APIs plus the `.html` / `.js` / `.css` of the
   plugin's modgui bundle?

Findings (verified in the code on 2026-10-07):

### Pedalboard metadata
- No generic mechanism. `POST /pedalboard/save` takes only `title` and `asNew`. What is persisted in the bundle is
  `manifest.ttl`, `<titlesym>.ttl`, `addressings.json` and `snapshots.json` (`Host.save_state_to_ttl`, `mod/host.py`).
- Saving an **existing** bundle writes only those files, so extra files inside it survive. But no endpoint reads or writes
  arbitrary files in a bundle; `POST /files/upload` accepts only `.nam`, `.wav`, `.aidax` into `USER_FILES_DIR`.
- "Save as", and saving a **factory** pedalboard, create a **new** bundle (new `bundlepath`) and copy nothing extra.
  `GET /pedalboard/factorycopy/` uses `shutil.copytree`, so it does keep extra files.
- `POST /config/set` stores an arbitrary key/value in the global preferences. It is global (not per pedalboard) and the
  values are only exposed inside the server-rendered index page (`preferences`), with no JSON endpoint, so an external
  frontend cannot read them cleanly.

### Plugin GUI
- Data: `GET /effect/list` (summary, includes version numbers), `GET /effect/get?uri=` (full `PluginInfo` with `gui`: file
  names, `brand`, `label`, `color`, `knob`, `panel`, `ports`, `templateData`).
- Files: `GET /effect/file/{iconTemplate|settingsTemplate|stylesheet|javascript|screenshot|thumbnail|custom}?uri=` and
  `GET /resources/<path>?uri=` (plugin resources first, then the shared `html/resources`).
- What the classic UI does on top (`html/js/modgui.js`) and an external frontend must replace:
  1. **Mustache** rendering of the icon / settings templates and of the stylesheet (`ns`, `cns` and the template data built by
     `getTemplateData`: `effect`, `brand`, `label`, `color`, `knob`, `model`, `panel`, `controls` with `comment` and
     `scalePoints`, ports flagged `enumeration` / `integer` / `logarithmic` / `toggled` / `trigger`, `steps`).
  2. **Behaviour of `mod-role=…`**: the HTML is inert; knobs, filmstrips, switches, bypass, presets and value fields are wired
     by `modgui.js` and the jQuery widgets (`controlWidget`: `film`, `switch`, `bypass`, `select`, `custom-select`, …).
  3. **Plugin JavaScript contract** (`api_version` 3): the file is a function expression `function (event, funcs)`, loaded
     with `eval`. Events: `start { parameters, ports }` (ports include `:bypass`), `change { symbol, value }` or
     `change { uri, value }` for patch parameters, `end`. Every event also carries `api_version`, `data` (plugin-private
     object that persists between events), `icon` and `settings` (**jQuery objects**). `funcs`: `set_port_value`,
     `patch_get`, `patch_set`, `get_custom_resource_filename`, `get_port_index_for_symbol`, `get_port_symbol_for_index`.
  4. **Live values** over the WebSocket (`param_set`, `output_set`, `patch_set`) and back (`param_set` command).
- **CORS**: only some handlers answer `Access-Control-Allow-Origin`, and only for `mod.audio` / `moddevices.com` origins (and
  `:9000` for some). A frontend on another origin is blocked by the browser, for HTTP and for plugin files. Same origin or a
  reverse proxy is the way without backend changes.
- Templates and `get_custom_resource_filename` use **root-relative** URLs (`/resources/…`, `/effect/file/custom?…`), which
  resolve against the frontend's origin, not mod-ui's.

## Goals and non-goals
Goals: give an external frontend everything it needs to render a plugin without importing the classic UI: URLs, fetched
files, the template context, a pluggable renderer and URL rebasing; optionally a headless runtime for the plugin JavaScript.

Non-goals (stay out of the client): reimplementing the `mod-role` widgets (knobs, filmstrips…) and shipping Mustache or jQuery.
The client has **no runtime dependencies** (CLAUDE.md), so rendering libraries are injected by the consumer.

## Proposed API

### Phase 1: assets and template context (no DOM, no WebSocket)
```ts
const plugin: Plugin = (await client.device.plugins.list()).find(p => p.uri === uri)

// Synchronous URLs (no request), cache-busted with the plugin version like modgui.js does
plugin.gui.getFileUrl('stylesheet')          // baseUrl + /effect/file/stylesheet?uri=…&v=…
plugin.gui.getCustomFileUrl('img/logo.png')  // /effect/file/custom?filename=…&uri=…&v=…
plugin.gui.getResourceUrl('pedal.png')       // /resources/pedal.png?uri=…&v=…
plugin.gui.getThumbnailUrl() / getScreenshotUrl()   // /effect/image/{thumbnail|screenshot}.png?uri=…

// One call that fetches info + the four text files in parallel
const gui: PluginGuiBundle = await plugin.gui.load()
//   gui.hasModgui, gui.iconTemplate, gui.settingsTemplate, gui.stylesheet, gui.javascript, gui.info, gui.templateContext

// Rendering with a library the consumer owns
const { icon, settings, css } = gui.render({ mustache: Mustache.render })
// icon / settings / css are strings with every root-relative URL rebased onto client.baseUrl
```
- `Plugin.gui` is a `PluginGui` built from the summary (`uri` + `builder`/`microVersion`/`minorVersion`/`release`), so URL
  builders are synchronous. `renderedVersion = [builder, microVersion, minorVersion, release].join('_')`, exactly as `modgui.js`.
  `ns` = `?uri=<escape(uri)>&v=<renderedVersion>`; `cns` = `_` + uri with `/`, `%`, `.` replaced by `_` + version.
- `load()` uses `GET /effect/get` (`getPlugin`) and `GET /effect/file/{prop}` (`getPluginGuiFile`). A prop is only requested when
  `info.gui[prop]` is non-empty. A plugin with no modgui yields `hasModgui: false` and falls back to a built-in default template
  (the classic UI uses `default_icon_template`, see `PluginGui` / index data in `docs/openapi.yml`); open question 3.
- `templateContext` is a **pure function** `buildTemplateContext(info, { namespace })` ported from `getTemplateData`, with the
  UI-only parts left out (no `self.controls` values; `comment` / `scalePoints` come from `info.ports`). It is exported on its
  own so it can be unit-tested against fixtures and reused outside `load()`.
- `render()` takes an injected `{ mustache: (template, view) => string }`. Rebasing rewrites `/resources/`, `/effect/` and
  `/effect/file/custom` occurrences in `src="…"`, `href="…"` and CSS `url(…)` to `baseUrl + path`. Option `rebase: false`
  disables it for same-origin pages.
- Errors: `ModUiHttpError` for non-2xx (a `404` on a prop means the plugin has no such file); `ModUiError` for a missing
  `mustache`. Each public method documents its `operationId` in TSDoc, per CLAUDE.md.

### Phase 2: headless plugin runtime (optional; decide before implementing)
```ts
const runtime = gui.createRuntime({
  $: jQuery,                       // plugins call event.icon.find(...), so jQuery is required by the contract
  icon: $iconElement, settings: $settingsElement,
  onSetPortValue: (symbol, value) => instance.setParam(symbol, value),   // needs graph plan "separate suggestions"
  onPatchGet: …, onPatchSet: …,
})
runtime.start({ ports, parameters })     // event 'start'
runtime.change({ symbol, value })        // event 'change'
runtime.end()                            // event 'end', also disables the script after an exception, like the classic UI
```
Implements `api_version` 3: `eval` of the script, the `data` bag, `funcs` (with `get_custom_resource_filename` returning an
absolute URL on `baseUrl`), and the "disable the callback after it throws" behaviour of `triggerJS`. It does **not** build the
DOM or wire `mod-role` widgets. Whether it belongs in the client at all is open question 2.

### Phase 3: live values (depends on the graph plan)
`PluginInstance` (graph plan) gets `gui` (its plugin's `PluginGui`) and the live `param_set` / `output_set` frames; the runtime
`change` events are fed from them. Not designed here beyond that: it needs the `setParam` / `bypass` suggestions of the graph plan.

## Pedalboard metadata

| Option | What | Backend change |
|--------|------|----------------|
| A. Client-side store (**proposed**) | `reference.metadata.get()` / `set(value)` / `update(patch)` on a `PedalboardReference`, persisted by an injected `MetadataStore` (`ModUiClientOptions.metadataStore`; default in-memory; the consumer can pass `localStorage`, a file, its own backend). Keys are the `bundlepath`. | none |
| B. Global prefs | `POST /config/set` with key `meta:<bundlepath>` | none, but not readable from an external frontend (see Context); **not recommended** |
| C. File in the bundle | `GET` / `POST /pedalboard/metadata?bundlepath=` storing `metadata.json` in the bundle; `Host.save` for "save as" and factory pedalboards copying it; `factorycopy` already keeps it | **yes**, to be asked |

Option A rules, so metadata does not get orphaned:
- `currentPedalboard.saveAs()` and `save()` on a factory pedalboard create a new `bundlepath`. The client moves the entry from
  the old key to the new one (`store.move(old, new)`), because it knows the result of the save. `copy()` can copy the entry too.
- `reference.delete()` deletes the entry.
- Renaming through `save(newTitle)` keeps the `bundlepath`, so nothing to do.
- Edits made outside the client (the classic UI, a device in the field) are invisible to the store; documented limitation.
- Metadata is *per bundle*, not per snapshot.

## Backend change policy for this area
No backend change is planned. Candidates to **ask the user before doing** (record the answer here):

| Date | Change | Decision |
|------|--------|----------|
| – | `GET` / `POST /pedalboard/metadata` + `metadata.json` in the bundle (option C), copied on save-as | not asked yet |
| – | CORS: allow a configurable list of origins on `/effect/*` and `/resources/*` (today only `mod.audio` / `moddevices.com`) | not asked yet |
| – | Make templates and `get_custom_resource_filename` independent of the page origin (relative to a base) | not asked yet; client-side rebasing covers it |

## Files (when implemented)
`src/plugin-gui.ts` (`PluginGui`, `PluginGuiBundle`, `buildTemplateContext`, URL rebasing), `src/plugin-gui-runtime.ts`
(phase 2, only if accepted), `src/metadata.ts` (`MetadataStore`, `InMemoryMetadataStore`, `PedalboardMetadata`),
`src/plugins.ts` (graph plan; gains `Plugin.gui`), `src/pedalboards.ts` (`reference.metadata`), `src/current-pedalboard.ts`
(moves the entry on `saveAs`), `src/types.ts` (wire types: `PluginGui` fields, `templateData`), `src/client.ts`
(`metadataStore` option), `src/index.ts` (exports), one test file per module,
`docs/openapi.yml` (CORS behaviour, root-relative URLs in templates, `/resources/` fallback, `custom` content types, `ns` / `cns`
semantics, the `save` / "save as" / factory bundlepath rules), `docs/modui-client.md` (+ Mermaid class diagram and a sequence
diagram of `load()` → `render()`), README section, CLAUDE.md "Current scope".

## Tests
Fakes from `test/helpers.ts` (`makeClient`, fake `fetch`). `buildTemplateContext` against a recorded `PluginInfo` fixture (flags,
`steps`, `controls`, `ns` / `cns`, escaping of `%`, `.`, `/` in the URI). URL builders (version, `custom`, escaping). `load()`:
requests only the props that exist, in parallel; plugin without modgui; `404` on a file; `render()` with a fake mustache;
rebasing in `src`, `href` and `url()`, with and without `rebase`; missing renderer. Runtime (if accepted): event order and
payloads, `data` persistence, a throwing script is disabled, `funcs`. Metadata: get / set / update, move on `saveAs`, delete on
`remove`, store injection, in-memory default.

## Verification
`cd modui-client && npm test`; `npx @redocly/cli lint docs/openapi.yml` (skip-rules in CLAUDE.md). Manual with
`MOD_DEV_HOST=1 MOD_DEV_ENVIRONMENT=0 python3 ./server.py`: a small static page on a **different origin** (behind a proxy, because
of CORS) that loads one modgui plugin and shows the rendered icon with its stylesheet and images. If no server or plugin with a
modgui is available, report that this step was not run.

## Open questions
1. Scope: Phase 1 only now (proposed), or also the runtime (phase 2)?
2. Should the plugin runtime live in the client? It requires jQuery to honour the plugin contract, which conflicts with
   "no runtime dependencies" unless injected (proposed), or it ships as a separate package.
3. Plugins without a modgui: should `render()` use a default template (needs the classic UI's `default_icon_template`, exposed
   in the index data) or only report `hasModgui: false` and leave the fallback to the consumer (proposed)?
4. Metadata: option A (proposed) now, with option C recorded as a candidate, or ask for option C right away?
5. Keys of the metadata store: `bundlepath` (proposed), or also `title`?
6. Shared `webSocket` and phase 3 inherit open question 1 of the graph plan.

## Revisions
- **2026-10-07** — First draft.
- **2026-10-11** — Plugin GUI implemented as `modui-plugin-view` (see `2026-10-modui-plugin-view.md`); `Plugin.gui` in the client is not
  needed. Metadata unchanged.
