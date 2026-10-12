// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * URLs of a plugin's modgui files and the `ns` / `cns` values of its templates, built exactly like `html/js/modgui.js` does.
 * @module
 */

import type { PluginInfo } from 'modui-client';

/** The fields of a plugin description that make its version. */
export type VersionFields = Pick<PluginInfo, 'uri' | 'builder' | 'microVersion' | 'minorVersion' | 'release' | 'buildEnvironment'>;

/**
 * The version string the classic UI puts in its URLs (`renderedVersion`): `builder_micro_minor_release`. For a plugin that does not
 * come from the store (no `buildEnvironment`) the classic UI adds the time, so a plugin being developed is never served from the
 * browser cache; pass `now` to do the same.
 *
 * @example
 * renderedVersion(info);               // "0_1_2_0"
 * renderedVersion(info, Date.now());   // "0_1_2_0_1760000000000" when info.buildEnvironment is ""
 */
export function renderedVersion(info: VersionFields, now?: number): string {
  const version = [info.builder, info.microVersion, info.minorVersion, info.release].join('_');
  return !info.buildEnvironment && now !== undefined ? `${version}_${now}` : version;
}

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
 * const { ns, cns } = namespace('http://example.org/plugins/fuzz', '0_1_0_0');
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

/** A text file of the modgui: `GET /effect/file/{prop}` (operationId `getPluginGuiFile`). */
export type GuiFile = 'iconTemplate' | 'settingsTemplate' | 'stylesheet' | 'javascript';

/** `baseUrl/effect/file/{prop}?uri=…&v=…` (operationId `getPluginGuiFile`). */
export function guiFileUrl(baseUrl: string, prop: GuiFile | 'documentation', uri: string, version: string): string {
  return `${baseUrl}/effect/file/${prop}?uri=${escapeUri(uri)}&v=${version}`;
}

/**
 * Any file below the plugin's modgui resources directory: `baseUrl/effect/file/custom?filename=…&uri=…&v=…` (operationId
 * `getPluginGuiFile`, `prop = custom`). What the plugin script gets from `get_custom_resource_filename`, made absolute.
 */
export function customFileUrl(baseUrl: string, filename: string, uri: string, version: string): string {
  return `${baseUrl}/effect/file/custom?filename=${encodeURIComponent(filename)}&uri=${escapeUri(uri)}&v=${version}`;
}

/**
 * A resource of the plugin, falling back to the shared `html/resources` of mod-ui: `baseUrl/resources/{path}?uri=…&v=…` (operationId
 * `getResource`). Without `uri`, only the shared resources.
 */
export function resourceUrl(baseUrl: string, path: string, uri?: string, version?: string): string {
  const clean = path.replace(/^\/+/, '');
  return uri ? `${baseUrl}/resources/${clean}?uri=${escapeUri(uri)}&v=${version ?? ''}` : `${baseUrl}/resources/${clean}`;
}

/** `baseUrl/effect/image/{thumbnail|screenshot}.png?uri=…` (operationId `getPluginImage`); the backend answers a default image when none. */
export function imageUrl(baseUrl: string, kind: 'thumbnail' | 'screenshot', uri: string, version?: string): string {
  return `${baseUrl}/effect/image/${kind}.png?uri=${encodeURIComponent(uri)}${version ? `&v=${version}` : ''}`;
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
