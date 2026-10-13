// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `ns` / `cns` values of a plugin's templates, and the rebasing of root-relative URLs, built exactly like `html/js/modgui.js` does.
 * The URLs of the plugin's files belong to `modui-client` (`plugin.gui`).
 * @module
 */

/** `escape()` of the URI, as the classic UI builds its URLs (kept for identical `ns` / `cns` values). */
export function escapeUri(uri: string): string {
  return escape(uri);
}

/**
 * The two values every modgui template and stylesheet receives:
 * - `ns`: the query string that makes `/resources/…` URLs point to the plugin's own files (`?uri=…&v=…`).
 * - `cns`: a CSS class suffix unique to the plugin and its version, so two plugins can use the same class names.
 *
 * @example
 * const { ns, cns } = namespace('http://example.org/plugins/fuzz', plugin.gui.version);
 * // ns  = "?uri=http%3A//example.org/plugins/fuzz&v=0_1_0_0"
 * // cns = "_http_3A__example_org_plugins_fuzz0_1_0_0"
 */
export function namespace(uri: string, version: string): { ns: string; cns: string } {
  const escaped = escapeUri(uri);
  return {
    ns: `?uri=${escaped}&v=${version}`,
    cns: '_' + escaped.split('/').join('_').split('%').join('_').split('.').join('_') + version,
  };
}

const ROOT_RELATIVE = /(\b(?:src|href)\s*=\s*["']?|url\(\s*["']?)\/(?!\/)/gi;

/**
 * Makes the root-relative URLs of a rendered template or stylesheet (`src="/resources/…"`, `href="/…"`, `url(/resources/…)`) absolute on
 * `baseUrl`, so they reach mod-ui when the page is served from somewhere else. Absolute, protocol-relative (`//host`) and relative URLs
 * are left as they are.
 *
 * @example
 * rebaseUrls('<img src="/resources/knob.png?uri=x">', 'http://modduo.local');
 * // '<img src="http://modduo.local/resources/knob.png?uri=x">'
 */
export function rebaseUrls(text: string, baseUrl: string): string {
  return baseUrl ? text.replace(ROOT_RELATIVE, (_match, prefix: string) => `${prefix}${baseUrl}/`) : text;
}
