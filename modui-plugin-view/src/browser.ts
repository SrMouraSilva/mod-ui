// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Entry of the browser-global build (`<script src="modui-plugin-view.js">`, after `modui-client.js`): sets `window.ModUiPluginView`.
 * Bundlers and Node import `index.ts` instead, which has no side effect.
 * @module
 */

import { buildTemplateData, namespace, PluginView, PluginViewError, PluginViews, rebaseUrls, renderMustache, sprintf } from './index';

(window as unknown as Record<string, unknown>).ModUiPluginView = {
  PluginViews,
  PluginView,
  PluginViewError,
  buildTemplateData,
  renderMustache,
  sprintf,
  urls: { namespace, rebaseUrls },
};
