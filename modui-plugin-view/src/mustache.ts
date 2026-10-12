// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A small Mustache renderer, enough for modgui templates and stylesheets (the classic UI uses mustache.js 0.5).
 * @module
 */

/** Renders a Mustache template with a view object. The signature of `Mustache.render`, so either can be passed in options. */
export type MustacheRender = (template: string, view: unknown) => string;

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string; escape: boolean }
  | { kind: 'section'; name: string; inverted: boolean; children: Node[] };

/** `{{{raw}}}`, or `{{name}}` with an optional sigil. A `}` right after `}}` (CSS) is not part of the tag. */
const TAG = /\{\{\{\s*([^}]*?)\s*\}\}\}|\{\{\s*([#^/!&]?)\s*([^}]*?)\s*\}\}/g;

const cache = new Map<string, Node[]>();

/** Parses a template into a tree (cached per template text). */
function parse(template: string): Node[] {
  const cached = cache.get(template);
  if (cached) {
    return cached;
  }
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [{ name: '', children: root }];
  let last = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(template); match; match = TAG.exec(template)) {
    const [whole, raw, sigil, tagName] = match;
    const triple = raw !== undefined;
    const name = triple ? raw : tagName;
    const top = stack[stack.length - 1].children;
    if (match.index > last) {
      top.push({ kind: 'text', text: template.slice(last, match.index) });
    }
    last = match.index + whole.length;
    if (triple) {
      top.push({ kind: 'var', name, escape: false });
    } else if (sigil === '!') {
      // comment
    } else if (sigil === '&') {
      top.push({ kind: 'var', name, escape: false });
    } else if (sigil === '#' || sigil === '^') {
      const section: Node = { kind: 'section', name, inverted: sigil === '^', children: [] };
      top.push(section);
      stack.push({ name, children: section.children });
    } else if (sigil === '/') {
      // An unbalanced closing tag is ignored, like a forgiving renderer would; a template is never rejected.
      if (stack.length > 1 && stack[stack.length - 1].name === name) {
        stack.pop();
      }
    } else {
      top.push({ kind: 'var', name, escape: true });
    }
  }
  if (last < template.length) {
    root.push({ kind: 'text', text: template.slice(last) });
  }
  if (cache.size > 200) {
    cache.clear();
  }
  cache.set(template, root);
  return root;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Looks a (dotted) name up in the context stack, innermost first, as the Mustache spec says. */
function lookup(stack: unknown[], name: string): unknown {
  if (name === '.') {
    return stack[stack.length - 1];
  }
  const [first, ...rest] = name.split('.');
  let value: unknown;
  let found = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const context = stack[i];
    if (context !== null && typeof context === 'object' && first in (context as object)) {
      value = (context as Record<string, unknown>)[first];
      found = true;
      break;
    }
  }
  if (!found) {
    return undefined;
  }
  for (const part of rest) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'function' ? (value as () => unknown).call(stack[stack.length - 1]) : value;
}

function isFalsy(value: unknown): boolean {
  return !value || (Array.isArray(value) && value.length === 0);
}

function renderNodes(nodes: Node[], stack: unknown[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.text;
    } else if (node.kind === 'var') {
      const value = lookup(stack, node.name);
      const text = value === undefined || value === null ? '' : String(value);
      out += node.escape ? escapeHtml(text) : text;
    } else {
      const value = lookup(stack, node.name);
      if (node.inverted) {
        if (isFalsy(value)) {
          out += renderNodes(node.children, stack);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          out += renderNodes(node.children, [...stack, item]);
        }
      } else if (!isFalsy(value)) {
        out += renderNodes(node.children, typeof value === 'object' ? [...stack, value] : stack);
      }
    }
  }
  return out;
}

/**
 * Renders `template` with `view`.
 *
 * Supported: `{{name}}` (HTML-escaped), `{{{name}}}` and `{{& name}}` (raw), `{{#name}}…{{/name}}` (a list repeats, an object becomes the
 * context, any other truthy value shows the block once), `{{^name}}…{{/name}}` (shown when false, empty or missing), `{{! comment }}`,
 * dotted names (`effect.ports.audio.input`), `{{.}}` and lookups through the outer contexts. Not supported: partials, lambdas that
 * receive the block text, and `{{=<% %>=}}`.
 *
 * @example
 * renderMustache('{{#ports}}<i>{{name}}</i>{{/ports}}', { ports: [{ name: 'In' }] });   // "<i>In</i>"
 */
export const renderMustache: MustacheRender = (template, view) => renderNodes(parse(template), [view]);
