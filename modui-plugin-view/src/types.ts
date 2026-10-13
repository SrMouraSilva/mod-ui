// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public types of the library, and the parts of `modui-client` it relies on.
 * @module
 */

import type { ModUiClient, Plugin, PluginInfo, PluginInstance, PatchValue } from 'modui-client';
import type { MustacheRender } from './mustache';

/** What a view is created from: a plugin of the running pedalboard (live), or a catalogue plugin (preview). */
export type ViewTarget = PluginInstance | Plugin | PluginInfo | string;

/** The client the library works with. Only these members are used, so a test can pass a lighter object. */
export type ViewClient = Pick<ModUiClient, 'baseUrl' | 'events' | 'device' | 'files'>;

/** A jQuery-like function: the plugin scripts receive `event.icon` / `event.settings` wrapped by it. */
export type JQueryLike = (element: Element) => unknown;

/** `fetch`, as the library calls it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Which global stylesheets of mod-ui {@link PluginViews} adds to the document. */
export interface StyleOptions {
  /** `css/pedals.css` and `resources/pedals/default.css`: the base look of icons and settings panels. Default `true`. */
  base?: boolean;
  /** `css/fonts.css`, and the `@font-face` rules of `css/main.css` (Nexa, Questrial, ... used by many pedals). Default `true`. */
  fonts?: boolean;
  /** More stylesheet URLs to link (absolute, or relative to `client.baseUrl` when they start with `/`). */
  extra?: string[];
}

/** Options of {@link PluginViews}. All are optional. */
export interface PluginViewsOptions {
  /**
   * jQuery (or a compatible function), needed to run the plugins' own JavaScript, whose contract hands them jQuery objects. Default:
   * `window.jQuery` when the page has it. Without it, the scripts are skipped (and `view.on('error')` says so once per view).
   */
  jQuery?: JQueryLike | null;
  /** Mustache renderer, e.g. `Mustache.render` of mustache.js. Default: the built-in one (see `renderMustache`). */
  mustache?: MustacheRender;
  /**
   * `fetch` used for the one file of the classic page the library reads, `css/main.css` (for its `@font-face` rules). Everything of the
   * plugins goes through the client. Default: the global `fetch`.
   */
  fetch?: FetchLike;
  /**
   * Global stylesheets added to {@link PluginViewsOptions.document}, once. `false` adds none (the page brings its own). Default: all of
   * {@link StyleOptions}.
   */
  styles?: boolean | StyleOptions;
  /** Document the elements and styles are created in. Default: the global `document`. */
  document?: Document;
  /**
   * Asks the user for a preset name (settings panel: "Save as", "Rename"). Resolves with the name, or `null` to cancel. Default:
   * `window.prompt`.
   */
  promptName?: (title: string, current: string) => Promise<string | null> | string | null;
  /** Run the plugins' JavaScript (when jQuery is available). Default `true`. */
  scripts?: boolean;
}

/** Per-view options of {@link PluginViews.create}. */
export interface CreateViewOptions {
  /** For a preview: the bypass state shown (`true`: bypassed). Default `false`. */
  bypassed?: boolean;
  /** For a preview: initial values of control ports, by symbol. */
  values?: Record<string, number>;
  /** Run this plugin's JavaScript. Default: {@link PluginViewsOptions.scripts}. */
  scripts?: boolean;
}

/** Common fields of the view events. */
export interface ViewEventMeta {
  /** Who caused the change, see {@link ViewOrigin}. */
  origin: ViewOrigin;
}

/**
 * Who caused a change:
 * - `'user'`: a gesture on this view (a knob, a footswitch, a value field, the preset panel);
 * - `'script'`: the plugin's own JavaScript (`set_port_value`, `patch_set`);
 * - `'api'`: a call to the view's methods (`view.setValue(...)`);
 * - `'external'`: anything that arrived through `modui-client`: the classic UI, the HMI, other clients, a preset load, other code of the
 *   page that wrote through the client.
 */
export type ViewOrigin = 'user' | 'script' | 'api' | 'external';

/** A control port changed (`view.on('change')`). */
export interface ViewChangeEvent extends ViewEventMeta {
  symbol: string;
  value: number;
}

/** A patch parameter changed (`view.on('patch')`). */
export interface ViewPatchEvent extends ViewEventMeta {
  uri: string;
  value: PatchValue | undefined;
}

/** The plugin was switched on or bypassed (`view.on('active')`). */
export interface ViewActiveEvent extends ViewEventMeta {
  active: boolean;
}

/** The current preset changed (`view.on('preset')`). `null`: none. */
export interface ViewPresetEvent extends ViewEventMeta {
  preset: string | null;
}

/** An output control port reported a value (`view.on('output')`): meters, tuners, ... */
export interface ViewOutputEvent {
  symbol: string;
  value: number;
}

/**
 * Where a {@link ViewErrorEvent} comes from: `write` (the client refused or failed a write), `script` (the plugin's JavaScript threw,
 * could not be compiled, or needs jQuery), `preset` (a preset operation failed), `files` (a modgui file or a file list could not be read).
 */
export type ViewErrorContext = 'write' | 'script' | 'preset' | 'files';

/** Something failed in the background. The view goes on working. */
export interface ViewErrorEvent {
  error: unknown;
  context: ViewErrorContext;
  /** The plugin URI. */
  uri: string;
}

/** The view is gone: `destroy()` was called, or the plugin left the pedalboard (`reason` from `instance.on('removed')`). */
export interface ViewDestroyedEvent {
  reason: 'destroyed' | 'removed' | 'cleared' | 'reloaded';
}

/** Events of {@link PluginView.on}. */
export interface ViewEvents {
  change: ViewChangeEvent;
  patch: ViewPatchEvent;
  active: ViewActiveEvent;
  preset: ViewPresetEvent;
  output: ViewOutputEvent;
  /** The "Close" button of the settings panel (`.js-close`) was clicked: hide the panel. */
  close: Record<string, never>;
  error: ViewErrorEvent;
  destroyed: ViewDestroyedEvent;
}

/** Events of {@link PluginViews.on}. */
export interface PluginViewsEvents {
  /** An error while a view was created (a missing modgui file, a script that does not compile, ...), or of any view later. */
  error: ViewErrorEvent;
}

/** Errors thrown by the library. */
export class PluginViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginViewError';
  }
}
