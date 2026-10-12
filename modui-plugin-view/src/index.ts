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
 * | `assets.ts`, `styles.ts` | internal: modgui files and stylesheets |
 * | `script.ts` | internal: the plugins' own JavaScript (`api_version` 3) |
 * | `urls.ts` | URL helpers, `ns` / `cns`, URL rebasing |
 * | `mustache.ts`, `sprintf.ts` | the small template and number-format engines |
 *
 * The build (`npm run build`) is an IIFE that sets `window.ModUiPluginView`; bundlers import `src/index.ts`.
 * @module
 */

import { renderMustache } from './mustache';
import { sprintf } from './sprintf';
import { buildTemplateData } from './template-data';
import { PluginViewError } from './types';
import { customFileUrl, guiFileUrl, imageUrl, namespace, rebaseUrls, renderedVersion, resourceUrl } from './urls';
import { PluginView } from './view';
import { PluginViews } from './views';

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
export { renderMustache } from './mustache';
export type { MustacheRender } from './mustache';
export { sprintf } from './sprintf';
export { customFileUrl, guiFileUrl, imageUrl, namespace, rebaseUrls, renderedVersion, resourceUrl } from './urls';
export type { GuiFile } from './urls';
export { StepModel } from './widgets';
export type { Off } from './emitter';

// Browser global: the build is an IIFE loaded with a <script> tag, after modui-client.js.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).ModUiPluginView = {
    PluginViews,
    PluginView,
    PluginViewError,
    buildTemplateData,
    renderMustache,
    sprintf,
    urls: { customFileUrl, guiFileUrl, imageUrl, namespace, rebaseUrls, renderedVersion, resourceUrl },
  };
}
