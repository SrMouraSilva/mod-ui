---
name: modui-sync-implement
description: Apply a backend or classic-UI change to the API contract and its consumers in this repo - update docs/openapi.yml, the TypeScript client modui-client (types, model, events, guards, tests), the guides, the generated progress table and diagrams, and the plan - and verify everything. Use after upstream-sync-check found work, or whenever an endpoint or WebSocket message was added, removed or changed. Never changes mod/, modtools/ or utils/.
argument-hint: "[what to implement, e.g. the upstream-sync-check report or a short description]"
---

# Implement a contract change (openapi + client + docs)

Input: a list of changes, normally the report of the `upstream-sync-check` skill (or `$ARGUMENTS`). If there is no list yet, run that skill first.

Read `CLAUDE.md` first: "Keep the contract and the client in sync", "Method names", "TypeScript client conventions", "Backend facts", "Dangerous
operations". This skill is the order of work, not a replacement for those rules.

## Hard stops

- **No backend edits.** If the work seems to need a change in `mod/`, `modtools/` or `utils/`, stop and ask, explain why, and record the answer
  in the plan of the area.
- **Danger operations** (`client.system.danger.*` and the endpoints behind them) are never called, not even in tests (fakes only).
- A **new client API surface with several reasonable shapes** (new area, new verb, renamed concept): propose it and ask. A new field, a new
  frame that fits an existing event, a guard that stops the client from lying: just do it and say so in the summary.
- Do not commit, push or publish unless asked. Never commit generated files (`html/js/lib/modui-client.js`, `html/js/lib/modui-plugin-view.js`,
  `node_modules/`, `dist/`).

## Setup

```sh
cd modui-client
node -v && npm -v    # needs Node >= 22.12 and npm >= 11.6; Node 24 bundles a good npm
```

If `node` is not found in the tool shell, it is installed through a version manager: look at `~/.nodenv/versions/`, `~/.nvm/versions/node/`
and put the bin directory of Node 24 first in `PATH` for the command (`export PATH=$HOME/.nodenv/versions/24.14.0/bin:$PATH`).
Run `npm test` **before** you change anything, so a failure later is yours and not inherited.

## Order of work

Write the plan note last, but decide the shape first. Use the task list for the steps that apply.

### 1. `docs/openapi.yml` (the source of truth)

Edit by the rules of what changed:

| Change | Edit |
|---|---|
| new / changed route | `paths`: `operationId`, tag, parameters, request body, responses, "Danger: ask a person to confirm first" in the `description` if it can lose data, reboot or write system files |
| new / changed JSON field | the schema in `components.schemas` (also the non-cached and nested variants that Python fills the same way); say when a field is absent on older MOD OS |
| new / changed WebSocket frame | the row in the server→client (or client→server) table of `connectMainWebSocket`; **and** the "Initial state replay" order line if the replay sends it; say in which bracket and under which condition it is sent |
| new refusal / ignored call | the endpoint or frame description ("returns `false` when ...", "ignored with a warning, yet still echoed") |
| behaviour of images, limits, defaults | the description of the endpoint |

Then lint (the skipped rules flag real routes):

```sh
npx --yes @redocly/cli lint docs/openapi.yml --skip-rule=no-path-trailing-slash --skip-rule=operation-2xx-response --skip-rule=operation-4xx-response --skip-rule=no-unused-components
```

### 2. `modui-client/src/` (only for areas the client covers)

Match the surrounding style (TSDoc in English with the backend call and `operationId`, `@throws`, `@example`).

- **New JSON field**: add it to the wire type in `src/types.ts`. Optional (`?`) when an older MOD OS does not send it. Add it to the fixtures of
  `test/helpers.ts` as the real backend sends it.
- **New WebSocket frame that changes the running pedalboard**: add the command to `GRAPH_COMMANDS` (`src/graph-state.ts`), handle it in
  `GraphModel.apply()` returning a `GraphChange`, clear it where the pedalboard is cleared (`clearPedalboard()`, `clear()`), handle the change in
  `PedalboardStore.handle()` (`src/pedalboard-store.ts`) and emit a typed event (`src/pedalboard-events.ts`, `PedalboardEvents`), decide
  whether `SnapshotStore.note()` (`src/snapshot.ts`) needs it, and think about the shared-socket path (`GraphState.readSnapshot()` and
  `PedalboardStore.reset()`). Add a live getter when the state is also useful to read. Document the event in the table of
  `CurrentPedalboard.on()`.
- **New frame about the device** (stats, transport, ...): `src/device-state.ts` and `DeviceEvents`.
- **Backend now ignores / refuses something the client applies locally** (`applyLocal`, `expect`): add a guard that rejects with `ModUiError`
  before anything is sent, and an accessor that tells the application beforehand (`instance.bypassable` is the model).
- **New endpoint** in a covered area: a method in the area module using the verbs of the "Method names" table, `HttpTransport` only, never a
  raw `fetch`; confirmations over the WebSocket are awaited (`events.waitFor` registered **before** the request).
- Public symbols export through `src/index.ts` (no side effects there; `window` goes in `src/browser.ts`).

### 3. Tests (`modui-client/test/`)

One file per area, shared fakes from `test/helpers.ts` (`makeClient`, `connectedWith`, `FakeWebSocket`, `flush`). Cover: the frame inside and
outside a load, a later load forgets it, `remove :all`, a malformed frame is ignored, the shared-socket path, the guard sends nothing, the
state is not changed by a rejected call. Then:

```sh
cd modui-client && npm test        # tsc --noEmit + vitest; must stay green
```

### 4. Generated and tracked docs

```sh
python3 docs/modui-client/sync-progress.py                 # after editing the operations table of docs/modui-client/implementation-progress.md
python3 docs/modui-client/diagrams/src/build.py            # after changing specs.py; read and fix every warning it prints
python3 docs/modui-plugin-view/diagrams/src/build.py       # only when plugin-view classes changed
```

- `docs/modui-client/implementation-progress.md`: edit the operation's row (the only part that is edited by hand); never edit the summary table or
  the html.
- `docs/modui-client.md`: the example, the rules list and the limits that changed; keep its Mermaid diagrams true.
- Diagrams: a new field/operation goes in `docs/modui-client/diagrams/src/specs.py`, never in the `.svg` files. Commit the `.svg` with `specs.py`.
- `README.rst` section "TypeScript client (modui-client)" only if usage changed.
- `CLAUDE.md`: the "Backend facts" list when you learned something easy to get wrong; the "Current scope" paragraph when the client gained a feature.
- `docs/mod-ui.md` (architecture guide): prose that the change made false. Its numbers were measured at one commit; if files grew a lot,
  say so in the summary instead of re-measuring silently (`python3 docs/mod-ui/diagrams/src/measure.py`).
- `modui-plugin-view/`: if `html/js/modgui.js` changed, port it (its tests pin the classic behaviour); if only a related classic-UI behaviour
  changed, add it to "Future work" of `docs/plans/2026-10-modui-plugin-view.md` and tell the user.

### 5. The plan

Add a dated entry to "Revisions" of the plan that owns the area (`docs/plans/2026-10-modui-client-*.md`) with: what the backend changed (PR numbers),
what the client now does, what was decided and why, and what was left out. Today's date is in the session context.

### 6. Verify

All of these must pass, and you report their real output:

```sh
cd modui-client && npm test
cd modui-plugin-view && npm test        # when the view or the client types it uses changed
npx --yes @redocly/cli lint docs/openapi.yml --skip-rule=no-path-trailing-slash --skip-rule=operation-2xx-response --skip-rule=operation-4xx-response --skip-rule=no-unused-components
python3 docs/modui-client/sync-progress.py
git status --short                       # no mod/, modtools/, utils/, no html/js/lib/*.js, no node_modules/dist
```

## Summary to the user

Reply in the user's language. Say what changed per surface (openapi, client, tests, docs, plan), how many tests pass, what you decided on your own
(and could be reversed), and what is left: items that need their decision, the plugin-view follow-ups, the guides whose numbers drifted. Do not
claim anything you did not run.
