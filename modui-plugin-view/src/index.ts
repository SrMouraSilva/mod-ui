// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `modui-plugin-view`: the GUI (modgui) of MOD plugins, outside the classic mod-ui, on top of `modui-client`.
 *
 * | Module | What |
 * |--------|------|
 * | `views.ts` | {@link PluginViews}: the entry point (`new PluginViews(client)`, `views.create(instance)`) |
 * | `view.ts` | {@link PluginView}: the icon and settings panel of one plugin, live or preview |
 * | `binding.ts` | internal: where a view reads and writes (a `PluginInstance`, or local memory) |
 * | `widgets.ts` | the `mod-widget` widgets (filmstrip knobs, switches, footswitch, selects, file lists) |
 * | `template-data.ts` | {@link buildTemplateData}: the data the templates are rendered with |
 * | `styles.ts`, `image.ts` | internal: stylesheets in the document, image size |
 * | `script.ts` | internal: the plugins' own JavaScript (`api_version` 3) |
 * | `urls.ts` | `ns` / `cns` of the templates, URL rebasing (the plugin's files and their URLs are `plugin.gui` of `modui-client`) |
 * | `vendor.ts` | `renderMustache` and `sprintf`: the very `mustache.js` and `sprintf-0.6.js` files of the classic UI, inlined by the build |
 * | `browser.ts` | entry of the `<script>` build: sets `window.ModUiPluginView` |
 *
 * Installed from npm it is a plain ES module with no side effect and no runtime dependency (`modui-client` is only a type peer). The
 * IIFE build (`npm run build`, from `browser.ts`) sets `window.ModUiPluginView` for a `<script>` tag.
 * @module
 */

export { PluginViews } from './views';
export { PluginView } from './view';
export { PluginViewError } from './types';
export type {
  CreateViewOptions,
  FetchLike,
  JQueryLike,
  PluginViewsEvents,
  PluginViewsOptions,
  StyleOptions,
  ViewActiveEvent,
  ViewChangeEvent,
  ViewClient,
  ViewDestroyedEvent,
  ViewErrorContext,
  ViewErrorEvent,
  ViewEventMeta,
  ViewEvents,
  ViewOrigin,
  ViewOutputEvent,
  ViewPatchEvent,
  ViewPresetEvent,
  ViewTarget,
} from './types';
export { buildTemplateData, fileEntries, resolvePortGroups, shouldSkipPort } from './template-data';
export type { ControlSpec, FileEntry, FileList, PreparedPlugin, ScalePoint, TemplateInputs } from './template-data';
export { renderMustache, sprintf } from './vendor';
export type { MustacheRender } from './vendor';
export { namespace, rebaseUrls } from './urls';
export { StepModel } from './widgets';
export type { Off } from './emitter';
