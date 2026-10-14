// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The template and number-format engines of the classic UI, used as they are: `html/js/lib/mustache.js` (mustache.js 0.5) and
 * `html/js/lib/sprintf-0.6.js`. They are imported from the repository (`modui-vendor/…` is an alias for them, see `vendor-plugins.mjs`, which also gives each
 * file the `export default` it lacks) and inlined by the build, so there is one copy of each in version control, the published package has no dependency and no path
 * into `html/`, and a plugin's templates and unit formats render exactly as in mod-ui.
 * @module
 */

import Mustache from 'modui-vendor/mustache';
import sprintfScript from 'modui-vendor/sprintf';

/** Renders a Mustache template with a view object. The signature of `Mustache.render`, so either can be passed in options. */
export type MustacheRender = (template: string, view: unknown) => string;

/**
 * Renders `template` with `view` using mustache.js 0.5, the version mod-ui ships: `{{name}}` (HTML-escaped, `/` included),
 * `{{{name}}}` and `{{& name}}` (raw), sections, inverted sections, dotted names, comments, partials and `{{=<% %>=}}`.
 *
 * @example
 * renderMustache('{{#ports}}<i>{{name}}</i>{{/ports}}', { ports: [{ name: 'In' }] });   // "<i>In</i>"
 */
export const renderMustache: MustacheRender = (template, view) => Mustache.render(template, view);

/**
 * `sprintf()` of the classic UI (sprintf-0.6.js), for the value formats of LV2 units (`%.1f dB`, `%d %%`, `%s`). Like the original,
 * `%d` truncates (`42.6` gives `42`). The original throws when a numeric conversion gets a non-number; this wrapper returns the value
 * as text instead, so a bad value shows up in a label and does not stop the widget.
 *
 * @example
 * sprintf('%.1f dB', -3.04);   // "-3.0 dB"
 * sprintf('%d %%', 42.6);      // "42 %"
 */
export function sprintf(format: string, ...values: unknown[]): string {
  try {
    return sprintfScript(format, ...values);
  } catch {
    return values.length > 0 ? String(values[0]) : format;
  }
}
