# Plan: `ModUiClient` – plugin presets (`instance.presets`)

Status: **implemented** (2026-10-11), unit tests only; not checked against a device (see "Verification"). Phase 5 (`plugin.presets()` on the catalogue) was left out. Builds on `2026-10-modui-client-pedalboard-graph.md` (`PluginInstance`, the device queue),
`2026-10-modui-client-events.md` (`Emitter`, `origin` / `source`, `instance.on('preset')`) and `2026-10-modui-client-snapshots-banks.md`
(a snapshot also stores one preset per plugin, which is why loading a snapshot already produces `preset` frames).
It covers the 4 operations of the `Presets` section of `docs/openapi.yml` and the read side of the same data, which
`docs/modui-client/implementation-progress.md` already lists with these names as the recommendation:
`instance.presets.load(presetUri)`, `create(name)`, `save(preset, name?)`, `delete(preset)` (the vocabulary of `CLAUDE.md`, "Method names": `create` makes a
new saved entity, `save` writes the live state into an existing one, `delete` destroys a saved entity).

("Effect patch" in the request was taken as the plugin presets of the `/effect/preset/*` routes; the LV2 *patch parameters* are a different
feature, already done in `2026-10-modui-client-patch-params.md`.)

## Context
A *preset* is a named set of control-port values of **one plugin** (an LV2 preset). The classic UI shows them in the plugin's settings
panel (`mod-role=presets`), split into **factory** presets (shipped with the plugin) and **user** presets (saved by the user, which can be
overwritten, renamed and deleted). Today the client only mirrors which preset is current: `instance.preset` (URI or `null`) and
`instance.on('preset')`, fed by the `preset` frame. It cannot list, load, save or delete one.

## Findings (verified in the code on 2026-10-11)

### The data
- Presets belong to the **plugin URI**, not to the instance: two instances of the same plugin see the same list, and a preset saved from one
  appears for the other. User presets live on the device (`LV2_PLUGIN_DIR`, one LV2 bundle per preset) and outlive pedalboards.
- `GET /effect/get` (`PluginInfo.presets`, cached by `PluginsApi`) and `GET /effect/get_non_cached` (`NonCachedPluginInfo.presets`, volatile)
  both return `PluginPreset { valid, uri, label, path }`. **The cached list goes stale** after every save or delete, which is why the
  classic UI reads `get_non_cached` (`html/js/modgui.js`). The client types `PluginInfo.presets` nowhere today (it falls in `[other: string]: unknown`).
- `path` is **the preset's bundle directory** for a user preset and `""` for a factory one (`utils_lilv.cpp`: a bundle with one preset that is
  not the plugin's own bundle). The schema text says "File path of the preset"; the classic UI passes it as `bundle` to replace / delete.
  Both `save_replace` and `delete` need that bundle path.
- A user preset URI is `file://<bundle>/<symbol>.ttl`, where `<symbol>` is the name made into a symbol and cut to 32 characters. Labels are
  not unique.

### The operations (`mod/webserver.py` 1078-1160, `mod/host.py` 2830-3035)
| Operation | What the backend does | Frames to other sockets | Answer |
|---|---|---|---|
| `GET /effect/preset/load/{instance}?uri=` | `preset_load` in mod-host, then `preset_show`; sets the instance's port values | `preset <instance> <uri>` then `param_set` for each port whose value changed (not for ports with a designation); also HMI update | `true` / `false` |
| `GET /effect/preset/save_new/{instance}?name=` | `preset_save` of the **live values** into a new bundle; the instance's current preset becomes the new one | **none** | `{ ok, bundle, uri }` |
| `GET /effect/preset/save_replace/{instance}?uri&bundle&name` | needs `uri` == the instance's **current** preset and an existing bundle; rewrites the bundle with the **live values** under the new name | **none** | `{ ok, bundle, uri }` (the URI changes with the name) |
| `GET /effect/preset/delete/{instance}?uri&bundle` | needs `uri` == the instance's current preset and an existing bundle; removes the bundle | `preset <instance> null` | `true` / `false` |

Consequences:
- **No `preset` frame for a save**, so neither the classic UI's other tabs nor this client's model learn that the current preset changed. The
  client must apply it itself (`GraphState.applyLocal('preset', ...)`, as it does for `param_set`).
- **"Rename" is a replace**: the classic UI's rename button calls `save_replace`, which also **overwrites the preset's values with the live ones**.
  There is no rename-only operation.
- **Replace and delete only work on the instance's current preset.** Anything else answers `{ ok: false }` / `false` with no explanation.
- `preset_save_replace` removes the old files first and, if mod-host then fails, `rmtree`s the bundle: **a failed replace loses the preset**.
- The load answer waits for the HMI when it is up (up to 10 s) and is `false` on that timeout **although the preset was applied**; it is also
  `false` when another load interrupted it or the preset URI is unknown.
- Writes through the web mark the pedalboard as modified (`preset_load` uses `send_modified`); save / replace / delete do not.
- Unknown instance: the handlers raise (`get_id_without_creating`), an HTTP 500, not `false`. The client must check first.
- Names go into a mod-host text command: only `"` is escaped. A newline splits the command, and a trailing backslash would escape the closing
  quote. Labels are not checked for blanks (an empty name gives a bundle file called `.ttl`).
- Re-addressing: save / replace / delete re-send the HMI preset selector options when the instance's `:presets` is addressed; load updates the
  HMI value. The client cannot see addressings and does not refuse.

### What the client already has
`ModelPlugin.preset` / `GraphChange 'preset'` / `instance.preset` / `instance.on('preset', { preset, previous })` / `PluginSnapshot.preset`;
`PluginsApi.info()` cache; `PedalboardStore.expect()`; `GraphState.applyLocal()`; the device queue; `WriteOptions`. Nothing needs to change in the
frame parsing.

## Requested API (`instance.presets`)
```ts
const presets = instance.presets;                       // PluginPresets, one per PluginInstance

await presets.list(): Promise<Preset[]>                 // GET /effect/get_non_cached (always fresh); factory and user presets
await presets.get(uri): Promise<Preset | undefined>
presets.current: Preset | null                          // sync: the object for instance.preset, once the list was read
presets.currentUri: string | null                       // sync, same as instance.preset

await presets.load(presetOrUri, { source? }): Promise<void>
await presets.create(name, { source? }): Promise<Preset>
await presets.save(preset, name?, { source? }): Promise<Preset>   // name defaults to the preset's label
await presets.delete(preset, { source? }): Promise<void>

preset.uri; preset.label; preset.bundlepath: string | null; preset.isUser; preset.isCurrent; preset.alive
await preset.load({ source? }); await preset.save(name?, { source? }); await preset.delete({ source? })

presets.on('list', handler, options?); presets.once(...)
```
`save` and not `rename`, because it overwrites the values (see above; the rename is `save(preset, newName)`); the TSDoc says so in the first line. `delete` is `presets.delete(preset)`
as in the progress table; `preset.delete()` is the same call.

## Design

### Types (`src/types.ts`)
`PluginPresetInfo { valid, uri, label, path }`, `NonCachedPluginInfo { licensed?, presets }`, `PresetSaveResponse { ok, bundle?, uri? }`, and
`PluginInfo.presets?: PluginPresetInfo[]`.

### Model and identity (`src/plugin-presets.ts`, new)
- A `PresetCatalog` per plugin URI, owned by `PluginsApi` (so every instance of the plugin shares it): the last list read (`null` until read) and
  an `Emitter<{ list }>`. `PluginPresets` is the per-instance view (it adds the instance for the writes and for `current`).
- `Preset` objects are stable. A **user** preset is identified by its **bundle path** (it survives `save`, which changes the URI and label),
  a **factory** preset by its URI. `list()` reconciles with the previous list by those keys: matching entries keep their object and get the new
  `uri` / `label`; new ones create objects; missing ones become `alive === false` and keep their last values.
- `preset.uri` and `preset.label` are live getters, like `Snapshot.index`.
- `instance.info.presets` (the cached `PluginInfo`) is **updated in place** after the client's own writes and reads, so code that reads it sees the
  list the catalog has (`PluginsApi.updatePresets(uri, presets)`; one shared object per plugin URI). It is documented as "current as of the last
  `presets.list()` or write of this client"; `presets.list()` is the reliable read.
- Nothing is requested by an event. `list` fires when a read or a write changes the catalog, with `origin` and `source` like the other events;
  changes by other clients are not announced (the backend sends nothing for them) and are found by calling `list()` again.

### Flows (all through the device queue, after `state.ready()`)
- **`list()`**: `GET /effect/get_non_cached?uri=` (`getPluginNonCached`), reconcile, emit `list` only if something differs. A plugin that is not
  installed has no catalog: `ModUiError` ("the plugin is not installed", the backend answers 404).
- **`get(uri)`**: `list()` and a lookup.
- **`load(target)`**: `target` is a `Preset` or a URI string. Checks the instance is alive (else `ModUiError`, no request). Registers
  `store.expect(change => (change.type === 'param' || change.type === 'preset') && change.instance === path, source)` **before** the request,
  because the `preset` and `param_set` frames arrive before the HTTP answer, then `GET /effect/preset/load/{instance}?uri=` (`loadPreset`).
  `false` becomes `ModUiError` whose text lists the causes (unknown preset, interrupted, **or the HMI did not answer within 10 s although the
  preset may have been applied**). The model is already updated by the frames; after a `true` answer the client does not apply anything itself.
- **`create(name)`**: validates the name (below), `GET /effect/preset/save_new/{instance}?name=` (`savePresetAsNew`). On `{ ok: true }`:
  read the list again (`get_non_cached`, one request, needed because the new preset's label is the backend's), apply
  `applyLocal('preset', '<instance> <uri>', source)` so `instance.preset` and `instance.on('preset')` show the new current preset, and return the
  `Preset` found by `bundle`. `{ ok: false }` becomes `ModUiError`.
- **`save(preset, name?)`**: requires, **before any request**: the preset is alive and a user preset (`bundlepath !== null`; factory
  presets are read-only: `ModUiError` pointing to `create`), and it is the instance's current preset (`instance.preset === preset.uri`; else
  `ModUiError` "load the preset first": the backend would answer `ok: false`). `GET /effect/preset/save_replace/{instance}?uri&bundle&name`
  (`savePresetReplace`); on success `applyLocal('preset', ...)` with the **new** URI, re-read the list, the same `Preset` object now shows the
  new `uri` / `label`. On `{ ok: false }` the preset may be gone (see above): re-read the list before throwing, so `alive` tells the truth.
- **`delete(preset)`**: same two preconditions as replace. `GET /effect/preset/delete/{instance}?uri&bundle` (`deletePreset`), with
  `store.expect(change => change.type === 'preset' && change.instance === path, source)` registered before, because the backend broadcasts
  `preset <instance> null`. `false` becomes `ModUiError`. Then re-read the list; the object becomes `alive === false`.
- Every write that succeeds updates the shared catalog, so **other instances of the same plugin** see the new list through their own `presets`
  (and a `list` event); their `current` is unchanged.

### Name rules (checked before any request)
Non-empty after `trim()` (the trimmed text is sent), no control characters (a newline splits the mod-host command), no backslash (a trailing one
would escape the closing quote of the command; the backend escapes only `"`). Labels may repeat. Nothing else is checked: the length of the
bundle symbol (32) is the backend's.

### Errors
`ModUiError`: instance gone, plugin not installed, preset gone or of another plugin, factory preset where a user one is needed, not the current
preset (replace / delete), invalid name, every `false` / `ok: false` answer. `ModUiHttpError` for non-2xx. No `ModUiTimeoutError`.

### Events
| Event | When | Payload |
|---|---|---|
| `presets.on('list')` | the plugin's list changed (a read that differs, or this client's save / replace / delete) | `{ presets: readonly Preset[], origin, source? }` |
| existing `instance.on('preset')` | the current preset changed: load, delete, **and now the client's own saves** (via `applyLocal`) | `{ plugin, preset, previous, origin, source? }` |

## Backend questions (`CLAUDE.md`: ask before touching `mod/`)
Nothing below is needed to deliver the client; each is a limit the client works around and documents.

| # | Limit | Workaround | Possible backend change | Decision |
|---|---|---|---|---|
| 1 | `save_new` / `save_replace` send no `preset` frame, so other sockets do not learn the new current preset | the client applies it locally; other clients find out by reading `instance.preset` after a `list()` | broadcast `preset <instance> <uri>` after a save | not asked yet |
| 2 | A failed `save_replace` removes the preset bundle | none (documented; the list is re-read so `alive` is right) | restore or keep the old files on failure | not asked yet |
| 3 | The load answer is `false` on the 10 s HMI timeout even when the preset was applied | message lists the cause | answer `true` and report the HMI failure separately | not asked yet |
| 4 | Replace and delete work only on the current preset, and fail silently otherwise | the client checks first | accept any user preset of the instance's plugin | not asked yet |
| 5 | No rename-only operation (a rename overwrites the values) | document | `rename` endpoint | not asked yet |
| 6 | `PluginInfo.presets` from `GET /effect/get` is cached and goes stale | read `get_non_cached`; update the shared cached info in place | none needed | – |
| 7 | An unknown instance gives HTTP 500 | the client checks first | return `false` | not asked yet |
| 8 | Names with `\` or a newline can break the mod-host command | the client refuses them | escape in `preset_save` | not asked yet |

## Files to touch (when implemented)
New: `src/plugin-presets.ts` (`Preset`, `PluginPresets`, `PresetCatalog`, name check), `test/plugin-presets.test.ts`.
Changed: `src/types.ts` (the wire types above), `src/plugins.ts` (catalog per URI, `updatePresets`), `src/pedalboard-graph.ts` (`PluginInstance.presets`
and the engine calls `loadPreset`, `savePreset`, ... or a small `PresetOps` like `PatchParam`'s), `src/index.ts` (exports and `window.ModUi`),
`test/helpers.ts` (a fake preset backend with the rules above: current-preset checks, bundle paths, `preset` / `param_set` frames on load, the
`preset null` frame on delete, no frame on saves).

## Docs to update (the `CLAUDE.md` rules)
1. `docs/openapi.yml`: `PluginPreset.path` is the bundle directory of a **user** preset and empty for a factory one; `loadPreset` frames, the HMI
   timeout and the `false` cases; `savePresetAsNew` / `savePresetReplace`: no `preset` frame, live values are saved, replace changes the URI and
   requires the current preset, and a failure removes the bundle; `deletePreset`: current preset only; `getPluginNonCached` is the way to read fresh
   presets (`getPlugin` is cached). `npx @redocly/cli lint docs/openapi.yml` with the skip flags of `CLAUDE.md`.
2. `docs/modui-client/implementation-progress.md`: the 4 Presets rows get their "Implemented" cell, and the `GET /effect/get_non_cached` row (today
   not covered) points to `presets.list()`; then `python3 docs/modui-client/sync-progress.py`.
3. `docs/modui-client.md`: a quick-start section, the class diagram (`PluginPresets`, `Preset`), a sequence diagram of `save` (preconditions,
   request, local `preset`, re-read), the limitations list. `README.rst` and `CLAUDE.md` (scope line, module list).
4. TSDoc with the backend calls, `operationId`s, errors and an `@example` on every public symbol.

## Tests (`test/plugin-presets.test.ts`)
`list()`: factory and user presets (`path` empty or a bundle), always `get_non_cached`, same objects across reads, reconcile (a user preset kept by
bundle although URI and label changed, a factory one by URI, a missing one `alive === false`), `list` event only on a difference. `load()`: request
with the encoded URI, frames tagged `local` with the `source` (`preset` and `param_set`), frames of another instance or after the answer `remote`,
`false` is an error with the three causes, a gone instance sends nothing, a URI string and a `Preset` both work. `create()`: name rules (blank,
newline, backslash, trimmed), the model gets the new current preset with `origin: 'local'`, `instance.on('preset')` fires, the returned `Preset` is
found by bundle, `info.presets` updated in place, another instance of the same plugin gets the `list` event, `ok: false` is an error. `save()`:
refused for factory presets and for a preset that is not current (nothing sent), success keeps the object and changes `uri` / `label`, defaults the
name to the label, `ok: false` re-reads the list (the preset can turn `alive === false`). `delete()`: same preconditions, `preset null` frame tagged
local, the object dies, `false` is an error. Writes are queued behind a running `device.load()`. A pedalboard load kills the instance and its
`Preset` objects' operations reject.

## Phases
1. Types, `PresetCatalog`, `PluginPresets.list/get/current`, the in-place update of the cached info. Tests.
2. `load` with the expectation. Tests.
3. `create`, `save`, `delete` with the local `preset` and the re-read. Tests.
4. Docs.
5. Optional: a read-only `plugin.presets()` on the catalogue `Plugin` (`PluginsApi.list()`), for plugins that are not in the pedalboard.

Each phase ends with `npm test`; phase 4 with the lint and `sync-progress.py --check`.

## Verification
`cd modui-client && npm test`; the lint and `sync-progress.py --check`. On the dev server with a plugin that has factory presets: load one and
watch the classic UI selector follow; `create('Mine')` and see it in the classic UI after a reload; `save` after loading it, `delete`.
**Not verifiable without a device**: the 10 s HMI case of `load`, re-addressing of `:presets`, and whether patch-parameter values are part of a
preset (the host's `get_state_port_values` reads only ports, so the client does not expect `patch_set` frames from a load).

## Open items
1. ~~Name of the overwrite-and-rename operation~~ — **Decided (2026-10-11):** `save`, from the client-wide vocabulary (`create`, `save`, `delete`).
2. **Backslash in names**: refused (proposed). Relax it if mod-host's parser is shown to handle it.
3. **Updating the cached `PluginInfo.presets` in place** (proposed) or only exposing the catalog. In place keeps `instance.info.presets` honest for
   code written before this API; the cost is mutating an object the client hands out.
4. **`presets.current` before the first `list()`**: `null` (proposed); `currentUri` is always available.
5. **Factory presets and `path`**: a plugin whose user bundle holds several presets is not modifiable according to `utils_lilv.cpp`; it is listed
   as a non-user preset (`bundlepath === null`).

## Implementation notes (2026-10-11)
- Files: `src/plugin-presets.ts` (`Preset`, `PluginPresets`, `PresetCatalog`, `PresetEngine`), `test/plugin-presets.test.ts` (31 tests); changed `src/types.ts`
  (`PluginPresetInfo`, `NonCachedPluginInfo`, `PresetSaveResponse`, `PluginInfo.presets`), `src/plugins.ts` (`presetCatalog(uri)`, which keeps `info.presets`
  up to date in place), `src/pedalboard-graph.ts` (`PluginInstance.presets`, `InstanceOps.presetCatalog` / `presetEngine`), `src/index.ts`, `test/helpers.ts`
  (`fakePresetBackend`).
- **`Preset` objects belong to an instance**, not to the catalog: the catalog (shared per plugin URI) keeps plain entries, and each `PluginPresets` wraps them
  in its own `Preset` objects, so `preset.load()` / `save()` / `delete()` know which instance to act on. A `list` event goes to the subscribers of every
  instance of the plugin, each with its own objects.
- `presets.on('list')` ends with the instance (`removed`); subscribing to a gone instance returns a no-op.
- The first read of a plugin's list emits `list` too (the list went from unknown to known).
- A `Preset` whose instance is removed has `alive === false`; its methods reject with "no plugin" before any request.
- `create` applies the new current preset with `applyLocal` **before** it reads the list, so `instance.on('preset')` fires even if the read fails.
- Name checks: control characters (`\u0000`-`\u001f`, `\u007f`) and the backslash are refused, blank is refused, the rest is trimmed and sent.
- Backend: no change was made; the questions table above is unchanged (none asked).
- Docs: `docs/openapi.yml` (preset descriptions, `PluginPreset.path`, `getPluginNonCached`), `docs/modui-client/implementation-progress.md` (+ sync script),
  `docs/modui-client.md` (1.17, 5.11, diagrams, limitations), `README.rst`, `CLAUDE.md`.

## Revisions
- **2026-10-11** — First draft, from the code reading above. No backend change is planned; the questions table lists candidates, none asked yet.
- **2026-10-11 (2)** — Names moved to the client-wide vocabulary (`create`, `save`, `delete`). Implemented phases 1 to 4; notes above.
