// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Payloads of the events of the running pedalboard: what `currentPedalboard.on(...)`, `instance.on(...)`, `param.on(...)` and
 * `patchParam.on(...)` deliver. See {@link PedalboardEvents} and {@link PluginEvents}.
 * @module
 */

import type { EventMeta } from './emitter';
import type { PatchParam } from './patch-params';
import type { Param, PluginInstance } from './pedalboard-graph';
import type { PatchValue, PortDirection, PortType } from './types';

/** `plugin:added`: a plugin appeared in the pedalboard. `plugin` is complete (its description is loaded) and stable. */
export interface PluginAddedEvent extends EventMeta {
  plugin: PluginInstance;
}

/** Why a {@link PluginInstance} stopped being part of the pedalboard. */
export type PluginRemovedReason = 'removed' | 'cleared' | 'reloaded';

/**
 * `plugin:removed` (the plugin was removed) and the plugin's own `removed` (it is gone for any reason). `plugin.alive` is
 * already `false`; its getters keep the last known state.
 */
export interface PluginRemovedEvent extends EventMeta {
  plugin: PluginInstance;
  /** `'removed'`: one plugin was removed; `'cleared'`: the pedalboard was reset; `'reloaded'`: another pedalboard is loading. */
  reason: PluginRemovedReason;
}

/** `connection:added` / `connection:removed`: ids of the output (`from`) and the input (`to`) port. */
export interface ConnectionEvent extends EventMeta {
  from: string;
  to: string;
}

/** `port:added`: a port of the pedalboard itself appeared (physical, virtual or MIDI). */
export interface PortAddedEvent extends EventMeta {
  id: string;
  type: PortType;
  direction: PortDirection;
  title: string;
  index: number;
}

/** `port:removed`: a port of the pedalboard itself disappeared. */
export interface PortRemovedEvent extends EventMeta {
  id: string;
}

/**
 * `loading`: a pedalboard (re)load begins. The plugins and connections are being rebuilt: until `loaded`, no `plugin:*`,
 * `connection:*`, `port:*` or plugin event is delivered, and the instances of the previous pedalboard are gone.
 */
export interface LoadingEvent extends EventMeta {
  /** The pedalboard being loaded is the empty one. */
  empty: boolean;
  /** The pedalboard is marked as modified. */
  modified: boolean;
}

/**
 * `loaded`: the pedalboard is complete (also fired once when the client gets in sync after it connects). Read the state again:
 * `plugins.list()`, `connections.list()`, `ports.list()`. Every plugin description is loaded by now.
 */
export interface LoadedEvent extends EventMeta {
  snapshotId: number;
}

/** `cleared`: the pedalboard was emptied (`device.reset()`, `remove :all`). Individual removals are not delivered. */
export type ClearedEvent = EventMeta;

/** Where an {@link ErrorEvent} comes from. */
export type PedalboardErrorContext = 'plugin-description';

/**
 * `error`: something failed in the background, where no call can report it.
 * `'plugin-description'`: `POST /effect/bulk/` failed while plugins appeared. They exist with `info === null` (no ports, no
 * params); `plugins.list()` and `plugins.get()` try the request again.
 */
export interface ErrorEvent {
  error: Error;
  context: PedalboardErrorContext;
}

/** Events of `client.device.currentPedalboard.on(...)`. */
export interface PedalboardEvents {
  'plugin:added': PluginAddedEvent;
  'plugin:removed': PluginRemovedEvent;
  'connection:added': ConnectionEvent;
  'connection:removed': ConnectionEvent;
  'port:added': PortAddedEvent;
  'port:removed': PortRemovedEvent;
  loading: LoadingEvent;
  loaded: LoadedEvent;
  cleared: ClearedEvent;
  error: ErrorEvent;
}

/** `instance.on('param')` and `param.on('change')`: a control port changed value. */
export interface ParamEvent extends EventMeta {
  plugin: PluginInstance;
  param: Param;
  value: number;
  /** The value before (the `default` when none was known). */
  previous: number;
}

/** `instance.on('active')`: the plugin was bypassed (`active: false`) or switched on. */
export interface ActiveEvent extends EventMeta {
  plugin: PluginInstance;
  active: boolean;
}

/** `instance.on('moved')`: the block moved in the canvas. */
export interface MovedEvent extends EventMeta {
  plugin: PluginInstance;
  x: number;
  y: number;
}

/**
 * `instance.on('patch')` and `patchParam.on('change')`: a patch parameter changed value.
 * `param` is `undefined` for a parameter of a type the client does not handle (it is listed in `plugin.info.parameters`).
 */
export interface PatchEvent extends EventMeta {
  plugin: PluginInstance;
  uri: string;
  param: PatchParam | undefined;
  /** The new value, `undefined` when `param` is. */
  value: PatchValue | undefined;
}

/** What `patchParam.on('change')` delivers: a {@link PatchEvent} of a known parameter. */
export type PatchParamEvent = PatchEvent & { param: PatchParam };

/** Events of `instance.on(...)`. */
export interface PluginEvents {
  param: ParamEvent;
  active: ActiveEvent;
  moved: MovedEvent;
  patch: PatchEvent;
  removed: PluginRemovedEvent;
}

/** Every event of the store's emitter (internal): the pedalboard's, and the plugins' under their own names. */
export interface StoreEvents extends PedalboardEvents {
  param: ParamEvent;
  active: ActiveEvent;
  moved: MovedEvent;
  patch: PatchEvent;
  /** Every death of an instance, whatever the reason; backs `instance.on('removed')`. */
  'instance:removed': PluginRemovedEvent;
}
