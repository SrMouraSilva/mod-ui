// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Entry of the browser-global build (`<script src="modui-client.js">`): sets `window.ModUiClient` and `window.ModUi`.
 * Bundlers and Node import `index.ts` instead, which has no side effect.
 * @module
 */

import {
  Bank,
  BanksApi,
  CurrentPedalboard,
  Device,
  EventChannel,
  FilesApi,
  ImageStatus,
  ModUiClient,
  ModUiError,
  ModUiHttpError,
  ModUiTimeoutError,
  Param,
  PatchParam,
  PedalboardConnection,
  PedalboardConnections,
  PedalboardImages,
  PedalboardPlugins,
  PedalboardPortGroup,
  PedalboardPorts,
  PedalboardReference,
  PedalboardSnapshots,
  PedalboardsApi,
  Plugin,
  PluginGui,
  PluginInstance,
  PluginParams,
  PluginPatchParams,
  PluginPresets,
  PluginsApi,
  Port,
  Preset,
  Snapshot,
} from './index';

if (typeof window !== 'undefined') {
  const globals = window as unknown as Record<string, unknown>;
  globals.ModUiClient = ModUiClient;
  globals.ModUi = {
    ModUiClient,
    ModUiError,
    ModUiHttpError,
    ModUiTimeoutError,
    PedalboardReference,
    PedalboardsApi,
    BanksApi,
    Bank,
    PedalboardImages,
    ImageStatus,
    Device,
    CurrentPedalboard,
    EventChannel,
    Plugin,
    PluginsApi,
    PluginGui,
    FilesApi,
    PluginInstance,
    Param,
    PluginParams,
    PatchParam,
    PluginPatchParams,
    PluginPresets,
    Preset,
    PedalboardPlugins,
    PedalboardSnapshots,
    Snapshot,
    PedalboardConnection,
    PedalboardConnections,
    PedalboardPorts,
    PedalboardPortGroup,
    Port,
  };
}
