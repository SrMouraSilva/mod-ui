---
name: upstream-sync-check
description: Verify what an upstream merge (mod-audio/mod-ui master merged into this branch) changed in the Python backend and the classic UI, and report whether docs/openapi.yml, the TypeScript client (modui-client), modui-plugin-view and the guides are now out of date. Read-only analysis that ends in an impact report. Use after "git merge"/"git pull" of upstream, when asked "does the openapi/docs/client need updating after the merge?". Hand the result to the modui-sync-implement skill.
argument-hint: "[git range or merge commit; default: the latest merge of upstream on this branch]"
---

# Upstream sync check (read-only)

Goal: after the upstream branch was merged, find **every backend or classic-UI change that is visible from outside** and decide, for each one,
whether `docs/openapi.yml`, `modui-client/`, `modui-plugin-view/` and the guides must change. Do not edit anything in this skill: produce the
report, then offer to run the `modui-sync-implement` skill.

`CLAUDE.md` rules apply: never edit `mod/`, `modtools/` or `utils/` (if the fix seems to need a backend change, say so in the report and ask).

## 1. Find what came in

The merge commit has the branch as first parent and upstream as second parent, so what upstream brought is the diff of the first parent against the merge.

```sh
git log --merges --first-parent --format='%h %ad %s' --date=short -8     # find the merge; $ARGUMENTS may name it or a range
M=<merge commit>
git log --oneline $M^1..$M^2                                              # the upstream commits / PRs that came in
git diff --stat $M^1 $M                                                   # files touched
```

If the user pulled by fast-forward or rebase there is no merge commit: use `git diff ORIG_HEAD HEAD` (or the range in `$ARGUMENTS`).
Read the **whole diff** of the relevant files (`git diff $M^1 $M -- mod modtools utils html`), not only the stat: a one-line change can add a
JSON field or a refusal. Also read the commit messages / PR titles; they say what the author intended.

Ignore generated or binary files (`*.so`). Check `git status` first: uncommitted work of the user is not part of the merge.

## 2. Classify every change

Walk the diff file by file. For each hunk decide which contract surface it touches. Where to look:

| Changed file | What to look for | Contract surface |
|---|---|---|
| `mod/webserver.py` | routes in the handler table (`(r"/...", Handler)`), `get_argument` names, `self.write(...)` shape, `HTTPError` codes, `ServerWebSocket.on_message` commands | `paths` of `openapi.yml`; WebSocket client→server table |
| `mod/host.py`, `mod/session.py`, `mod/addressings.py` | `msg_callback(`, `write_message(`, `send_modified`, new frame names or arguments, the state replay in `report_current_state`, new refusals (`callback(False)`) | WebSocket server→client tables and the replay order in `connectMainWebSocket`; endpoint descriptions ("returns `false` when...") |
| `modtools/utils.py`, `utils/utils.h`, `utils/utils_lilv.cpp` | struct fields (the ctypes `Structure` is what `structToDict` turns into JSON), keys Python adds to dicts (`info['x'] = ...`) | `components.schemas` (`PluginInfo`, `NonCachedPluginInfo`, `PedalboardInfo`, `PedalboardSummary`, ...) and `modui-client/src/types.ts` |
| `mod/settings.py` | constants that are visible (paths, limits, format versions, defaults) | endpoint descriptions, `docs/mod-ui.md` |
| `modtools/pedalboard.py`, `mod/screenshot.py` | image generation (sizes, process, files) | image endpoints in `openapi.yml`, `docs/mod-ui.md` |
| `mod/hmi.py`, `mod/mod_protocol.py`, `mod/control_chain.py`, `mod/profile.py` | usually internal; check for effects on `/system/*`, `hw_*`/`cc_*` frames | maybe `openapi.yml` |
| `html/js/*.js`, `html/*.html`, `html/include/*` | **how the classic UI consumes the backend**: a new `cmd == "..."` branch in `host.js` is a new frame, a new `pluginData.x` is a new field | confirms 1 and 2; `html/js/modgui.js` changes must be ported to `modui-plugin-view` (see the "Plugin GUIs" bullet of `CLAUDE.md`) |
| `requirements.txt`, `setup.py`, `server.py`, `Makefile`, `utils/Makefile` | build / run instructions | `README.rst`, `CLAUDE.md` Commands |

Typical hidden changes (check them explicitly): a new key in an existing JSON response; a frame that is sent only in some conditions or only
inside the loading bracket; an operation that now answers `false` / ignores the call for some inputs; a changed default; a new enum value;
a file written to the pedalboard bundle; a changed limit.

## 3. Check each surface against what the repo says today

Use the search tools; do not trust memory. Per change, search for the **name** (frame, field, route, constant) in:

```sh
grep -n "<name>" docs/openapi.yml
grep -rn "<name>" modui-client/src modui-client/test modui-plugin-view/src docs/*.md docs/modui-client docs/plans CLAUDE.md README.rst
```

Then answer, per change:

1. **`docs/openapi.yml`**: is the path / parameter / schema field / WebSocket row / description missing or now wrong? Remember the replay order text and
   both WebSocket tables (server→client, client→server).
2. **`modui-client/`** (only for the areas it covers, see "Current scope" in `CLAUDE.md`): does a wire type lack the field (`src/types.ts`)? Does the
   model ignore a frame it should track (`GRAPH_COMMANDS` in `src/graph-state.ts`, `src/device-state.ts`)? Can a client call now lie about the
   state (the backend ignores or refuses something the client still applies locally, e.g. a write the client echoes with `applyLocal`)? Do the test
   fixtures (`test/helpers.ts`) still look like the real backend?
3. **`modui-plugin-view/`**: did `html/js/modgui.js` (template data, widgets, script API) change? Did the classic UI change how it renders a plugin?
4. **Guides**: `docs/modui-client.md`, `docs/modui-client/implementation-progress.md` (and its html, generated), `docs/modui-client/diagrams/src/specs.py`
   (class fields), `docs/modui-plugin-view*`, `docs/mod-ui.md` (architecture guide: prose, and the numbers measured at one commit; run
   `python3 docs/mod-ui/diagrams/src/measure.py` and compare when files grew), `README.rst`, `CLAUDE.md` ("Backend facts").
5. **Plans**: which plan in `docs/plans/` owns the area; the decision goes in its "Revisions".

Verdict per change, one of:

- **update** (say which files);
- **internal only** (no contract effect; say why in a few words, e.g. "screenshot renderer now takes a job file");
- **needs a decision** (a client design choice with several reasonable answers, or a backend change; ask the user).

## 4. Report

Reply in the user's language (the repo's files stay in English). Keep it a table plus a short list; no long prose.

```
Merge <hash>: <n> upstream commits (<PR titles>)

| # | Change (backend) | Visible as | openapi.yml | modui-client | plugin-view | guides | Verdict |
|---|------------------|------------|-------------|--------------|-------------|--------|---------|

Needs your decision: ...
Internal only: ...
Not checked / limits: ... (e.g. no device available; numbers of docs/mod-ui.md not re-measured)
```

End with: "Run `modui-sync-implement` to apply these?" and wait. If nothing needs updating, say so plainly and list what you looked at, so the
answer can be trusted.

## Pitfalls

- A `git diff` of the merge with `-- mod` misses `html/`; the classic UI is the best hint of what the backend now sends.
- A merge brings several PRs; a later one can change what an earlier one added. Read the final state of the code, not just each hunk.
- Do not run dangerous endpoints to "see if it works" (`client.system.danger.*`, `POST /system/exechange`, `/system/cleanup`, `/save_user_id/`,
  `/controlchain/*`). Reading code is enough.
- `node` may be missing from a non-interactive shell's PATH (nodenv/nvm); this skill does not need it, the implement skill does.
