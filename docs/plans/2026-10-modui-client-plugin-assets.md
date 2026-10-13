# Plan: `modui-client` owns the assets of a plugin (modgui files, resources, images, user files)

Status: **implemented** (2026-10-13). Builds on `2026-10-modui-plugin-view.md` and brings back Phase 1 of `2026-10-modui-client-plugin-gui.md`
("assets and template context"), which the plugin-view plan had absorbed into the view package.

## Context
`modui-plugin-view` knew the backend: `urls.ts` built `/effect/file/…`, `/resources/…` and `/effect/image/…` URLs and the version string
that busts the cache, `assets.ts` fetched the modgui files and the default templates and kept a cache, and it read `GET /files/list` itself.
`modui-client` knew nothing of a plugin's GUI (`PluginInfo.gui` was typed with three of its keys, and the view cast it to
`Record<string, unknown>`). Two packages talked to the same endpoints, each with its own `fetch` injection point.

Rule applied: **the client knows the backend (endpoints, URLs, versions, caching, errors); the view knows how to render and drive a modgui.**

## Decisions
| # | Question | Decision |
|---|----------|----------|
| 1 | Where does it hang | `Plugin.gui` (`PluginGui`), built synchronously from the summary of `GET /effect/list` (it carries the four version fields and `buildEnvironment`). `client.device.plugins.get(uri \| summary)` returns a `Plugin` for a plugin the caller does not have from `list()`. |
| 2 | Names | Follow the existing ones: `getXUrl()` for URLs without a request (as `PedalboardImages`), `get(file)` / `getAll()` for the reads (the verb table has no `load`). |
| 3 | Version | `PluginGui.version` = `builder_micro_minor_release`, plus `_<stamp>` when the plugin has no `buildEnvironment` (a plugin being developed is never served from the browser cache). The stamp is taken when `PluginsApi` is created. The view's `ns` / `cns` use this same string, so a URL and a template can never disagree. |
| 4 | URLs | Same bytes as `html/js/modgui.js` (`escape()` of the URI), so the browser cache of the classic page is shared. |
| 5 | Which files exist | The summary has only `resourcesDirectory/screenshot/thumbnail`; the file names come with `GET /effect/get`. `get(file)` reads the (cached) description first and answers `null` for a file the plugin does not declare, without a request. |
| 6 | Failures | `get()` throws `ModUiHttpError`. `getAll()` never throws for a file: the failure goes to `errors` and the file is `null`, because a missing icon must not prevent the view. A failed read is not cached. |
| 7 | Cache | Text files are cached per URL (it carries the version) inside `PluginsApi`, shared by every `PluginGui`. `plugins.clearGuiCache()` forgets them. |
| 8 | Default templates | `plugins.getDefaultTemplates()` (`/resources/templates/pedal-default.html`, `/resources/settings.html`). Using them for a plugin without modgui is the view's decision; the client only returns what the plugin declares. |
| 9 | User files | New area `client.files.list(types)` (`GET /files/list`, `listUserFiles`), never cached. Returns `UserFile[]`. `upload` is not part of this plan. |
| 10 | HTTP | `HttpTransport.getText()`; unlike `getJson()` it does not send `cache: 'no-store'` (the URLs carry the version and the server marks them cacheable). |
| 11 | What stays in the view | Mustache, template data, widgets, script, `namespace()` (`ns` / `cns`), `rebaseUrls()`, the global stylesheets (`css/pedals.css`, `css/fonts.css`, `css/main.css` are files of the classic page, not API). `PluginViewsOptions.fetch` stays, only for `css/main.css`. |
| 12 | Breaking changes in the view | It no longer exports `renderedVersion`, `guiFileUrl`, `customFileUrl`, `resourceUrl`, `imageUrl` (and `ModUiPluginView.urls` keeps only `namespace` and `rebaseUrls`). `views.thumbnailUrl/screenshotUrl/resourceUrl` are removed: use `plugin.gui`. The package is unreleased. |

## API
```ts
const plugin = (await client.device.plugins.list()).find((p) => p.label === 'Fuzz')!;   // or: await client.device.plugins.get(uri)
const gui = plugin.gui;

gui.version;                         // "7_2_1_0"
gui.getFileUrl('stylesheet');        // GET /effect/file/stylesheet?uri=…&v=…       getPluginGuiFile
gui.getCustomFileUrl('img/a.png');   // GET /effect/file/custom?filename=…          getPluginGuiFile
gui.getResourceUrl('knob.png');      // GET /resources/knob.png?uri=…&v=…           getResource
gui.getThumbnailUrl();               // GET /effect/image/thumbnail.png?uri=…&v=…   getPluginImage
gui.getScreenshotUrl();

const css = await gui.get('stylesheet');          // string | null
const { iconTemplate, settingsTemplate, stylesheet, javascript, errors } = await gui.getAll();

const { iconTemplate, settingsTemplate } = await client.device.plugins.getDefaultTemplates();
const files = await client.files.list(['audiosample']);    // UserFile[]
```

## Backend change policy
None. Every endpoint already exists and is in `docs/openapi.yml` (`getPluginGuiFile`, `getResource`, `getPluginImage`, `listUserFiles`).

## Steps
1. Client: `plugin-gui.ts`, `files.ts`, `PluginInfo.gui` typed, `PluginsApi.get/getDefaultTemplates/clearGuiCache`, `HttpTransport.getText`, tests.
2. Plugin view: use `plugin.gui`, `client.files`; delete `assets.ts` (keep `loadImageSize`) and the URL builders of `urls.ts`.
3. Docs: guides, README, CLAUDE.md, implementation progress, diagrams, plans.

## Revisions
- **2026-10-13** — First version, implemented in the three steps.
