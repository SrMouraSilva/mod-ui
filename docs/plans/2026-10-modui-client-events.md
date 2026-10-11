# Plan: `ModUiClient` – proactive updates (typed events, connection lifecycle, framework bindings)

Status: **phases 1 to 4 implemented** (2026-10-10) (design closed 2026-10-10; all open questions decided). Builds on `2026-10-modui-client-pedalboard.md` (`EventChannel`, `Device`),
`2026-10-modui-client-pedalboard-graph.md` (`GraphState`, `PluginInstance`, `Param`) and
`2026-10-modui-client-patch-params.md` (`PatchParam`). It adds a notification layer on top of them; it redefines none of
their operations.

## Context
New frontends will use `modui-client` instead of the classic UI. A frontend is not a script: it must **keep its screen in sync
by itself** when the plugin graph, a knob, the bypass state, the CPU load or the connection changes, whoever caused the change
(this client, the classic UI, the HMI, another client). Today the client is good at *reading on demand* and weak at
*telling the application that something changed*.

### What exists today (verified in the code on 2026-10-08)
| Resource | Where | What it gives a frontend |
|----------|-------|--------------------------|
| `client.events.on(command, handler)` (`'*'` = all) | `src/events.ts` | Raw frames: `handler(args: string, command: string)`. Returns an unsubscribe function. |
| `client.events.waitFor(command, ms, predicate)` | `src/events.ts` | One-shot promise for the next frame. Meant for confirmations, not for observing. |
| `client.connect()`, `events.connected` | `src/events.ts` | Open the socket and swallow the state replay. No event when it closes or comes back. |
| Live getters: `Param.value`, `PluginInstance.x/y`, `isActive()`, `PatchParam.value` | `src/pedalboard-graph.ts`, `src/patch-params.ts` | Always current (read from `GraphModel`), but only by polling; nothing says *when* they changed. |
| `plugins.list()`, `connections.list()`, `ports.*` | `src/pedalboard-graph.ts` | Rebuild the objects from the model on every call. |

Handlers of `GraphState` are registered before any application handler, so inside `events.on('param_set', ...)` the getters
already show the new value. This is true today but is not documented as a contract.

### Gaps
1. **Raw strings.** The application re-parses frames that `GraphModel.apply` already parses (`patch_set` values with spaces,
   `param_set` with `:bypass`, `remove :all`, ...).
2. **Frames cannot be tied to objects.** `add` arrives as text; the `PluginInstance` needs `PluginInfo` (HTTP, cached) and only
   `plugins.list()` builds it.
3. **Unstable object identity.** `view()` builds new `PluginInstance`, `Param` and `Port` objects on every `list()`. The TSDoc says
   "the object keeps its identity", which holds for an object you keep, not across `list()` calls. Keyed rendering and
   per-object subscriptions need a stable object per instance.
4. **Local changes are silent.** The backend never echoes `param_set`, `patch_set` or `plugin_pos` to the socket that sent them.
   `setValue()` updates the model at once but emits nothing, so a UI that only listens to frames misses its own changes.
5. **No connection lifecycle.** `onClose` detaches and rejects waiters; the application is not told. There is no reconnect, and
   after one the hardware ports that vanished in between stay in the model (`docs/modui-client.md`, "Backend limits").
6. **Pedalboard loading is a burst.** `loading_start` clears the model, then dozens of `add`/`connect`/`param_set`/`patch_set`
   frames arrive, then `loading_end`. The application sees noise and no "consistent again" moment.
7. **Device state is only raw frames.** `stats`, `sys_stats`, `transport`, `bufsize`, `truebypass`, `pedal_snapshot`, `preset` are
   not parsed and not remembered (a late subscriber misses the value from the replay).

## Goals and non-goals
Goals
- Typed, documented events for everything the client already models, with the same shape for remote and local causes.
- Stable objects, so `instance.on(...)` and `param.on(...)` work and a frontend can key its views by identity.
- An observable connection state, with optional reconnect that leaves the model correct.
- One "something changed" subscription with immutable snapshots, usable from React/Vue/Svelte/Lit without glue code.
- No backend change, no runtime dependency.

Non-goals
- No UI framework dependency; bindings are a small, framework-neutral contract (`subscribe` + `getSnapshot`).
- No new HTTP endpoints or WebSocket messages; `docs/openapi.yml` does not change.
- Meter streams (`output_set`) and addressings (`hw_map`, `midi_map`, `cv_map`) are future work (see "Later").

## Design principles
- **The client keeps the whole state, objects included.** When an event fires, the `PluginInstance`/`Param` it refers to already
  exists, is complete and is the same object as before. Hot events (`param_set`, bypass, `plugin_pos`, `patch_set`) are pure memory:
  **no HTTP, ever**. The only HTTP is the one-off description of a plugin (`PluginInfo`, `POST /effect/bulk/`, cached by URI),
  fetched when a plugin *appears*, never per event (decided 2026-10-08, see decision 1).
- **One source of truth.** Events are derived from the `GraphModel` change, not from a second parser. `apply()` reports what
  changed; the socket handler and the local operations both feed the same emitter.
- **Same event for local and remote causes**, tagged with `origin: 'local' | 'remote'`.
- **Synchronous and ordered.** Events are delivered in arrival order, after the model was updated, in the same tick as the frame.
  Batching, when wanted, is done by the snapshot layer (Phase 3), not by the event layer.
- **Nothing breaks the model.** A throwing handler never stops other handlers or the model update.
- Same conventions as the rest of the client: `on()` returns an unsubscribe function, TSDoc in English with `@example`,
  fakes injected, one module per concern, one test file per area.

## Proposed API

### Phase 1: typed events and stable objects (no breaking change)

```ts
const pb = client.device.currentPedalboard;

// graph structure
pb.on('plugin:added',        ({ plugin, origin }) => ...);   // plugin: PluginInstance, complete (info loaded)
pb.on('plugin:removed',      ({ plugin, origin }) => ...);   // plugin.alive === false already
pb.on('connection:added',    ({ from, to, origin }) => ...);
pb.on('connection:removed',  ({ from, to, origin }) => ...);
pb.on('port:added' | 'port:removed', ({ id, type, direction, origin }) => ...);   // add_hw_port / remove_hw_port

// loading bracket
pb.on('loading', ({ empty, modified, origin }) => ...);   // loading_start: the model is being rebuilt, do not trust it
pb.on('loaded',  ({ snapshotId, origin }) => ...);        // loading_end (also fired once after the first replay)
pb.on('cleared', ({ origin }) => ...);                    // remove :all (GET /reset)

// one plugin
const plugin = await pb.plugins.get('/graph/Gain');        // new: stable PluginInstance, or undefined
plugin.on('param',  ({ param, value, previous, origin }) => ...);   // param: Param, a knob drag = one event per frame, no HTTP
plugin.on('active', ({ active, origin }) => ...);          // bypass
plugin.on('moved',  ({ x, y, origin }) => ...);
plugin.on('patch',  ({ uri, origin }) => ...);             // read the value with patchParams.get(uri).value
plugin.on('removed', ({ origin }) => ...);                 // then every subscription of the object is dropped
plugin.alive;                                              // false after removal / reload

// one control
const gain = plugin.params.get('gain')!;
gain.on('change', ({ value, previous, origin }) => ...);   // finest granularity: a knob
plugin.patchParams.get(uri)!.on('change', ({ origin }) => ...);
```

Event catalogue (`GraphChange`, produced by `GraphModel.apply`):

| Event | Source frame / local call | Payload (besides `origin`) |
|-------|---------------------------|----------------------------|
| `plugin:added` | `add`; `plugins.add()` | `plugin` (`PluginInstance`; `x`, `y`, `isActive()` are live getters) |
| `plugin:removed` / plugin `removed` | `remove <instance>`; `plugins.remove()` | `plugin` (stale: `alive === false`) |
| `connection:added` / `removed` | `connect` / `disconnect` | `from, to` (port ids) |
| `port:added` / `removed` | `add_hw_port` / `remove_hw_port` | `id, type, direction, title, index` / `id` |
| `loading` / `loaded` | `loading_start` / `loading_end` | `empty, modified` / `snapshotId` |
| `cleared` | `remove :all`; `device.reset()` | – |
| plugin `param`, `Param` `change` | `param_set`; `setValue()` | `param` (`Param`), `value, previous` |
| plugin `active` | `param_set <i> :bypass`; `setActive()`, `toggle()` | `active` |
| plugin `moved` | `plugin_pos`; `move()` | `x, y` |
| plugin / `PatchParam` `change` | `patch_set`; `PatchParam.setValue()`, `refresh()` | `uri` |

Semantics (these become the contract documented in TSDoc and `docs/modui-client.md`):
- **Order**: model updated first, then handlers run, in registration order; `GraphState`'s own handlers always come first.
- **During a load** (between `loading_start` and `loading_end`) the granular events are **suppressed**. The application gets
  `loading`, then `loaded`, and re-reads the state once. The same applies to `remove :all`, which emits `cleared` alone.
  Rationale: a load is 100+ frames, and per-item events during it only cause redundant renders.
- **A plugin appears complete.** On an `add` frame the store asks `PluginsApi.infosOf` for the descriptions it does not know yet (one
  `POST /effect/bulk/` for all missing URIs, cached by URI for the life of the client), builds the `PluginInstance`, and only then
  emits `plugin:added`. Frames that arrive meanwhile are applied to the model at once but their events wait in the same FIFO, so
  the order seen by handlers is the order of the frames and a handler never sees a `param` of a plugin it was not told about.
  `loaded` is emitted after every description of the pedalboard is in, so after `loaded` all reads are synchronous.
  If the request fails, the instance is still created with `info: null` (the existing "plugin not installed" shape) and the error
  is reported through the `error` event of the channel (decision 10), not thrown into a handler.
- **Cost of a burst.** A knob drag is 20–50 `param_set` frames (the classic UI sends one per mouse move, see the DevTools capture
  that motivated this section). In the event layer each one costs a model write, one payload object and the handler calls; it
  never touches the network. Rendering cost is the application's, which is why Phase 3 has batched snapshots.
- **Exact duplicates are not events**: `connect` of an existing connection (the model ignores it) and a `param_set` whose value did
  not change emit nothing.
- **`origin`**: `'remote'` for a frame nobody here asked for; `'local'` for a change this client caused. Fire-and-forget calls
  (`setValue`, `setActive`, `move`, `setValue` of a patch param) emit right after sending. HTTP-confirmed calls (`add`, `remove`,
  `connect`, `disconnect`, `load`, `reset`) register an *expectation* for the frame they will provoke before sending the request,
  and the matching frame is tagged `'local'` (the expectation expires with the confirmation timeout). Best effort, as the existing
  note on `Device.load()`: mod-ui gives no way to correlate a `loading_end` with its cause.
- **`source`: "do not tell me about my own changes".** `origin` only separates this client from the others; it cannot tell two
  components of the same application apart (a slider and a canvas both using the client). Every write takes an optional
  `{ source }` (any value, usually a `Symbol` or the component), carried on the events it causes:
  `param.setValue(v, { source })`, `setActive`, `toggle`, `move`, `PatchParam.setValue`, `plugins.add/remove`,
  `connections.connect/disconnect`, `device.load/reset` (`LoadOptions.source`). A subscription can skip them:
  `param.on('change', handler, { ignoreSource: source })`, or all local ones with `{ ignoreLocal: true }`. Events caused by the
  backend or another client have `source: undefined`. A confirmed call (HTTP + frame) stores its `source` in the expectation,
  so the frame that confirms it carries it too.
  This replaces the Python `with observer.scope()` of pluginsmanager. A block scope does not translate: a write here is
  asynchronous (queued behind loads and saves, confirmed by a frame), so a scope open across an `await` would also hide the
  *remote* events that arrive meanwhile, and `AsyncLocalStorage` does not exist in browsers. Tagging each write is exact and
  works the same in the browser and in Node. (`using`/`Symbol.dispose` has the same async problem and uneven browser support;
  a wrapper such as `client.as(source)` would need a second set of objects next to the stable ones. Both were rejected.)
- **Recommended way to render** (goes into the docs): treat events and snapshots as the *only* trigger to update the screen, and
  never update it from the promise of a write. Local writes also emit their event (right after the queue sends them), so the
  screen has one path for every cause. Where a control must not fight the user's own gesture (a slider being dragged), pass a
  `source` for the gesture and `ignoreSource` on the subscription of that control.
- **Re-entrancy**: a handler that calls `setValue()` produces a new event; delivery is queued (FIFO) and runs after the current
  delivery finishes, so handlers never run nested.
- **Handler errors** are caught per handler and rethrown asynchronously (`queueMicrotask(() => { throw error })`), so they reach
  `window.onerror` / `unhandledrejection` without affecting anyone else.
- **Leaks**: a plugin's subscriptions are dropped after its `removed` event, and all of them after `loaded`/`cleared` invalidate
  the instances (`alive === false`); explicit unsubscribe functions stay valid and idempotent.
- `on(event, handler, { signal })` accepts an `AbortSignal` as an alternative to the returned function; `once(event, handler)`.

Stable identity (needed by `plugin.on`, `param.on` and keyed rendering):
- **The architecture mostly holds this already, with one gap.** `GraphModel` is the internal state of the running pedalboard and is
  always current (values, bypass, position, patches, connections, ports, fed by the WebSocket). What it lacks is the *objects*:
  `PedalboardGraph.view()` builds new `PluginInstance`/`Param`/`Port` objects on every call, and awaits `infosOf` each time.
- New internal **`PedalboardStore`** (`src/pedalboard-store.ts`) sits between `GraphState` and `PedalboardGraph`: it owns the model,
  a `Map<instancePath, PluginInstance>` and the description cache access, and it is the only place that builds objects.
  `view()` becomes a synchronous read of the store (after `ready()`); `list()` and `get()` return the cached objects, so `Param`,
  `Port` and `PatchParam` stay the same too. An entry is dropped on `remove`, `remove :all` and `loading_start`.
- A stale object (plugin removed or pedalboard reloaded) keeps today's behaviour (`last` fallback, operations reject with
  `ModUiError`) and gains `alive: boolean`.
- Reload cost: `infosOf` already caches by URI, so a reload with known plugins makes no HTTP request; unknown ones go in one bulk
  request. That is what `plugins.list()` does today, moved to the moment the plugin appears.
- `plugins.get(instance)` is new (`Promise<PluginInstance | undefined>`, runs through the `Device` queue like `list()`).

Implementation notes
- New `src/emitter.ts`: generic `Emitter<EventMap>` (`on`, `once`, internal `emit`, FIFO delivery, error isolation). No dependency.
- `GraphModel.apply(command, args)` returns `GraphChange[]` instead of `void` (an array: `remove <instance>` also drops connections;
  `loading_start` clears). `GraphState` owns an `Emitter<GraphEvents>`, applies frames, then emits; it also exposes
  `emitLocal(change)` and `expect(key)` for the `PedalboardGraph` operations. The shared-socket snapshot read emits `loaded` after it
  swaps the model, so subscribers re-read.
- `PedalboardGraph.ops` gains `subscribe(instance, event, handler)`; `PluginInstance`, `Param` and `PatchParam` expose `on()` by
  delegating to it (filtered by instance and symbol/uri). `CurrentPedalboard.on()` delegates to `GraphState`.

### Phase 2: connection lifecycle

```ts
client.state;                                   // 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
client.on('state', ({ state, previous, reason, error }) => ...);   // reason: 'closed' | 'backend-stopped' | 'timeout' | 'manual'
const client = new ModUiClient({ reconnect: { minDelayMs: 500, maxDelayMs: 10_000, factor: 2, jitter: 0.2 } });
```
- `EventChannel` gets the state machine (extends the existing diagram in `docs/modui-client.md`, "Idle → Connecting …"), owns the
  timer, and emits `state`. `ModUiClient` forwards it (`client.on`, `client.state`). `events.connected` stays.
- The `stop` frame (audio host restarted) becomes the `closed` reason `'backend-stopped'`, not only a waiter failure.
- **Reconnect is opt-in** (`reconnect` option, default off, to keep today's behaviour and tests). Own sockets only. Each attempt
  opens a new socket and waits for the replay.
- **Model correctness after a reconnect**: `GraphModel` gets `reset()` (plugins, connections **and** hardware ports); `GraphState`
  calls it when the replay of a new own socket begins (revised after the review: first frame, not socket creation), so vanished ports no longer stay. Then `loaded` fires. This removes the limitation listed
  in `docs/modui-client.md`.
- Pending operations at the moment of the close keep failing with `ModUiError('WebSocket closed')` (unchanged). Queued ones wait
  for the next connection or fail with `ModUiTimeoutError` as today.
- A shared socket (`options.webSocket`) cannot be reopened by the client: state goes to `closed` (reason `'closed'`) and stays
  there. See decision 5.

### Phase 3: framework bindings (`subscribe` + `getSnapshot`)

```ts
const pb = client.device.currentPedalboard;

pb.getSnapshot();      // synchronous, immutable, referentially stable until something changes
pb.subscribe(listener) // returns unsubscribe; listener() takes no arguments (the useSyncExternalStore contract)

// React
const snap = useSyncExternalStore(pb.subscribe, pb.getSnapshot);
```
```ts
interface PedalboardSnapshot {
  version: number;                 // increments with every published snapshot
  ready: boolean;                  // false until the first replay ended; also false while `loading`
  loading: boolean;
  plugins: ReadonlyArray<PluginSnapshot>;      // { instance, uri, x, y, active, values: Readonly<Record<string, number>>, patches: Readonly<Record<string, string>> }
  connections: ReadonlyArray<{ from: string; to: string }>;
  ports: ReadonlyArray<PortSnapshot>;          // the pedalboard's own ports
}
```
- Built from `GraphModel`, with **structural sharing**: only the plugin that changed gets a new `PluginSnapshot`; unchanged ones keep
  their identity (so `React.memo`/`computed` skip them).
- **Batching**: every WebSocket message is its own task, so a microtask would not merge a knob drag (20–50 separate messages).
  Listeners are therefore notified **at most once per animation frame** (`requestAnimationFrame` when it exists, microtask
  otherwise, e.g. Node and tests), and the scheduler is injectable (`ModUiClientOptions.schedule`) so tests and other runtimes
  control it. The snapshot always reflects the latest state when the listener runs. The event layer (Phase 1) is not batched:
  it is for code that must see every change.
- `values` hold only the values the client has seen (replay, `param_set`, local writes). The description (default, range, name) lives
  in the stable `Param` objects, which the application combines with the snapshot. Snapshots are JSON-serializable on purpose
  (devtools, logging, tests, SSR-free hydration of a view).
- Meters and device streams are **not** in this snapshot (they change too often).

### Phase 4: device state (`stats`, `transport`, ...)

```ts
client.device.on('stats',     ({ cpuLoad, xruns }) => ...);          // stats, ~1/s
client.device.on('sysStats',  ({ memLoad, cpuFreqKhz, cpuTempMilli }) => ...);   // sys_stats; 0 / null = not available
client.device.on('transport', ({ rolling, beatsPerBar, bpm, syncMode }) => ...);
client.device.on('bufferSize', ({ frames }) => ...);                 // bufsize
client.device.on('trueBypass', ({ left, right }) => ...);            // truebypass
client.device.on('snapshot',  ({ index, name }) => ...);             // pedal_snapshot
client.device.stats;      // last known value or null: seeded by the replay, so a late subscriber can read it
```
- New `src/device-state.ts` (parser of the frames above + last values), fed by `EventChannel`, same emitter, same rules.
- `preset` (`<instance> <presetUri>|null`) is added to the plugin: `plugin.on('preset', ...)`, `plugin.preset` (live getter).
- The frame formats are already in `docs/openapi.yml` (`connectMainWebSocket`), so no contract change.

### Later (not planned here)
- `output_set` meters: `plugin.outputs`, `output.on('change')`, with a throttle option. It is subject to `data_ready` flow control,
  which the client already echoes for its own socket; the design needs real measurements first.
- Addressings (`hw_map`, `midi_map`, `cv_map`, `act_*`, `hw_*`), `pedal_snapshot` list, `log`/`progress` as events.
- `for await (const e of pb.events())` (async iterator over the same emitter), useful in Node scripts.

## Decisions (all closed)
1. **Events carry ids or objects?** **Decided 2026-10-08: objects**, because the client keeps the whole state and the hot events
   never need HTTP (author's requirement; a knob drag must not cause requests). The price is `PedalboardStore` and a FIFO that
   holds back events behind a plugin whose description is being fetched (only when the URI is not cached). The earlier
   recommendation (ids + `plugins.get`) is kept only as the fallback for a failed description request.
2. **Suppress granular events during a load?** **Decided 2026-10-10: yes** (`loading` → `loaded`). The alternative (emit
   everything with a `loading: true` flag) costs a render per frame in naive frontends.
3. **Reconnect default.** **Decided 2026-10-10: opt-in** (`reconnect` option, default off); revisit when the first frontend exists.
4. **Phase 3 in the first release?** **Decided 2026-10-10: ship Phases 1–2 first**, Phase 3 right after; it only needs the `GraphChange`
   list from Phase 1.
5. **Shared socket that closes.** **Decided 2026-10-10:** the client only reports state `closed` (reason `'closed'`) and never
   reopens a socket it does not own (a client created with `options.webSocket`, e.g. the classic UI's `window.ws`, whose owner
   decides what happens, see `html/js/host.js`). To continue, the owner creates a new `ModUiClient` with the new socket. No
   `attachSocket()`. A web frontend that lets the client open its own socket is not affected: it has the opt-in reconnect of Phase 2.
6. **`origin` accuracy and ignoring own changes.** **Decided 2026-10-08:** `origin` plus a per-write `source` token with
   `ignoreSource` / `ignoreLocal` on subscriptions (see Semantics); no block scope (Python's `with` does not carry over to
   asynchronous writes). Still best effort: a `loading_end` cannot be tied to its cause, as for `Device.load()` today.
7. **Handler errors** rethrown asynchronously vs swallowed with `console.error`. **Decided 2026-10-10: rethrow** (visible in tooling).
8. **Naming**: **Decided 2026-10-10:** `on(event, handler)` returning an unsubscribe function (kept from `EventChannel.on`) plus
   `once` and `{ signal }`; no `off()`/`addEventListener`, to keep one way to do it.
9. **Event names**: **Decided 2026-10-10: `domain:verb`** strings as above (typed, greppable), not camelCase.
10. **Failed description request** (`POST /effect/bulk/` fails while a plugin appears): **Decided 2026-10-10:** build the instance with
    `info: null`, emit `plugin:added`, and report the failure through an `error` event on the channel/client
    (`client.on('error', ({ error, context }) => ...)`), so the application can retry (`plugins.get(id)` refetches). The
    alternative is to hold the pipeline and retry, which can stall every later event.

## Runtime targets
Primary: **web frontends** (browser). Secondary: **Node.js** (>= 22.12, already the development requirement; global `fetch` and
`WebSocket`, or injected). Consequences for this plan:
- `src/` uses no DOM type and no browser-only global. The animation-frame scheduler of Phase 3 is looked up at run time and falls
  back to a microtask; it is injectable (`ModUiClientOptions.schedule`) so Node code can pass `setImmediate` or a timer.
- Timers (reconnect, expectations) are `setTimeout`; `queueMicrotask`, `AbortSignal` and `Symbol` exist in both. The `Emitter`
  is our own class (no `EventTarget`/`EventEmitter`), so behaviour is identical in both.
- Phase 3 (`subscribe`/`getSnapshot`) is aimed at the browser but harmless in Node. For Node scripts the more useful piece is the
  async iterator listed in "Later" (`for await … of pb.events()`); it moves up if Node use appears.
- Tests run under vitest in Node with the injected fakes, so the browser path (animation frame) is tested through `schedule`.

## Backend change policy for this area
No backend change is needed: every event is derived from frames the backend already sends, and local changes are emitted by the
client because the backend does not echo them to the sender (documented, worked around client-side). If something below turns out
to need the backend, **stop and ask** (CLAUDE.md) and record the answer here.

| Date | Change | Decision |
|------|--------|----------|
| – | Echo `param_set` / `patch_set` / `plugin_pos` to the sender (would remove the local-emission path) | not needed, not asked |
| – | A correlation id on `loading_end` (would make `origin` exact for loads) | not needed, not asked |

## Files (when implemented)
New: `src/emitter.ts`, `src/pedalboard-store.ts` (Phase 1), `src/device-state.ts` (Phase 4), `src/snapshot.ts` (Phase 3).
Changed: `src/graph-state.ts` (`GraphChange`, `apply()` returns changes, `reset()`, emitter, `expect`/`emitLocal`),
`src/pedalboard-graph.ts` (instance cache, `get`, `alive`, `on`, `subscribe` op, local emission), `src/patch-params.ts` (`on`),
`src/pedalboard-plugins.ts` (`get`), `src/current-pedalboard.ts` (`on`, `subscribe`, `getSnapshot`), `src/events.ts` (state machine,
reconnect, `stop` reason), `src/client.ts` (`state`, `on`, `reconnect` option), `src/device.ts` (`on`, last values),
`src/types.ts` (event payloads), `src/index.ts` (exports).

## Tests (`test/`, fakes from `helpers.ts`)
- `emitter.test.ts`: order, `once`, `signal`, unsubscribe during delivery, FIFO re-entrancy, error isolation.
- `graph-events.test.ts` (uses `connectedWith`): every row of the catalogue for a remote frame and for the local call (`origin`,
  `source`, `ignoreSource`, `ignoreLocal`; a remote event during an awaited local write is still delivered);
  suppression during `loading_start`..`loading_end` and on `remove :all`; duplicates emit nothing; handlers see the updated getters;
  stable identity across `list()`/`get()` and after a reload (`alive`); subscriptions dropped on removal; shared-socket snapshot emits `loaded`.
- `connection-state.test.ts` (fake timers): state sequence, `stop` reason, backoff and jitter bounds, reconnect rebuilds the model
  including hardware ports, pending operations fail, shared socket stays `closed`.
- `snapshot.test.ts`: structural sharing, one notification per microtask for a burst, `ready`/`loading`, JSON round trip.
- `device-state.test.ts`: parsing of each frame, values seeded by the replay, `0`/`??` handling in `sys_stats`.

## Documentation to update (CLAUDE.md rules)
- `docs/openapi.yml`: **no change** (no endpoint or message changes). Run the lint anyway after touching nothing else.
- `docs/modui-client/implementation-progress.md`: add rows for the new client-only capabilities (events, connection state,
  snapshot, device state) under the WebSocket area, then `python3 docs/modui-client/sync-progress.py`. Check how rows without an
  endpoint are expressed before writing them.
- `docs/modui-client.md`: new section "Reacting to changes" with Mermaid diagrams (frame → model → `GraphChange` → emitter →
  subscribers/snapshot; the connection state machine with reconnect; class diagram of the new `on()` surfaces), update the
  "Backend limits" bullet about ports staying after a reconnect, and document the ordering/`origin`/loading semantics above.
- README section "TypeScript client (modui-client)": a short "Listening for changes" example, including the React hook.
- `docs/modui-client.md`, "Reacting to changes": the recommendation to render only from events/snapshots, and the `source` /
  `ignoreSource` pattern for controls being dragged.
- `CLAUDE.md`: scope line (events, state, snapshot), module list (`emitter.ts`, `snapshot.ts`, `device-state.ts`).
- TSDoc on every new public symbol (what, which frames, errors, `@example`).

## Order of work
1. Emitter + `GraphChange` + `GraphState` emission + stable identity + `plugins.get` + `on()` on pedalboard, instance, param,
   patch param (Phase 1). No open question is left, so it can start.
2. Connection state and optional reconnect (Phase 2).
3. Snapshot and `subscribe` (Phase 3).
4. Device state (Phase 4).
5. Docs and progress table after each phase, not at the end.

Each phase is shippable on its own and adds API without removing any; `events.on`/`waitFor` stay as the low-level escape hatch.

## Risks
- **Event storms** (a knob dragged in the classic UI, a load): mitigated by suppression during loads, no allocation beyond the
  payload, and batching in the snapshot layer.
- **Identity cache invalidation bugs** (stale `PluginInstance` after reload): covered by `alive` and by tests that reload between reads.
- **`origin` expectations leaking** when a confirmation never comes: they expire with the confirmation timeout.
- **API surface growth**: the same `on()` signature everywhere, one `Emitter`, one event map type per object.

## Implementation notes: phase 1 (2026-10-10)
- Files: `src/emitter.ts` (`Emitter`, `ListenOptions`, `Origin`, `EventMeta`), `src/pedalboard-events.ts` (payloads), `src/pedalboard-store.ts`
  (`PedalboardStore`), `src/graph-state.ts` (`GraphChange`, `GraphModel.apply()` returns the changes, `ChangeSink`, `applyLocal()`),
  `src/pedalboard-graph.ts` (instance cache through the store, `on`/`once`/`alive`/`attach` on `PluginInstance`, `source` on every write),
  `src/patch-params.ts`, `src/pedalboard-plugins.ts` (`get`), `src/pedalboard-connections.ts`, `src/current-pedalboard.ts` (`on`, `once`),
  `src/device.ts` (`source` for `load`, `loadDefault`, `reset`), `src/plugins.ts` (`peek`, `expect`), `src/types.ts` (`WriteOptions`).
  Tests: `test/emitter.test.ts` (10), `test/graph-events.test.ts` (35); one existing test changed (below). 212 tests pass.
- **Delivery**: one `Emitter` for everything; per-plugin subscriptions are filters on it (so the order is global), dropped after the
  plugin's `removed`. `pedalboard-store.ts` imports only types from `pedalboard-graph.ts` (an `ObjectFactory` builds the objects), so there
  is no runtime import cycle.
- **Ordering with a missing description**: the store keeps a gate (a promise) while a description is read; every change handled meanwhile
  is queued behind it. With the description cached (the usual case) handling is synchronous, so a knob drag costs a model write and the
  handlers, nothing else.
- **`local` origin**: fire-and-forget writes call `GraphState.applyLocal()` with the frame the others receive; confirmed writes
  (`plugins.add/remove`, `connections.connect/disconnect`, `device.load/loadDefault/reset`, `PatchParam.refresh`) register `store.expect()`
  before the request and release it in a `finally`. `plugins.remove` also covers the `disconnect` frames of the removed plugin.
- **`plugins.add()` and the description**: the `add` frame can arrive before the HTTP answer that carries the description.
  `PluginsApi.expect(uri)` tells `infosOf` to wait for that answer instead of requesting `POST /effect/bulk/` again.
- **Same plugin objects, also for ports and connections**: `store.hardwarePort()` and `store.connection()` reuse the object while the data
  does not change.
- **Plugin created without a description** (failed or incomplete request): `PluginInstance.info` is a getter, `attach(info)` fills `ports`,
  `params` and `patchParams` in place; `list()`/`get()` call `fillMissing()`, which asks again (one request per call while it keeps
  missing, as `list()` did before).

Differences from the design above, to keep the plan honest:
- The `error` event is on `currentPedalboard` (`currentPedalboard.on('error', ...)`) for now; `client.on('error')` arrives with the client-level
  emitter of phase 2 (it will forward this one).
- `plugins.list()` no longer throws when `POST /effect/bulk/` fails; it reports `error` and returns the plugins with `info === null`.
- A plugin that is already part of the pedalboard when `loaded` is announced gets no `plugin:added` (its frame was queued behind the load):
  `loaded` covers it. Visible with a shared socket, where live frames received while the snapshot is read are applied on top of it.
- During a load the plugin objects of the previous pedalboard die at `loading` (`removed` with `reason: 'reloaded'`), not at `loaded`.
- `instance.on('patch')` payload also carries `value` (parsed) and `param` (undefined for a type the client does not handle).
- A gone plugin keeps its last state in the getters (`last` model); its writes reject with `ModUiError` before touching the queue
  (`rejectIfGone`), and again inside the queue if it disappeared meanwhile.
- Behaviour change worth a line in the release notes: an object kept from before a reload no longer follows the new pedalboard (it is
  `alive === false`); read `plugins.list()` again on `loaded`. One test of `patch-params.test.ts` documented the old behaviour and was changed.

## Implementation notes: phase 2 (2026-10-10)
- Files: `src/events.ts` (`ConnectionState`, `StateReason`, `StateEvent`, `ReconnectOptions`; state machine, `onState`, `onReplayStart`,
  retry timer, `connect()` joining a reconnection), `src/client.ts` (`reconnect` option, `state`, `on`, `once`, `ClientEvents`,
  forwarding of `error`), `src/graph-state.ts` (`GraphModel.clear()`, restart on each new own socket, `ChangeSink.restart()`),
  `src/pedalboard-store.ts` (`restart()`, one `loading` per bracket). Tests: `test/connection-state.test.ts` (22, fake timers).
- Delay of attempt `n`: `min(maxDelayMs, minDelayMs * factor^n) * (1 + jitter * (2r - 1))`, `r = Math.random()`. It never gives up; `close()`
  stops it. Only a connection that was `open` and got lost is retried; the first `connect()` is not (it rejects, the state is `closed`).
- When the replay of a new own socket begins (first frame), `GraphModel.clear()` and the store's `restart()` run; `restart()` only marks
  the bracket (the `loading` event comes from the replay's own `loading_start`, with its real `empty` / `modified`). So the pedalboard's
  own ports and plugins that vanished do not stay, the objects of before die with `reason: 'reloaded'`, and `loaded` fires when the replay
  ends. (First written as "when the socket is created"; changed after the review below.)
- `stop` only sets the reason: the state changes at the close that follows it (the backend closes the sockets right after).
- `connect()` while `reconnecting` joins the attempts and fails with `ModUiTimeoutError` after `connectTimeoutMs`; the attempts continue.
  `close()` rejects such callers with `ModUiError('Client closed')`.
- `client.on('error')` forwards `currentPedalboard.on('error')`; both stay.

## Implementation notes: phases 3 and 4 (2026-10-10)
Phase 3 (snapshots)
- Files: `src/snapshot.ts` (`SnapshotStore`, `PedalboardSnapshot`, `PluginSnapshot`, `PortSnapshot`, `ConnectionSnapshot`, `Schedule`,
  `defaultSchedule`), `src/pedalboard-store.ts` (`snapshots`, `note()` calls), `src/current-pedalboard.ts` (`getSnapshot`, `subscribe`, arrow
  properties so they work with `useSyncExternalStore(pedalboard.subscribe, pedalboard.getSnapshot)`), `src/client.ts` (`schedule` option),
  `src/device.ts` and `src/pedalboard-graph.ts` (they pass it down). Tests: `test/snapshot.test.ts` (16).
- The snapshot is built lazily from the model: `note(change)` (called in frame order from `PedalboardStore.handle()`) marks what is out of
  date, `current()` rebuilds only that. Untouched plugin objects, the plugin `values` / `patches` maps (compared by content), the
  connection list and the port list keep their identity. Everything is frozen; maps are null-prototype objects (a LV2 symbol such as
  `__proto__` is a valid C identifier).
- Loading: `loading` publishes `{ loading: true, ready: false, plugins: [], connections: [] }` (ports keep their last value) and nothing partial
  after it; `loaded` rebuilds everything and is noted when it is announced, after the plugins are built.
- Notifications use `schedule` (default `requestAnimationFrame` when it exists at call time, else `queueMicrotask`), once per tick; a
  notification is scheduled only when a change really made something out of date. Listeners that throw are isolated like handlers.
- `PluginSnapshot` also has `preset` (phase 4).

Phase 4 (device state, presets)
- Files: `src/device-state.ts` (`DeviceState`, payload types, `DeviceEvents`), `src/device.ts` (`on`, `once`, getters `stats`, `sysStats`,
  `transport`, `bufferSize`, `trueBypass`, `snapshot`), `src/graph-state.ts` (`preset` frame, `ModelPlugin.preset`, `GraphChange` `preset`),
  `src/pedalboard-store.ts`, `src/pedalboard-events.ts` (`PresetEvent`), `src/pedalboard-graph.ts` (`PluginInstance.preset`,
  `instance.on('preset')`). Tests: `test/device-state.test.ts` (11).
- `DeviceState` registers its handlers when the device is created, so the state replay (`sys_stats`, `stats`, `transport`, `truebypass`)
  seeds the last values. `stats` and `sysStats` are delivered every time; the other four only when the value changes. Values are kept while
  the connection is down.
- `sysStats`: `??` and unparsable memory become `null`; frequency and temperature `0` become `null` ("not available").
- A `transport` frame without the sync mode (one of the backend's variants) keeps the previous mode (`'none'` at first).
- `pedal_snapshot <index> <name...>`: the name is the rest of the frame. The event and getter are called `snapshot`, as planned; the
  TSDoc says they are not `getSnapshot()` (the state snapshot of phase 3).
- Not done (still "Later"): `output_set` meters, addressings (`hw_map`, `midi_map`, `cv_map`, `act_*`, `hw_*`), `log` / `progress`, the
  pedalboard `size` frame, the async iterator, and any write for transport / true bypass / buffer size (their endpoints are in the
  "recommended" list of `docs/modui-client/implementation-progress.md`, with the event already in place for their confirmation).

## Review of 2026-10-10 and its fixes
A code review of phases 1 to 4 found ten problems; all are fixed, each with a regression test (checked to fail without the fix for the
first, the time limit and the refresh expectation).
1. `close()` followed by `connect()` at once: the rejection handler of the abandoned attempt detached the socket of the new one. Fixed with a
   `generation` counter (`close()` and each attempt increase it; late handlers of an older generation touch nothing) and by detaching only the
   socket the attempt owns.
2. A `state` handler that called `close()` on `reconnecting` did not stop the retry: `startReconnecting()` and the retry timer now check the state.
3. The `loading` event of a reconnection had invented `empty` / `modified`: `restart()` no longer emits it; the replay's `loading_start` does, and a
   replay without one gets a `loading` just before `loaded` (they stay in pairs).
4. The read of a plugin description had no time limit and could hold every later event and call: it is limited to `graphTimeoutMs`
   (`error` event with `ModUiTimeoutError`, plugin with `info === null`).
5. A reconnection attempt wiped the model, the plugin objects and the snapshot when the socket was created: it now happens when the replay begins
   (`onReplayStart`), so an outage keeps the last known state. This changes the design above (Phase 2 text revised).
6. `PatchParam.refresh({ source })` registered its expectation before entering the queue: it is now registered when the request is sent.
7. `ConnectionSnapshot` / `PortSnapshot` objects lost their identity on every rebuild, and a change that cancelled itself published a new
   snapshot: all objects are cached by content, arrays with identical items are reused, and a snapshot with nothing new is not published or
   notified (what counts is what the subscribers were last told).
8. `reconnect` options that are `undefined`, `NaN` or out of range now fall back to their defaults (no `NaN` delay).
9. Subscriptions leaked: the store kept one entry per subscription and `once()` left its `abort` listener on the signal. The `Emitter` now has
   scopes (`dropScope`) and releases the `abort` listener when a subscription ends, whichever way.
10. The caches of port and connection objects only grew: `PedalboardStore.retain()` prunes them at every read of the graph.

## Revisions
- **2026-10-08** — First draft, from the analysis of what `modui-client` offers for proactive updates.
- **2026-10-08** — Open question 1 decided by the author: events carry objects, the client keeps the full state (new
  `PedalboardStore`, descriptions fetched when a plugin appears, FIFO ordering, `loaded` after descriptions). Snapshot batching
  changed from microtask to animation frame (a knob drag arrives as separate WebSocket messages). New open question 10.
- **2026-10-08** — Open question 6 decided: `source` token per write + `ignoreSource`/`ignoreLocal` (no block scope, because writes
  are asynchronous). Added the render-from-events recommendation and the "Runtime targets" section (web first, Node second).
- **2026-10-10** — Open questions 2, 3, 7, 8, 9 and 10 decided (the recommendations were accepted).
- **2026-10-10** — Questions 4 and 5 decided (recommendations accepted). All questions are closed; status changed to approved.
- **2026-10-10** — Phase 1 implemented (emitter, `GraphChange`, `PedalboardStore`, stable objects, `plugins.get`, events on the pedalboard,
  plugin, `Param` and `PatchParam`, `source` on writes); implementation notes and differences added.
- **2026-10-10** — Phase 2 implemented (connection state, opt-in reconnection, clean model after a reconnection, `client.on`); implementation notes added.
- **2026-10-10** — Phases 3 and 4 implemented (snapshots with batched notifications, device state, plugin presets); notes added. All planned phases are done.
- **2026-10-10** — Code review of phases 1 to 4: ten problems fixed with regression tests; Phase 2 design changed (the model is replaced when the replay
  begins, not when the socket is created).
