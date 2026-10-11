# Plan: `ModUiClient` – pedalboard snapshots and banks

Status: **implemented** (2026-10-11), unit tests only; not checked against a real device (see "Verification"). Phase 6 (`getState()` / `subscribe()`) was left out. Builds on `2026-10-modui-client-pedalboard.md` (client, `Device`, the device queue),
`2026-10-modui-client-pedalboard-graph.md` (live graph, `PluginInstance`) and `2026-10-modui-client-events.md` (`Emitter`, `source`,
`device.on('snapshot')`). It covers the 9 operations of the `Snapshots` and `Banks` sections of `docs/openapi.yml`, which
`docs/modui-client/implementation-progress.md` already lists with the names below as the recommendation.

## Context
Two features of the classic UI have no client support yet:

- **Snapshots**: a pedalboard keeps a list of named snapshots of its plugin values (control ports, bypass, patch parameters, presets).
  The user switches between them while playing. They belong to the **running pedalboard** (`currentPedalboard.snapshots`).
- **Banks**: ordered collections of pedalboards, also ordered themselves, used by the hardware to navigate pedalboards. They belong
  to the **device library** (`client.banks`), next to `client.pedalboards`.

Naming warning: "snapshot" is already used twice in the client. `currentPedalboard.getSnapshot()` is the immutable *state* for UI
frameworks (`PedalboardSnapshot` in `snapshot.ts`), and `device.on('snapshot')` / `SnapshotEvent` is the `pedal_snapshot` report. This plan
adds a third thing, the saved set of values. To avoid collisions the new classes are `Snapshot` and `PedalboardSnapshots`
(like `PedalboardPlugins`, `PedalboardConnections`) and the collection is reached as `currentPedalboard.snapshots`. The TSDoc of the
existing `getSnapshot()` and `SnapshotEvent` already warn about the mix-up; the new classes repeat the warning.

## Findings (verified in the code on 2026-10-11)

### Snapshots (`mod/webserver.py` 1651-1727, `mod/host.py` 3036-3300, 3731-3760, 4072-4095)
- **A snapshot is identified by its position** in `Host.pedalboard_snapshots` (the `id` / `index` of every endpoint). Removing one
  **renumbers the ones after it**. The classic UI renumbers its list by hand after a delete. Names are unique inside a pedalboard
  (`_snapshot_unique_name`, `get_unique_name`: `Solo` becomes `Solo (2)`), which is the only stable key.
- **What a snapshot holds** (`snapshot_make`): per plugin `bypassed`, `parameters` (patch parameters), `ports` (control values) and
  `preset`. Not positions, not connections, not addressings. **No endpoint returns that content**, only the names
  (`GET /snapshot/list`). `Snapshot` therefore has `index` and `name` and nothing else.
- **Current snapshot**: `Host.current_pedalboard_snapshot_id`. It is known to a client from `loading_end <id>` (state replay and every
  pedalboard load) and from `pedal_snapshot <index> <name...>`, sent **only by a snapshot load** (HTTP, HMI or MIDI program change).
  Everything else changes it **silently**:
  | Operation | Effect on the current id | Frame sent |
  |---|---|---|
  | `saveas` | becomes the new snapshot (last position) | none |
  | `remove` of the current one | becomes `-1` ("nothing to save") | none |
  | `remove` of another one | **unchanged**, although positions shifted | none |
  | `rename`, `save` | unchanged | none |
  | `load` | the loaded one | `pedal_snapshot` (+ `param_set`, `patch_set`, `preset`, bypass `param_set` for every changed value) |
- **Backend quirk**: removing a snapshot that sits *before* the current one leaves `current_pedalboard_snapshot_id` pointing at the
  wrong snapshot (the next one, or out of range). The classic UI hides it because it reloads its own list. The client can only mirror
  the number (see "Backend questions").
- `save` returns `false` when the current id is `-1` or invalid. `remove` returns `false` for an unknown index **and for the last
  remaining snapshot**. `rename` returns `{ ok: false }` for an unknown index. `saveas` always works (`ok` is false only when the
  index could not be computed). `GET /snapshot/name` **never fails**: it answers `Default` for any unknown index, so it cannot be
  used to check existence (`openapi.yml` says "Falls back to `Default`").
- `load` answers after the snapshot is fully applied (the handler yields until `snapshot_load` calls back) and returns `false` when the
  index is invalid or another load/preset change aborted it (`abort_previous_loading_progress`).
- Every write calls `save_snapshots_to_disk()`: with a titled pedalboard it rewrites `snapshots.json` **in the bundle immediately**,
  without a pedalboard save, and marks the pedalboard as modified. With an untitled pedalboard (no bundle) it stays in memory until the
  first save.
- **The backend does not broadcast list changes.** A second client (the classic UI, another tab, the HMI) learns of a `saveas`,
  `rename` or `remove` only by asking again. The HMI can also reorder snapshots (`CMD_REORDER_SSS_IN_PB`), which has no HTTP equivalent.
- **Addressing**: when the snapshot selector is addressed to a hardware actuator (`/pedalboard/:presets`), the classic UI forbids
  `saveas`, `remove` and `load`. The backend does not enforce it, and the web `saveas` / `remove` do not call `readdress_snapshots`
  (the HMI versions do), so the hardware options go stale. The client cannot see addressings (out of scope), so it cannot refuse.

### Banks (`mod/webserver.py` 1731-1766, `mod/bank.py`, `html/js/banks.js`)
- **Only user banks** are exposed. Factory banks (`FACTORY_BANKS_JSON_FILE`) are read by the HMI only.
- `GET /banks` is **not read-only**: `list_banks(..., shouldSave=True)` drops pedalboards that no longer exist or are `broken`
  (a missing plugin), renames duplicate bank titles (`Rock`, `Rock (2)`) and **saves the cleaned file**. A pedalboard that is
  temporarily broken is therefore removed from its banks for good.
- The response replaces each `{ bundle, title }` entry by the full pedalboard summary (`PedalboardSummary`: `title`, `bundle`, `version`,
  `factory`, `broken`, ...). Entries whose bundle is not in the library are skipped in the answer but stay in the file until the next
  clean-up.
- `POST /banks/save` replaces **everything**, takes the raw body (`[{ title, pedalboards: [{ bundle, title }] }]`), validates nothing,
  and answers `true`. There is no bank id: a bank is its **position** and its **title** (unique after the next `GET`). Two writers
  race with last-write-wins.
- A bank is a plain collection. **Nothing "loads a bank" over HTTP**; loading is `device.load(pedalboard)`. The HMI's "current bank"
  (`Host.bank_id`, `last.json`) is not reachable from the web.
- User banks are meant to hold **user** pedalboards: when a factory pedalboard is dropped into a bank, the classic UI first calls
  `GET /pedalboard/factorycopy/` and stores the copy (`html/js/banks.js`).
- `GET /pedalboard/remove/` already removes the pedalboard from every bank on the server, so a bank read before is stale.
- `Host.userbanks` (what the HMI shows) is refreshed in `initialize_hmi` only when the web UI is not connected. Whether a
  `POST /banks/save` reaches an HMI that is already running was not verified (needs a device).

## Requested API

### Snapshots (`client.device.currentPedalboard.snapshots`)
```ts
const snapshots = client.device.currentPedalboard.snapshots;

await snapshots.list(): Promise<Snapshot[]>             // GET /snapshot/list, ordered by index
await snapshots.get(index): Promise<Snapshot | undefined>
snapshots.current: Snapshot | null                      // sync: the one the backend considers current
snapshots.currentIndex: number | null                   // sync, valid before list() has run (from loading_end / pedal_snapshot)

await snapshots.save(): Promise<void>                   // POST /snapshot/save: overwrite the current snapshot with the live values
await snapshots.saveAs(name): Promise<Snapshot>         // GET /snapshot/saveas: new snapshot, becomes current; name made unique
await snapshots.load(index | snapshot, { source? }): Promise<void>

snapshot.index; snapshot.name; snapshot.isCurrent; snapshot.alive
await snapshot.load({ source? }); await snapshot.rename(name): Promise<string>; await snapshot.remove()

snapshots.on('current' | 'list', handler, options?); snapshots.once(...)
```
`index` is a live getter: it changes when an earlier snapshot is removed. `name` is live too (rename). The object stays the same while the
snapshot exists (identity by name, see below).

### Banks (`client.banks`)
```ts
await client.banks.list(): Promise<Bank[]>              // GET /banks; pedalboards as PedalboardReference (usable with device.load)
await client.banks.get(title): Promise<Bank | undefined>
await client.banks.create(title, pedalboards?): Promise<Bank>
await client.banks.save(banks: BankData[]): Promise<void>   // POST /banks/save, replace all (low-level; the methods below use it)
await client.banks.move(bank | title, toIndex): Promise<Bank[]>

bank.title; bank.index; bank.pedalboards: readonly PedalboardReference[]
await bank.rename(title): Promise<void>
await bank.remove(): Promise<void>
await bank.add(pedalboard, { at?, copyFactory? }): Promise<void>
await bank.removePedalboard(pedalboard | index): Promise<void>
await bank.movePedalboard(from, to): Promise<void>
await bank.setPedalboards(pedalboards): Promise<void>
```
`PedalboardReference.remove()` gains no new behaviour, but its TSDoc already says "and its entries in all banks"; banks read earlier are stale
after it (documented, no cache to invalidate because `Bank` objects are values, see below).

## Design

### Snapshots

#### Model and identity (`src/pedalboard-snapshots.ts`, new)
A small `SnapshotList` model owned by `PedalboardSnapshots`: an ordered array of `{ name }` plus `currentIndex: number | null` and
`known: boolean` (the names have been read since the last pedalboard load). `Snapshot` objects are created once per name and reused, so
`snapshots.list()` returns the same objects while they exist. After a read from the backend the list is **reconciled by name** (names are
unique): a name still present keeps its object and gets the new index, a new name creates one, a missing name marks its object
`alive = false`. Consequence, documented: a rename made by *another* client looks like "removed + added" here; a rename made through
`snapshot.rename()` keeps the object.

#### Where the state comes from (no event ever makes a request, per `CLAUDE.md`)
| Source | Updates |
|---|---|
| `loading_start` / `loading_end <id>` (existing `GraphChange` `loading` / `loaded`) | the list is marked unknown, old `Snapshot` objects become `alive = false`, `currentIndex = id`; `'list'` and `'current'` are emitted |
| `pedal_snapshot <index> <name...>` | `currentIndex = index`; when the list is known and `names[index] !== name`, the name is updated and `'list'` emitted; when `index >= length` the list is marked stale (next `list()` reads it anyway) |
| own write (`save`, `saveAs`, `rename`, `remove`, `load`) | applied locally with the **same rules as the backend** (table above), then `'list'` / `'current'` emitted |
| `list()` / `get()` | `GET /snapshot/list`, reconcile, emit `'list'` only if something differs |

`currentIndex` mirrors the backend number, including its quirk after removing an earlier snapshot (it keeps the number). `snapshots.current`
returns the object at that position, or `null` for `-1`, out of range, or names not read yet. After `await snapshots.list()` it is reliable
except for that quirk and for silent changes made by other clients. `device.snapshot` / `device.on('snapshot')` stay as they are (raw
`pedal_snapshot`); `snapshots.on('current')` is the richer view and also fires for `saveAs` and `remove`.

#### Flows
All writes go through the **device queue** (`enqueue`), so they never run in the middle of `device.load()` / `reset()` and keep their order
(a `saveAs` followed by a `load` of the returned index).
- **`list()`**: queue, `state.ready()`, `GET /snapshot/list` (`listSnapshots`), keys parsed with `parseInt`, sorted numerically, reconcile.
  A pedalboard that is loading is waited for by the queue.
- **`get(index)`**: `list()` and a lookup. `GET /snapshot/name` (`getSnapshotName`) is **not used** because it never fails (see above). Its
  row in `implementation-progress.md` stays "not implemented" with that reason.
- **`save()`**: refuse locally when `currentIndex` is `null` or the names are known and there is no object at it (nothing is sent: "no current
  snapshot"; the classic UI says "Nothing to save"). `POST /snapshot/save` (`saveSnapshot`); `false` becomes `ModUiError`.
- **`saveAs(name)`**: blank name rejected before any request (trim, like pedalboard titles). `GET /snapshot/saveas` (`saveSnapshotAs`)
  with `title`; `ok: false` or `id: null` becomes `ModUiError`. Appends `{ name: response.title }`, sets the current index to `response.id`,
  returns the new `Snapshot`. Read the real name from it (`Solo (2)` when taken).
- **`rename(name)`**: blank rejected. `GET /snapshot/rename` (`renameSnapshot`); `ok: false` becomes `ModUiError`; updates the name with
  `response.title` (the unique one) and resolves with it. Renaming to the same name is a no-op on the backend and answers ok.
- **`remove()`**: refuse locally when the names are known and there is only one (the backend returns `false` for it). `GET
  /snapshot/remove` (`removeSnapshot`); `false` becomes `ModUiError`. Local update: delete the entry, shift the later indices, the
  object becomes `alive = false`, and the current index follows the backend rule (`-1` if it was the removed one, otherwise unchanged).
- **`load(index)`**: validate a non-negative integer; if the names are known and the index is out of range, reject without a request.
  `GET /snapshot/load` (`loadSnapshot`); resolves when the HTTP answer arrives, which is after the whole snapshot was applied (the
  `pedal_snapshot` frame is sent before the answer, so no `waitFor` is needed; the HTTP answer is the success signal). `false` becomes `ModUiError` ("not applied: invalid index or interrupted by another
  load"). The values arrive as ordinary frames (`param_set`, `patch_set`, `preset`, bypass), so `instance.params` / `patchParams` /
  `preset` and the immutable `getSnapshot()` update by themselves.
  **`source` tagging**: a snapshot load changes many values with no per-value request. A new `store.expect(match, source)` registration
  (the existing predicate form) is held for the duration of the request, matching `param`, `patch`, `active` and `preset` changes, so
  those events are `origin: 'local'` with the caller's `source`. Frames from another client in the same window get the same tag; the
  backend gives no way to tell them apart (same limitation already documented for `device.load()`).
- **Source option**: `save`, `saveAs`, `rename`, `remove` and `load` take `WriteOptions` (`{ source }`) like every other write; for the
  list events, `'list'` / `'current'` carry `origin` and `source` the same way the plugin events do.

#### Events
| Event | When | Payload |
|---|---|---|
| `current` | the current snapshot changed (load, `saveAs`, `remove`, pedalboard load, `pedal_snapshot`) | `{ snapshot: Snapshot \| null, index: number \| null, previous: number \| null, origin, source? }` |
| `list` | names or order changed, or the list was invalidated by a pedalboard load | `{ snapshots: readonly Snapshot[], origin, source? }` |

Same `Emitter` as the rest (`on`, `once`, `{ signal }`, `{ ignoreLocal }`, `{ ignoreSource }`); events are delivered in frame order, never nested.
An optional later phase adds `snapshots.getState()` / `snapshots.subscribe()` (immutable `{ ready, currentIndex, items: {index, name}[] }`,
batched per animation frame by `SnapshotStore`'s `schedule`) for React/Vue; named `getState` on purpose, `getSnapshot` is taken.

### Banks

#### Model (`src/banks.ts`, new)
`Bank` is a **value object**: the title, its position and the pedalboards as they were when `list()` ran. The client keeps no bank cache
(there is no event for banks, and the backend list can change under us), so there is nothing to invalidate. Editing methods are
**atomic read-modify-write against the server**, which narrows the lost-update window to one request:
1. `GET /banks` (`listBanks`): the response already carries full pedalboard summaries, so no `GET /pedalboard/list` is needed;
2. find the bank by its (current) title, else `ModUiError("The bank no longer exists")`;
3. apply the change on the fresh list;
4. `POST /banks/save` (`saveBanks`) with the whole list; `true` is success, anything else is an error;
5. update the `Bank` object itself (title, index, pedalboards) from the list that was written.
The three steps run inside one **bank queue** (a promise chain private to `BanksApi`), so two calls of the same client never interleave.
Concurrent writers (another tab, the HMI) are still last-write-wins; documented.

#### Save payload
Each pedalboard is sent as `{ bundle, title }` (what the classic UI sends and what `BankInput` requires). Extra properties of a bank are
copied untouched from the `GET` response (`additionalProperties: true`); extra properties of a pedalboard entry cannot be preserved
because `GET` replaces them with the library summary (documented).

#### Rules checked before any request
- A title is non-blank after `trim()`. Titles are unique **ignoring case** (the HMI compares upper-cased; the web only renames exact
  duplicates on the next `GET`, silently). A duplicate is a `ModUiError`; it is not renamed behind the caller's back.
- A pedalboard to add must be a `PedalboardReference` from this client, not `broken`. A **factory** pedalboard (or the default one) is refused
  with a message that points to `reference.copy()`, unless `{ copyFactory: true }`, which does what the classic UI does: `reference.copy()`
  first and the copy goes into the bank.
- `at`, `from`, `to` are integers in range. `bank.pedalboards` may repeat a pedalboard (the backend allows it); `add` does not forbid it.
- `bank.setPedalboards([...])` replaces the content; an empty bank is allowed (the backend only logs a note).

#### Flows and backend calls
| Method | Backend |
|---|---|
| `client.banks.list()` | `GET /banks` (`listBanks`); maps each summary to a `PedalboardReference` through a new internal `PedalboardsApi.reference(summary)` (so `images`, `info()`, `copy()`, `remove()` and `device.load(ref)` work) |
| `get(title)` | `list()` and a lookup |
| `create(title, pedalboards?)`, `bank.rename`, `bank.remove`, `bank.add`, `bank.removePedalboard`, `bank.movePedalboard`, `bank.setPedalboards`, `banks.move` | the read-modify-write above (`listBanks` + `saveBanks`) |
| `client.banks.save(banks)` | `POST /banks/save` only; takes `BankData[]` (`{ title, pedalboards: (PedalboardReference \| { bundle, title })[] }`), applies the same title and factory rules, **replaces everything** (documented as dangerous: prefer the bank methods) |

#### Warnings the TSDoc must carry
`list()` has a side effect on the device (drops missing and broken pedalboards from banks and saves the file). `save()` replaces every bank.
Nothing here loads or selects a bank on the hardware.

### Errors
`ModUiError` for: blank or duplicate titles, an unknown or removed bank / snapshot (`alive` false), index out of range or not an integer, no
current snapshot to save, last snapshot removed, factory / broken / foreign pedalboard in a bank, and every `false` / `ok: false` answer.
`ModUiHttpError` for non-2xx. `ModUiTimeoutError` is not expected (`load` has no WebSocket wait); `load` uses the transport's own behaviour
and can take long on a big pedalboard.

## Backend questions (`CLAUDE.md`: ask before touching `mod/`)
Nothing below is needed to deliver the client; each is a limit the client works around and documents.

| # | Limit | Workaround | Possible backend change | Decision |
|---|---|---|---|---|
| 1 | Removing a snapshot before the current one leaves `current_pedalboard_snapshot_id` on the wrong snapshot | mirror the number, document it | in `snapshot_remove`, decrement the current id when `idx < current` | not asked yet |
| 2 | `saveas` / `rename` / `remove` send no frame, so other clients are not told | `snapshots.list()` re-reads; the own client emits its events locally | broadcast a `pedal_snapshots`-style frame, or `pedal_snapshot` after `saveas` | not asked yet |
| 3 | Web `saveas` / `remove` do not call `readdress_snapshots` (hardware options go stale when the selector is addressed) | none (the client cannot see addressings); documented in TSDoc | call `readdress_snapshots` in the handlers, like the HMI ones | not asked yet |
| 4 | `GET /snapshot/name` answers `Default` for any unknown index | use `list()` | return `ok: false` | not asked yet |
| 5 | No endpoint reads a snapshot's content or reorders snapshots | none; `Snapshot` is `{ index, name }` | new endpoints | not asked yet |
| 6 | `GET /banks` mutates (drops broken pedalboards, renames duplicates, saves) | document | `shouldSave=False` for the web read | not asked yet |
| 7 | `POST /banks/save` has no validation and replaces everything; no bank ids | client validates and does read-modify-write | per-bank endpoints with ids | not asked yet |
| 8 | Factory banks and the HMI's current bank are not exposed | out of scope | read-only endpoints | not asked yet |

## Files to touch (when implemented)
New: `src/pedalboard-snapshots.ts` (`Snapshot`, `PedalboardSnapshots`, model and reconcile), `src/banks.ts` (`Bank`, `BanksApi`, `BankData`, the
bank queue), `test/pedalboard-snapshots.test.ts`, `test/banks.test.ts`.
Changed: `src/types.ts` (wire types `SnapshotListResponse`, `SnapshotSaveAsResponse`, `SnapshotRenameResponse`, `BankSummary`, `BankInput`),
`src/current-pedalboard.ts` (`snapshots` property, constructed with the queue, `GraphState`/`PedalboardStore` access for the frames and
`state.ready()`), `src/pedalboard-store.ts` (a way to feed `loading` / `loaded` / `pedal_snapshot` to the snapshot model; reuse `expect` for
the load window), `src/pedalboards.ts` (`PedalboardsApi.reference(summary)`, reused by `list()`), `src/client.ts` (`client.banks`), `src/index.ts`
(exports and `window.ModUi`), `test/helpers.ts` (a fake backend for the snapshot list and the banks file, frames `pedal_snapshot`,
`loading_end 2`).

## Docs to update (the `CLAUDE.md` rules)
1. `docs/openapi.yml`: document the findings that the contract lacks today: `saveSnapshotAs` / `renameSnapshot` / `removeSnapshot` send no
   frame; the current-id rules table; `removeSnapshot` returns `false` for the last snapshot; `getSnapshotName` never fails; `loadSnapshot`
   answers after the load and `false` when aborted; `listBanks` side effects and "user banks only"; `saveBanks` replaces everything and is
   unvalidated; `pedal_snapshot` is sent only by loads. Then `npx @redocly/cli lint docs/openapi.yml` (with the skip flags from `CLAUDE.md`).
2. `docs/modui-client/implementation-progress.md`: the 7 Snapshot rows and 2 Bank rows get their "Implemented" cell (the `getSnapshotName`
   row stays `—` with the reason); then `python3 docs/modui-client/sync-progress.py`.
3. `docs/modui-client.md`: a section for each area, class diagram additions (`PedalboardSnapshots`, `Snapshot`, `BanksApi`, `Bank`), a sequence
   diagram of `Bank.add` (read-modify-write) and of `snapshots.load` (frames and source tag), the glossary line that separates the three
   meanings of "snapshot".
4. `README.rst` section "TypeScript client (modui-client)" and `CLAUDE.md` (scope line, module list).
5. Both TSDoc sets carry English text with backend calls, `operationId`, errors and `@example`.

## Tests
`test/pedalboard-snapshots.test.ts`: `list()` parsing (string keys sorted numerically, a gap), the same object reused across reads, reconcile by
name (removed, added, renamed elsewhere), `currentIndex` from `loading_end 2` and from `pedal_snapshot` (name with spaces), `saveAs`
(becomes current, unique name from the response, no frame needed), `remove` (indices shift, `alive`, current rule for the removed / earlier /
later case), `rename` (unique name), `save` refused without a current snapshot (nothing sent), `remove` of the last snapshot refused,
`load` (HTTP `false` is an error; events from the frames carry `origin: 'local'` and the `source`; a frame after the request does not),
writes queued behind a running `device.load()`, a pedalboard load invalidates the list and `alive`, `on('current' | 'list')` payloads and
`{ ignoreLocal }`. `test/banks.test.ts`: `list()` maps to references (`device.load(bank.pedalboards[0])` sends the right bundle), each editing
method sends exactly one `GET /banks` then one `POST /banks/save` with the expected body, extra bank properties preserved, duplicate titles
(case-insensitive), blank titles, factory / broken pedalboards refused, `copyFactory` copies first, a bank that disappeared between read
and write, two calls queued in order, `save()` body shape, a `false` answer.

## Phases
1. Snapshots, read side: model, `list`, `get`, `current`, `currentIndex`, events from frames. Tests.
2. Snapshots, write side: `save`, `saveAs`, `rename`, `remove`, `load` with the source window. Tests.
3. Banks, read side: `PedalboardsApi.reference`, `list`, `get`. Tests.
4. Banks, write side: queue, `create`, `rename`, `remove`, `add`, `removePedalboard`, `movePedalboard`, `setPedalboards`, `move`, `save`. Tests.
5. Docs (`openapi.yml`, progress table + script, `modui-client.md`, README, `CLAUDE.md`).
6. Optional: `snapshots.getState()` / `subscribe()` for UI frameworks.
Each phase ends with `npm test`; phase 5 with the lint and `sync-progress.py --check`.

## Verification
`cd modui-client && npm test`; `npx @redocly/cli lint docs/openapi.yml`; `python3 docs/modui-client/sync-progress.py --check`. On the dev server
(`MOD_DEV_HOST=1 MOD_DEV_ENVIRONMENT=0 python3 ./server.py`) with the classic UI open next to a script: `saveAs('Solo')` then `load(0)` and
watch the classic UI title (`pedalboard - name`); remove an earlier snapshot while another is current and confirm the quirk of question 1;
create a bank, add a user pedalboard, reload `/banks` in the classic UI. **Not verifiable without a device**: whether an HMI already running
sees a bank saved from the web, and the behaviour with the snapshot selector addressed to hardware.

## Open items
1. **Names**: `Snapshot` / `PedalboardSnapshots` (proposed) against `SavedSnapshot` / `snapshotStore`. The first reads best and matches the
   backend; the cost is the mix-up with `getSnapshot()`, handled by TSDoc. Decide before phase 1.
2. **`bank.add` with a factory pedalboard**: refuse (proposed default) or copy automatically. The proposal refuses and offers `{ copyFactory: true }`
   so a copy is never created by surprise.
3. **`snapshots.load` accepting a name** (`load('Solo')`): not proposed, names can be renamed by other clients; use the object.
4. **Bank identity by title**: a rename by another client between `list()` and an edit gives "The bank no longer exists". Acceptable.
5. **Waiting for `pedal_snapshot` after `load`**: not required (the HTTP answer is later than the frame); revisit if a device shows otherwise.

## Implementation notes (2026-10-11)
- Files: `src/pedalboard-snapshots.ts`, `src/banks.ts`, `test/pedalboard-snapshots.test.ts` (38), `test/banks.test.ts` (26); changed `src/types.ts`,
  `src/current-pedalboard.ts` (`snapshots`, now also takes the `EventChannel`), `src/device.ts`, `src/pedalboards.ts` (`PedalboardsApi.reference`),
  `src/client.ts` (`client.banks`), `src/index.ts`, `src/graph-state.ts` / `src/pedalboard-store.ts` (`reset(snapshotId)`), `src/pedalboard-graph.ts`
  (`sync()`), `test/helpers.ts` (`connectedAt`, `fakeSnapshotBackend`).
- Names: the current snapshot is `snapshots.current` (object) and `snapshots.currentIndex` (number), as in the plan.
- The model learns pedalboard loads from the store's `loading` / `loaded` / `cleared` events, which are delivered after the plugin descriptions
  are read; `currentIndex` is therefore exact once any awaited call (`list()`, `plugins.list()`) returned, not at the instant of `loading_end`.
  A `pedal_snapshot` report arriving inside that short window is overwritten by the id of `loading_end` (accepted).
- `device.reset()` (`remove :all`) is treated as the backend does: one snapshot, current index 0, no frame.
- A shared WebSocket: the state read through the second socket now passes its `loading_end` id to the store (`loaded.snapshotId` used to be 0).
- `snapshots.save()` takes no `{ source }` (it changes no event, unlike the plan said); `saveAs`, `rename`, `remove` and `load` do.
- Decisions on the open items: names `Snapshot` / `PedalboardSnapshots`; `bank.add()` refuses factory and default pedalboards unless `{ copyFactory: true }`;
  `snapshots.load()` takes an index or an object, not a name; a bank is found by its title (case-insensitive); the HTTP answer of `load` is the success
  signal (no `waitFor`). `Bank` titles are trimmed before they are written.
- Backend: no change was made; the questions table above is unchanged (none asked).
- Docs: `docs/openapi.yml` (snapshot and bank descriptions, `pedal_snapshot` row), `docs/modui-client/implementation-progress.md` (+ sync script),
  `docs/modui-client.md` (1.15, 1.16, 5.9, 5.10, diagrams, limitations), `README.rst`, `CLAUDE.md`.

## Revisions
- **2026-10-11** — First draft, from the code reading above. No backend change is planned; the questions table lists candidates, none asked yet.
- **2026-10-11 (2)** — Implemented phases 1 to 5; notes above.
