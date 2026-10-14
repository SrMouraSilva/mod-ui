// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * # modui-client
 *
 * Typed browser client for the mod-ui backend. It wraps the HTTP API with `fetch` and listens to the
 * main WebSocket (`/websocket`) so that long-running operations can be awaited until the backend
 * really finished them.
 *
 * - Wire contract: `docs/openapi.yml` (each public method names the `operationId` it uses).
 * - Developer guide with diagrams: `docs/modui-client.md`.
 *
 * ## Quick start
 *
 * ```ts
 * const client = new ModUiClient();                 // same origin as the page
 * const pedalboards = await client.pedalboards.list();
 * const info = await pedalboards[0].info();
 * await client.device.load(info);                   // resolves after the WebSocket "loading_end"
 * await client.device.loadDefault();                // empty "Untitled" pedalboard
 * ```
 *
 * Installed from npm it is a plain ES module (`import { ModUiClient } from 'modui-client'`); importing it has no side effect.
 * In the classic mod-ui page the build output (`html/js/lib/modui-client.js`, from `src/browser.ts`) is loaded with a
 * `<script>` tag and exposes `window.ModUiClient` (plus `window.ModUi` with the other classes).
 *
 * ## Modules
 *
 * | Module | Content |
 * |--------|---------|
 * | `index.ts` | the public API: exports only, no side effect (the npm entry) |
 * | `browser.ts` | entry of the `<script>` build: sets `window.ModUiClient` and `window.ModUi` |
 * | `client.ts` | {@link ModUiClient}, {@link ModUiClientOptions} — entry point, wires everything |
 * | `pedalboards.ts` | {@link PedalboardsApi} (`client.pedalboards`), {@link PedalboardReference} |
 * | `device.ts` | {@link Device} (`client.device`) — load / reset the running pedalboard |
 * | `current-pedalboard.ts` | {@link CurrentPedalboard} (`client.device.currentPedalboard`) — get / save / saveAs |
 * | `plugins.ts` | {@link PluginsApi} (`client.device.plugins`), {@link Plugin} — installed plugins |
 * | `plugin-gui.ts` | {@link PluginGui} (`plugin.gui`) — URLs and text of a plugin's modgui files, thumbnail and screenshot |
 * | `files.ts` | {@link FilesApi} (`client.files`) — the user's samples, impulse responses and models |
 * | `pedalboard-plugins.ts` | {@link PedalboardPlugins} (`currentPedalboard.plugins`) — list / add / remove |
 * | `pedalboard-connections.ts` | {@link PedalboardConnections} (`currentPedalboard.connections`), {@link PedalboardPorts} (`currentPedalboard.ports.list()`, `.audio.input()` …) |
 * | `pedalboard-snapshots.ts` | {@link PedalboardSnapshots} (`currentPedalboard.snapshots`), {@link Snapshot} — saved sets of plugin values |
 * | `banks.ts` | {@link BanksApi} (`client.banks`), {@link Bank} — ordered collections of pedalboards |
 * | `pedalboard-graph.ts` | {@link PluginInstance}, {@link Port}, {@link PedalboardConnection}, and the internal engine |
 * | `plugin-presets.ts` | {@link PluginPresets} (`instance.presets`), {@link Preset} — factory and user presets of a plugin |
 * | `patch-params.ts` | {@link PatchParam}, {@link PluginPatchParams} (`instance.patchParams`) — strings, paths, booleans, ... |
 * | `graph-state.ts` | internal WebSocket-fed model of the running graph |
 * | `pedalboard-store.ts` | internal: the plugin objects and the events about the running pedalboard |
 * | `pedalboard-events.ts` | payloads of `currentPedalboard.on(...)`, `instance.on(...)`, `param.on(...)` |
 * | `snapshot.ts` | {@link PedalboardSnapshot} — immutable state for UI frameworks (`getSnapshot()`, `subscribe()`) |
 * | `device-state.ts` | {@link DeviceEvents} — `client.device.on('stats' ...)`, transport, snapshots |
 * | `emitter.ts` | internal typed emitter, `ListenOptions` (`signal`, `ignoreSource`, `ignoreLocal`) |
 * | `pedalboard-images.ts` | {@link PedalboardImages} (`reference.images`), {@link ImageStatus} — screenshot and thumbnail |
 * | `events.ts` | {@link EventChannel} (`client.events`) — the main WebSocket |
 * | `http.ts` | `HttpTransport` — internal `fetch` wrapper |
 * | `errors.ts` | {@link ModUiError}, {@link ModUiHttpError}, {@link ModUiTimeoutError} |
 * | `types.ts` | Wire types (`PedalboardSummary`, `PedalboardInfo`, ...) and shared option/result types |
 * | `runtime.ts` | `FetchLike`, `WebSocketLike`, `WebSocketFactory` — injectable runtime surfaces |
 *
 * @module
 */

export { Bank, BanksApi } from './banks';
export type { AddToBankOptions, BankData } from './banks';
export { ModUiClient } from './client';
export type { ClientEvents, ModUiClientOptions } from './client';
export { CurrentPedalboard } from './current-pedalboard';
export { Device } from './device';
export type { ConnectionSnapshot, PedalboardSnapshot, PluginSnapshot, PortSnapshot, Schedule } from './snapshot';
export type {
  BufferSizeEvent,
  DeviceEvents,
  SnapshotEvent,
  StatsEvent,
  SysStatsEvent,
  TransportEvent,
  TrueBypassEvent,
} from './device-state';
export { ModUiError, ModUiHttpError, ModUiTimeoutError } from './errors';
export type { EventMeta, ListenOptions, Origin, Unsubscribe } from './emitter';
export { EventChannel } from './events';
export type { ConnectionState, MessageHandler, ReconnectOptions, StateEvent, StateReason, Waiting } from './events';
export type * from './pedalboard-events';
export { ImageStatus, PedalboardImages } from './pedalboard-images';
export { PedalboardConnections, PedalboardPortGroup, PedalboardPorts } from './pedalboard-connections';
export { Param, PedalboardConnection, PluginInstance, PluginParams, Port } from './pedalboard-graph';
export type { PortGroups, PortsByDirection } from './pedalboard-graph';
export { PatchParam, PluginPatchParams } from './patch-params';
export { PluginPresets, Preset } from './plugin-presets';
export type { PresetEvents, PresetListEvent } from './plugin-presets';
export { PedalboardPlugins } from './pedalboard-plugins';
export { PedalboardSnapshots, Snapshot } from './pedalboard-snapshots';
export type { SnapshotCurrentEvent, SnapshotEvents, SnapshotListEvent } from './pedalboard-snapshots';
export { PedalboardReference, PedalboardsApi } from './pedalboards';
export { FilesApi } from './files';
export { GUI_FILES, PluginGui } from './plugin-gui';
export type { DefaultGuiTemplates, GuiFile, GuiFiles } from './plugin-gui';
export { Plugin, PluginsApi } from './plugins';
export type { FetchLike, WebSocketFactory, WebSocketLike } from './runtime';
export type * from './types';
