# Plan: `ModUiClient` – system (`client.system`, `client.config`, writes of `client.device`)

Status: **implemented** (2026-10-18), unit tests only; not checked against a device (see "Open points"). Every phase below is done. Builds on `2026-10-modui-client-events.md` (`DeviceState`, `device.on('bufferSize' | 'trueBypass' | 'stats' | 'sysStats')`).
It covers the `System` section of `docs/openapi.yml` (11 operations), the Control Chain firmware operations of `Updates` (2) and one new
operation, `GET /config/get`. `docs/modui-client/implementation-progress.md` lists the recommendations this plan refines.

## Decisions (asked of the user, 2026-10-18)

| Topic | Decision |
|---|---|
| Scope | Everything of `System`, including `exechange` and `cleanup`. |
| Dangerous operations | Live in the namespace `client.system.danger` (see below). No `confirm` flag: the namespace is the gate. |
| Writes next to their value | `setBufferSize`, `setTrueBypass`, `resetXruns`, `switchCpuFrequency` are methods of `client.device`, beside `device.bufferSize`, `device.trueBypass`, `device.stats`, `device.sysStats`. |
| Buffer size | `device.setBufferSize(BufferSize)` takes an **enum** (`BufferSize.Frames128`, `BufferSize.Frames256`), never a free number. Checked again at run time for JavaScript callers. |
| User preferences | **Backend change confirmed**: new `GET /config/get` (all preferences as JSON, without secrets). |
| Secrets | `GET /config/get` omits every key whose name contains `api-key`, `api_key`, `apikey` or `secret` (case-insensitive). |
| Two kinds of configuration | `client.config.mod` (the keys that mod-ui itself reads and writes) and `client.config.app` (anything a frontend built on this client wants to keep). |
| Storage of `config.app` | One preference, key `modui-client`, whose value is a JSON object. The rest of the keys are mod-ui's. |
| Size of `config.app` | At most **10 KiB** (10240 bytes of JSON). Every write checks it before sending and throws `ModUiConfigTooLargeError`. |
| `saveUserId` | Write only, inside `system.danger`. No read is added (the name and e-mail only come embedded in the HTML of `/`). |

## Findings (verified in the code on 2026-10-18)

### Preferences
- `POST /config/set` → `SESSION.prefs.setAndSave(key, value)` (`mod/session.py`): an in-memory dict, written atomically to `PREFERENCES_JSON_FILE`.
  Values from the web are strings; the host itself also writes **typed** values (`tuner-*`, `display-brightness`, `quick-bypass-mode`,
  `bank-footswitch-navigation`, from the HMI paths) and reads them with a type (`prefs.get(key, default, int)`).
- Today the only way to read them is the server-rendered page: `TemplateHandler` puts `json.dumps(SESSION.prefs.prefs)` in `{{preferences}}`
  (`var PREFERENCES = ...` in `index.html` and `settings.html`). Everything the page injects (including `t3k_api_key`) is in the HTML.
- Keys the classic UI writes with `/config/set` (all strings): `dev-mode` (`on` / `off`), `plugins-folded` (`true` / `false`),
  `show-labs-plugins` (`true` / `false`), `pb-view-mode` (`grid` / `list`), `cloud-terms-accepted` (`true` / `false`),
  `update-channel` (`stable` / `testing`). `t3k-api-key` is also stored there (a secret). The typed keys of the host must **not** be written
  through `/config/set`: `bool("false")` is `True` in Python, so a string would change their meaning.
- `config.app` lives in the same file and is therefore also embedded in every `GET /` and `settings.html`: this is why it is small by design.

### System operations (`mod/webserver.py`)
- `GET /truebypass/{Left|Right}/{true|false}` answers a bare boolean. The `truebypass` frame comes from the ALSA callback and is not
  guaranteed when the value did not change. `POST /set_buffersize/{128|256}` answers `{ ok, size }`; the `bufsize` frame comes from the JACK
  callback. Because the HTTP answer already says what happened, the client **does not wait for the frame**: it applies the answer to
  `DeviceState` (which ignores a repeated value, so the frame that follows changes nothing).
- `POST /switch_cpu_freq/` and `POST /reset_xruns/` answer `true` / `false`; the result shows up in the next `sysStats` / `stats` frame.
- `POST /system/exechange` dispatches on `type` (`command`, `filecreate`, `filewrite`, `service`) with whitelists; `POST /system/cleanup` deletes
  user data and restarts mod-ui. The classic settings page also sends `cmd=poweroff`; **the backend does not know it** (answers `false`), so the
  client does not expose it. Recorded, not fixed.
- Writing the files of `/data` on a development host creates them on the developer's machine: tests use fakes only.

## API

### `client.device` (writes beside their values)

| Method | Backend | Notes |
|---|---|---|
| `setBufferSize(size: BufferSize)` → `BufferSizeEvent` | `POST /set_buffersize/{size}` (`setBufferSize`) | `ok: false` → `ModUiError`. |
| `setTrueBypass({ left?, right? })` | `GET /truebypass/{channel}/{bypassed}` (`setTrueBypass`) | One request per channel given; none for `{}`. `false` → `ModUiError`. |
| `resetXruns()` | `POST /reset_xruns/` (`resetXruns`) | |
| `switchCpuFrequency()` | `POST /switch_cpu_freq/` (`switchCpuFrequency`) | `false` → `ModUiError`. |

### `client.system`

| Method | Backend |
|---|---|
| `info()` | `GET /system/info` (`getSystemInfo`) |
| `ping()` → `{ online, roundTripMs }` | `GET /ping` (`ping`) |
| `settings.get()` | `GET /system/prefs` (`getSystemPreferences`) |

### `client.system.danger` (read the warning in the guide)

Everything here changes the device outside the audio session (reboots it, deletes data, flashes firmware, starts or stops services, writes
system files, overwrites the identity of the user). An application must ask a person first, and an AI tool **must** confirm with a human
before it calls any of them (see "Warning").

| Method | Backend |
|---|---|
| `settings.set(patch)` | `POST /system/exechange` (`systemExecuteChange`, `filecreate` / `filewrite` / `service`) |
| `startHmiUpdate()` | `POST /system/exechange` (`service` `hmi-update`) |
| `reboot()` | `POST /system/exechange` (`command` `reboot`) |
| `restoreFactory()` | `POST /system/exechange` (`command` `restore`) |
| `backup.export({ data, pedalboards })` / `backup.import(...)` | `POST /system/exechange` (`command` `backup-export` / `backup-import`) |
| `cleanup({ banks, favorites, hmiSettings, licenseKeys, pedalboards, plugins })` | `POST /system/cleanup` (`systemCleanup`) |
| `saveUserId({ name, email })` | `POST /save_user_id/` (`saveUserId`) |
| `uploadControlChainFirmware(blob)` / `cancelControlChainUpdate()` | `POST /controlchain/download/`, `POST /controlchain/cancel/` |

### `client.config`

| Method | Backend |
|---|---|
| `mod.getAll()` / `mod.get(key)` / `mod.set(key, value)` | `GET /config/get` (`getUserPreferences`, **new**), `POST /config/set` (`setUserPreference`) |
| `app.getAll()` / `get(key)` / `set(key, value)` / `delete(key)` / `replaceAll(values)` | the same two operations, on the key `modui-client` |

- `ModConfigKey` is an enum of the keys mod-ui owns; `ModConfigData` is `{ [key in ModConfigKey]?: value }` with the values typed (and checked) per key. Keys
  outside the enum are not returned and cannot be written.
- `config.app` reads the whole object, changes one key and writes the whole object back, inside a queue private to the client (as `BanksApi`). Two
  clients writing at the same moment can overwrite each other (last write wins): the backend has no compare-and-set.
- Nothing in `config.app` is secret: `GET /config/get` answers it to anyone who can reach the device, and the HTML embeds it.
- No frame reports a change of preferences: there is no event for a write made by someone else.

## Warning (goes in the guide, the README, the TSDoc and `CLAUDE.md`)
1. **AI tools** (LLM agents, MCP servers, code assistants) must ask a human to confirm, every time, before using anything in `client.system.danger`
   or an equivalent endpoint (`/system/exechange`, `/system/cleanup`, `/save_user_id/`, `/controlchain/*`).
2. **Applications** built on `modui-client` must always ask the user explicitly (for example with a confirmation modal that says what will happen).

## Backend change (confirmed by the user, 2026-10-18)
`GET /config/get`: `JsonRequestHandler`, answers the preferences dict without the keys whose name matches `api[-_]?key|secret` (case-insensitive).
No argument, no side effect.

## Phases
1. Backend `GET /config/get`, `docs/openapi.yml`.
2. `client.device` writes (`BufferSize`, `setTrueBypass`, `resetXruns`, `switchCpuFrequency`).
3. `client.config` (`mod`, `app`, the 10 KiB limit).
4. `client.system` (`info`, `ping`, `settings.get`) and `client.system.danger`.
5. Tests, progress table, guide, README, diagrams.

## Verification
`npm test` (type check + 22 test files, 435 tests, among them `test/device-writes.test.ts`, `test/config.test.ts`, `test/system.test.ts`), `npm run build`, `redocly lint`, the
diagrams regenerated (`domain-system`, `domain-config`, and `Device` / the architecture updated). The backend handler was only compiled (`py_compile`); it was not run.

## Open points
- No `poweroff` (see above).
- Whether `startHmiUpdate` works outside a real device was not checked (it runs `systemctl start hmi-update`).
- Nothing was run against a real device; the tests use fakes.
