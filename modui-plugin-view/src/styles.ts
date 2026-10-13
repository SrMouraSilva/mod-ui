// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stylesheets in the document (internal): the global ones of mod-ui, and one `<style>` per plugin.
 * @module
 */

import type { StyleOptions } from './types';

/** Marks every element the library adds to `<head>`. */
const MARK = 'data-modui-plugin-view';

/** `@font-face { … }` blocks (they hold no nested braces). */
const FONT_FACE = /@font-face\s*\{[^}]*\}/g;
/**
 * What the classic page gives every modgui besides `pedals.css`: Bootstrap's `* { box-sizing: border-box }` (in `css/main.css`), which
 * many pedals are laid out with. Scoped to the library's elements, with no specificity (`:where`), so neither the host page nor the
 * plugin's own rules are affected.
 */
export const BASE_CSS =
  ':where(.mod-pedal, .mod-settings), :where(.mod-pedal, .mod-settings) *, :where(.mod-pedal, .mod-settings) *::before, ' +
  ':where(.mod-pedal, .mod-settings) *::after { box-sizing: border-box; }';

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Makes the relative `url(…)` of a stylesheet absolute against the stylesheet's own URL. */
export function absolutizeCssUrls(css: string, sheetUrl: string): string {
  return css.replace(CSS_URL, (match, quote: string, url: string) => {
    if (/^(data:|[a-z]+:\/\/|\/\/|#)/i.test(url)) {
      return match;
    }
    try {
      return `url(${quote}${new URL(url, sheetUrl).href}${quote})`;
    } catch {
      return match;
    }
  });
}

/** Owns the `<link>` / `<style>` elements the library adds to one document. */
export class StyleManager {
  private readonly elements: HTMLElement[] = [];
  private readonly plugins = new Map<string, HTMLStyleElement>();
  private globals: Promise<void> | null = null;

  /** @param text Reads a text file of the classic page (`css/main.css`), by URL. */
  constructor(private readonly document: Document, private readonly baseUrl: string, private readonly text: (url: string) => Promise<string>) {}

  /**
   * Adds the global stylesheets once: `<link>`s to `css/pedals.css`, `resources/pedals/default.css`, `css/fonts.css` and the extra
   * ones, a `<style>` with {@link BASE_CSS}, and a `<style>` with the `@font-face` rules of `css/main.css`. Never fails: a stylesheet that cannot be read only looks worse.
   */
  ensureGlobals(options: StyleOptions): Promise<void> {
    if (!this.globals) {
      const links: string[] = [];
      if (options.base !== false) {
        links.push('/css/pedals.css', '/resources/pedals/default.css');
      }
      if (options.fonts !== false) {
        links.push('/css/fonts.css');
      }
      links.push(...(options.extra ?? []));
      if (options.base !== false) {
        this.append(this.style(BASE_CSS, 'base'));
      }
      for (const href of links) {
        const link = this.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href.startsWith('/') ? this.baseUrl + href : href;
        link.setAttribute(MARK, 'global');
        this.append(link);
      }
      this.globals =
        options.fonts === false
          ? Promise.resolve()
          : this.text(`${this.baseUrl}/css/main.css`).then(
              (css) => {
                const faces = css.match(FONT_FACE);
                if (faces) {
                  this.append(this.style(absolutizeCssUrls(faces.join('\n'), `${this.baseUrl}/css/main.css`), 'fonts'));
                }
              },
              () => undefined,
            );
    }
    return this.globals;
  }

  /** Adds the rendered stylesheet of a plugin once per key (plugin URI + version). */
  ensurePlugin(key: string, css: string): void {
    if (!this.plugins.has(key)) {
      const style = this.style(css, key);
      this.plugins.set(key, style);
      this.append(style);
    }
  }

  /** Removes everything the manager added. */
  clear(): void {
    for (const element of this.elements.splice(0)) {
      element.remove();
    }
    this.plugins.clear();
    this.globals = null;
  }

  private style(css: string, mark: string): HTMLStyleElement {
    const style = this.document.createElement('style');
    style.setAttribute(MARK, mark);
    style.textContent = css;
    return style;
  }

  private append(element: HTMLElement): void {
    (this.document.head ?? this.document.documentElement).appendChild(element);
    this.elements.push(element);
  }
}
