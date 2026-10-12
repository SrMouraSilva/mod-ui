# CLAUDE.md

Guidance for AI assistants (and humans) working on mod-ui.

## What this project is

mod-ui is the web interface of MOD audio devices.

- **Backend**: Python 3 + Tornado 4.3 (`mod/webserver.py` routes, `mod/session.py`, `mod/host.py` talks to
  mod-host over TCP, `mod/hmi.py` talks to the hardware over serial, `modtools/utils.py` wraps the C
  library `utils/libmod_utils.so`).
- **Frontend**: classic jQuery code in `html/` (`html/js/*.js`, templates in `html/*.html` and `html/include/`).
- **API contract**: `docs/openapi.yml` documents every HTTP endpoint, every WebSocket message
  (`/websocket`, `/rpbsocket`, `/rplsocket`), the server-rendered pages and the other channels.
- **Typed client**: `modui-client/` (sources in `src/`, tests in `test/`), a class-based TypeScript
  client built on `fetch` and the main WebSocket. Current scope: pedalboards (list, info, remove, load, loadDefault, reset, currentPedalboard get/save/saveAs)
  and live editing of the running pedalboard (`device.plugins.list`, `currentPedalboard.plugins` list/add/remove,
  `.connections` list/connect/disconnect, `.ports.list()` and `.ports.<audio|midi|cv>.<input()|output()>`; per instance:
  `params.list/get` + `Param.setValue`, `patchParams.list/get` + `PatchParam.setValue/refresh`, `isActive/setActive/toggle`, `setPosition`)
  and proactive updates: `currentPedalboard.on/once` (plugin, connection, port, loading events), `instance.on`, `param.on('change')`,
  `patchParam.on('change')`, stable objects (`plugins.get`, `alive`), a `{ source }` option on every write, and the connection
  (`client.state`, `client.on('state' | 'error')`, optional `reconnect`), immutable snapshots for UI frameworks
  (`currentPedalboard.getSnapshot()` / `subscribe()`, batched per animation frame) and the device's own reports
  (`device.on('stats' | 'sysStats' | 'transport' | 'bufferSize' | 'trueBypass' | 'snapshot')`, `instance.preset`)
  (`docs/plans/2026-10-modui-client-events.md`, phases 1 to 4; meters and addressings are not covered).
  Also the running pedalboard's snapshots (`currentPedalboard.snapshots`: list/get/save/create/load, `Snapshot.rename/delete/load`, `current`,
  `currentIndex`, `on('current' | 'list')`) and the user banks (`client.banks`: list/get/create/move/replaceAll, `Bank.rename/delete/add/
  remove/move/setPedalboards`) (`docs/plans/2026-10-modui-client-snapshots-banks.md`), and the presets of a plugin instance (`instance.presets`:
  list/get/load/create/save/delete, `Preset.load/save/delete`, `current`, `on('list')`) (`docs/plans/2026-10-modui-client-presets.md`).
  Cloud-related endpoints are planned under `client.cloud`.
  Developer guide with diagrams: `docs/modui-client.md`.
- **Plugin GUIs**: `modui-plugin-view/` (sources in `src/`, tests in `test/`), renders and drives a plugin's modgui (icon, settings,
  widgets, plugin JavaScript) in any page on top of `modui-client` (type-only dependency; the app passes its client). Entry point
  `new PluginViews(client).create(instance | plugin | uri)`. Guide: `docs/modui-plugin-view.md`; plan: `docs/plans/2026-10-modui-plugin-view.md`.
  It ports `html/js/modgui.js`: when that file changes (template data, widgets, the script API), check the port.
- **Plans**: `docs/plans/` (see "Plans" below).

## Commands

```sh
# backend (development; fake audio host, no JACK needed)
pip3 install -r requirements.txt && make -C utils
MOD_DEV_HOST=1 MOD_DEV_ENVIRONMENT=0 python3 ./server.py      # http://localhost:8888/

# TypeScript client (Node.js >= 22.12)
cd modui-client
npm install
npm test          # tsc --noEmit + vitest
npm run build     # writes html/js/lib/modui-client.js (generated, git-ignored)
npm run watch     # rebuild on change

# plugin GUIs (same toolchain)
cd modui-plugin-view && npm install && npm test && npm run build   # writes html/js/lib/modui-plugin-view.js (git-ignored)

# API contract
npx @redocly/cli lint docs/openapi.yml
```

## Rules

### Keep the contract and the client in sync
Whenever you **add, remove or change** an HTTP endpoint (route in `mod/webserver.py`, arguments, response shape)
or a WebSocket message (`msg_callback`/`write_message` in `mod/host.py`, `mod/session.py`, `mod/addressings.py`,
`mod/webserver.py`, or a command handled by `ServerWebSocket.on_message`):

1. Update `docs/openapi.yml` (path, parameters, schemas, and the WebSocket tables in `connectMainWebSocket`).
   It must stay valid: `npx @redocly/cli lint docs/openapi.yml`. The trailing-slash, 2XX and 4XX rules flag
   real routes, so they can be skipped
   (`--skip-rule=no-path-trailing-slash --skip-rule=operation-2xx-response --skip-rule=operation-4xx-response --skip-rule=no-unused-components`).
2. Update the client in `modui-client/src/` (wire types in `types.ts`, behaviour in the area module)
   when the change affects an area the client covers (today: pedalboards). New areas are added on request and
   planned first (see "Plans").
3. Add or adjust tests in `modui-client/test/` and run `npm test`.
4. Update the operation's row in `docs/modui-client/implementation-progress.md` when the client gains or loses an operation,
   then run `python3 docs/modui-client/sync-progress.py` (it regenerates the summary table and the html dashboard
   `implementation-progress.html`; never edit those by hand).
5. Update `docs/modui-client.md` (including its Mermaid diagrams) and the README section
   "TypeScript client (modui-client)" when the API or its usage changes.

### Do not change the backend without asking
The goal is to leave the Python backend as it is. When building `modui-client`, work around backend limits in the client
and document them in `docs/openapi.yml` and in the plan. **If a feature seems to need a backend change (a new endpoint, a
new argument, a changed behaviour, a fix), stop and ask the user for confirmation first, explaining why**, and record the
decision (confirmed or refused) in the plan of the area concerned (`docs/plans/2026-10-modui-client-pedalboard.md`,
`docs/plans/2026-10-modui-client-pedalboard-graph.md`, ...). Never edit `mod/`, `modtools/` or `utils/` on your
own for the client's sake.

### Method names (one vocabulary for every entity)
Do not copy the backend's names (`saveas`, `save_new`, `remove`, ...); use these, and give a new entity the same verbs.

| Intent | Verb | Used by |
|---|---|---|
| Read | `list()`, `get(key)` | every collection (async, unless the data is in memory like `params.list()`) |
| Make a new **saved** entity | `create(...)` | `banks.create`, `snapshots.create` (captures the live values), `presets.create` |
| Put an existing thing into a container | `add(...)` | `plugins.add` (from the catalogue), `bank.add(pedalboard)` |
| **Destroy** a saved entity | `delete()` | `reference.delete()`, `snapshot.delete()`, `bank.delete()`, `preset.delete()` |
| Take something **out of a container** | `remove(...)` | `plugins.remove` / `instance.remove()`, `bank.remove(pedalboard \| index)` |
| Link / unlink | `connect` / `disconnect` | connections (the domain's own words) |
| Write the live state into an existing entity | `save(...)` | `currentPedalboard.save`, `snapshots.save` (the current one), `preset.save(name?)` |
| Replace a whole list | `replaceAll(...)` | `banks.replaceAll` (deletes what is left out) |
| Apply | `load(...)` | `device.load`, `snapshots.load`, `presets.load` |
| Rename | `rename(name)` | `snapshot.rename`, `bank.rename`; where the backend cannot (presets) the rename is `save(name)` and says that it also overwrites |
| Change the **order** in a list | `move(from, to)` | `banks.move`, `bank.move` |
| Place a block in the canvas | `setPosition({ x, y })` | `instance.setPosition` |
| Change a value | `setValue(v)`, `setActive(b)` | params, patch parameters, bypass |

`currentPedalboard.saveAs(title)` and `reference.copy()` stay as they are: they are the pedalboard's two ways of making a copy, not a new entity.

### TypeScript client conventions
- One module per concern in `src/` (`client.ts`, `pedalboards.ts`, `device.ts`, `events.ts`, `http.ts`,
  `errors.ts`, `types.ts`, `runtime.ts`, `plugins.ts`, `pedalboard-*.ts`, `patch-params.ts`, `pedalboard-snapshots.ts`, `plugin-presets.ts`, `banks.ts`, `graph-state.ts`, `emitter.ts`, `snapshot.ts`, `device-state.ts`); `src/index.ts` is the build entry, re-exports the public API and sets
  `window.ModUiClient` / `window.ModUi`. New areas get their own module and test file.
- Tests: one file per area in `test/`, sharing fakes from `test/helpers.ts` (`makeClient`, `connected`,
  `FakeWebSocket`, `flush`, `connectedWith` for a replay that carries graph frames).
- The build (esbuild, IIFE, ES2018) produces a single `html/js/lib/modui-client.js` that is **never committed**.
  `index.html` loads it.
- No runtime dependencies. Dev dependencies only: `typescript`, `esbuild`, `vitest`, pinned to exact versions.
  (The repository ignores `package-lock.json`.)
- Classes per feature area, reachable from `ModUiClient`: `client.pedalboards` (library), `client.device`
  (what is running), `client.events` (raw WebSocket). Future areas follow the same shape.
- All HTTP goes through `HttpTransport` (`fetch`, `cache: 'no-store'`, non-2xx → `ModUiHttpError`).
  Inject `fetch`/`WebSocket` through `ModUiClientOptions`, never use them directly, so tests can fake them.
- Operations that the backend confirms over the WebSocket must be awaited until the confirmation arrives.
  Register `events.waitFor(...)` **before** sending the HTTP request: mod-ui often pushes the WebSocket
  message before the HTTP response. `EventChannel.connect()` swallows the initial state replay, which ends with
  `loading_end`.
- Loading a pedalboard is always `GET /reset` → `POST /pedalboard/load_bundle/` → wait for `loading_end`,
  the same sequence as the classic UI (`html/js/desktop.js`).
- A socket opened by the client answers `ping` (`pong`) and `data_ready <n>` (echo). A socket shared through
  `options.webSocket` is only listened to.
- Connection: `EventChannel` owns the state machine (`idle`, `connecting`, `open`, `reconnecting`, `closed`) and the optional
  reconnection (own socket only, opt-in). When a new own socket's replay begins (its first frame: `events.onReplayStart()`, not the
  socket creation) `GraphModel` is emptied (`clear()`, hardware ports included) and the replay rebuilds it and ends with `loaded`; the
  first `connect()` is never retried, a shared socket is never reopened. Abandoned attempts are told apart with `generation`, which
  `close()` and every new attempt increase: always check it before a late handler touches the channel. Timers and `Math.random` are used directly, so tests use `vi.useFakeTimers()`.
- Snapshots: `SnapshotStore` (`snapshot.ts`) is fed by `PedalboardStore.handle()` with `note(change)` and rebuilds only what is out of date when
  `getSnapshot()` is called; it keeps untouched plugin objects and lists (structural sharing). Listeners are notified through
  `ModUiClientOptions.schedule` (default `requestAnimationFrame`, else a microtask), looked up when used so tests can stub it. `DeviceState`
  (`device-state.ts`) listens to the raw frames from the moment the device is created, so the replay seeds the last values.
- Notifications: `GraphModel.apply()` reports what a frame changed (`GraphChange`); `PedalboardStore` builds the plugin objects
  (stable per instance path) and emits on one `Emitter`. A write that the backend does not echo (`param_set`, `patch_set`,
  `plugin_pos`) is applied to the model with `GraphState.applyLocal()`, so it emits like a frame; a write confirmed by a frame
  registers `store.expect(...)` before the request so the frame is tagged `'local'`. Events never make HTTP requests (only a new
  plugin's description does, once per URI). Events are delivered in frame order, never nested, and a throwing handler is rethrown
  asynchronously. Every write takes `{ source }` (`WriteOptions`).
- Snapshots and banks: `PedalboardSnapshots` keeps the names only from `list()` and from its own writes (applying the backend's rules for
  the current index) plus the `pedal_snapshot` report; no event makes a request. `Snapshot` objects are told apart by name. Bank edits
  are read-modify-write of the whole list inside a queue private to `BanksApi`; a `Bank` is a value that updates itself after its own write.
- Presets: one `PresetCatalog` per plugin URI (owned by `PluginsApi`, shared by the instances) is the source of `presets.list()`, always read from
  `GET /effect/get_non_cached`. A user preset is told apart by its bundle path, a factory one by its URI. The backend sends no `preset` frame for a
  save, so `create` / `save` record the new current preset with `GraphState.applyLocal()`; `load` and `delete` hold a `store.expect()` for the frames.
- Every public symbol has TSDoc in English: what it does, which backend calls it makes (with the OpenAPI
  `operationId`), errors thrown, and an `@example`. Write it for both developers and AI tools.

### Backend facts that are easy to get wrong
- Most handlers answer `200` with a bare `true`/`false`; `false` is a failure, not an HTTP error.
- Many state-changing endpoints use `GET` (`/effect/add/...`, `/reset`, `/snapshot/load`, ...).
- `get_argument` reads both the query string and the form body. Trailing slashes in routes matter
  (`/pedalboard/load_bundle/`, `/pedalboard/info/`).
- No endpoint lists the plugins or connections of the running pedalboard: the client rebuilds them from the WebSocket
  (`graph-state.ts`). `GET /effect/connect` of an existing connection answers `true` without a frame, and
  `GET /effect/disconnect` always answers `true` (and always sends its frame).
- `POST /pedalboard/load_bundle/` does not clear the current graph; `/reset` does.

### General
- Code, comments and docs in English.
- Do not commit generated files (`html/js/lib/modui-client.js`, `html/js/lib/modui-plugin-view.js`, `node_modules/`).

## Plans

Implementation plans are saved in `docs/plans/` as Markdown, named `YYYY-MM-<topic>.md`
(e.g. `docs/plans/2026-10-modui-client-pedalboard.md`). Write the plan there before implementing a non-trivial change and
keep it updated with the final decisions. Plans may also list suggested future work that is not implemented yet;
check the plan before extending an area.
