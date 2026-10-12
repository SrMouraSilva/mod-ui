// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * {@link PluginViews}: the entry point. Creates {@link PluginView}s, and owns what they share (the modgui files, the stylesheets, the
 * output values).
 * @module
 */

import type { Plugin, PluginInfo, PluginInstance, PluginPresetInfo } from 'modui-client';
import { AssetLoader, loadImageSize } from './assets';
import { LiveBackend, PreviewBackend, type ViewBackend } from './binding';
import { Emitter, type Off } from './emitter';
import { renderMustache, type MustacheRender } from './mustache';
import { compileScript, type ScriptCallback } from './script';
import { StyleManager } from './styles';
import { buildTemplateData, type FileList } from './template-data';
import {
  PluginViewError,
  type CreateViewOptions,
  type FetchLike,
  type JQueryLike,
  type PluginViewsEvents,
  type PluginViewsOptions,
  type StyleOptions,
  type ViewClient,
  type ViewErrorContext,
  type ViewTarget,
} from './types';
import { imageUrl, namespace, rebaseUrls, renderedVersion, resourceUrl } from './urls';
import { PluginView } from './view';

const ATOM_PATH = 'http://lv2plug.in/ns/ext/atom#Path';

function isInstance(target: ViewTarget): target is PluginInstance {
  return typeof target === 'object' && target !== null && 'instance' in target && 'params' in target && 'patchParams' in target;
}

function isCatalogPlugin(target: ViewTarget): target is Plugin {
  return typeof target === 'object' && target !== null && 'summary' in target && typeof (target as Plugin).info === 'function';
}

/**
 * Creates the GUIs of plugins: `views.create(instance)` for a plugin of the running pedalboard, `views.create(plugin)` for a preview of an
 * installed plugin. Make one per client; it caches the modgui files per plugin version and adds the stylesheets to the page once.
 *
 * Needs the page to reach mod-ui with `fetch`: same origin, or a proxy (the backend sends no CORS headers for these files).
 *
 * @example
 * import { ModUiClient } from 'modui-client';
 * import { PluginViews } from 'modui-plugin-view';
 *
 * const client = new ModUiClient();
 * const views = new PluginViews(client, { jQuery: window.jQuery });   // jQuery only to run the plugins' own scripts
 *
 * for (const instance of await client.device.currentPedalboard.plugins.list()) {
 *   const view = await views.create(instance);
 *   board.append(view.icon);
 * }
 */
export class PluginViews {
  private readonly assets: AssetLoader;
  private readonly styles: StyleManager | null;
  private readonly styleOptions: StyleOptions;
  private readonly document: Document;
  private readonly mustache: MustacheRender;
  private readonly jQuery: JQueryLike | null;
  private readonly emitter = new Emitter<PluginViewsEvents>();
  private readonly views = new Set<PluginView>();
  private readonly scripts = new Map<string, Promise<ScriptCallback | null>>();
  private readonly outputs = new Map<string, Map<string, number>>();
  private readonly outputListeners = new Map<string, Set<(symbol: string, value: number) => void>>();
  private readonly warnedNoJQuery = new Set<string>();
  private readonly offs: (() => void)[] = [];
  /** Stamps the URLs of plugins that are not from the store, once per session (see `renderedVersion`). */
  private readonly stamp = Date.now();

  /**
   * @param client The `ModUiClient` of the device. The views use `client.baseUrl`, `client.device` (plugins, the running pedalboard) and
   *   `client.events` (`output_set`).
   */
  constructor(private readonly client: ViewClient, private readonly options: PluginViewsOptions = {}) {
    const fetchImpl: FetchLike | undefined = options.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new PluginViewError('No fetch implementation available; pass options.fetch');
    }
    const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
    if (!doc) {
      throw new PluginViewError('No document available; pass options.document');
    }
    this.document = doc;
    this.assets = new AssetLoader(client.baseUrl, fetchImpl);
    this.styleOptions = typeof options.styles === 'object' ? options.styles : {};
    this.styles = options.styles === false ? null : new StyleManager(doc, client.baseUrl, this.assets);
    this.mustache = options.mustache ?? renderMustache;
    const globalJQuery = (doc.defaultView as unknown as { jQuery?: JQueryLike } | null)?.jQuery;
    this.jQuery = options.jQuery === undefined ? globalJQuery ?? null : options.jQuery;

    // Output ports: the client does not model them. Listening from now on also catches the values of the state replay.
    this.offs.push(
      client.events.on('output_set', (args) => {
        const [instance, symbol, text] = args.split(' ');
        const value = parseFloat(text);
        if (!instance || !symbol || isNaN(value)) {
          return;
        }
        let values = this.outputs.get(instance);
        if (!values) {
          values = new Map();
          this.outputs.set(instance, values);
        }
        values.set(symbol, value);
        for (const listener of Array.from(this.outputListeners.get(instance) ?? [])) listener(symbol, value);
      }),
      client.events.on('remove', (args) => {
        if (args === ':all') this.outputs.clear();
        else this.outputs.delete(args.trim());
      }),
      client.events.on('loading_start', () => this.outputs.clear()),
    );
  }

  /**
   * Builds the GUI of a plugin.
   *
   * - From a `PluginInstance` (`currentPedalboard.plugins.list()` / `get()`): a **live** view, bound to that plugin of the running
   *   pedalboard. It destroys itself when the plugin leaves the pedalboard.
   * - From a `Plugin` (`device.plugins.list()`), a `PluginInfo` or a plugin URI: a **preview** with local values; nothing is sent.
   *
   * Requests (all cached per plugin version, except the volatile ones):
   * `GET /effect/get` (operationId `getPlugin`; the client's cached description), `GET /effect/file/{iconTemplate|settingsTemplate|stylesheet|javascript}`
   * (`getPluginGuiFile`; only the files the plugin has), `GET /resources/templates/pedal-default.html` and `GET /resources/settings.html`
   * (`getResource`; for a plugin without modgui), and for a live view `GET /effect/get_non_cached` (`getPluginNonCached`, the presets) and
   * `GET /files/list` (`listUserFiles`, for each path parameter).
   *
   * Problems that do not prevent the view (a modgui file that cannot be read, a script that does not compile, no jQuery for a script) are
   * reported to `views.on('error')` and the view is built without them.
   * @throws {PluginViewError} when the instance is no longer in the pedalboard, or its description is unknown.
   * @throws The client's errors (`ModUiHttpError` 404) for an unknown plugin URI.
   * @example
   * const view = await views.create(instance);
   * const preview = await views.create('http://moddevices.com/plugins/mod-devel/BigMuffPi', { values: { tone: 0.8 } });
   */
  async create(target: ViewTarget, options: CreateViewOptions = {}): Promise<PluginView> {
    const live = isInstance(target);
    let info: PluginInfo;
    if (live) {
      if (!target.alive) {
        throw new PluginViewError(`There is no plugin "${target.instance}" in the running pedalboard`);
      }
      const known = target.info ?? (await this.client.device.plugins.info(target.uri).catch(() => null));
      if (!known) {
        throw new PluginViewError(`The description of ${target.uri} is unknown (is the plugin installed?)`);
      }
      info = known;
    } else if (isCatalogPlugin(target)) {
      info = await target.info();
    } else if (typeof target === 'string') {
      info = await this.client.device.plugins.info(target);
    } else {
      info = target;
    }

    return live
      ? this.createLive(target, info, options)
      : this.build(info, new PreviewBackend(options.values, options.bypassed), !!options.bypassed, null, options);
  }

  /** URL of the plugin's thumbnail (the backend answers a default image when it has none). `GET /effect/image/thumbnail.png` (`getPluginImage`). */
  thumbnailUrl(target: string | { uri: string }): string {
    return imageUrl(this.client.baseUrl, 'thumbnail', typeof target === 'string' ? target : target.uri);
  }

  /** URL of the plugin's screenshot (the whole pedal; a default image when none). `GET /effect/image/screenshot.png` (`getPluginImage`). */
  screenshotUrl(target: string | { uri: string }): string {
    return imageUrl(this.client.baseUrl, 'screenshot', typeof target === 'string' ? target : target.uri);
  }

  /** URL of a resource of a plugin (falls back to mod-ui's shared resources). `GET /resources/{path}` (`getResource`). */
  resourceUrl(info: PluginInfo, path: string): string {
    return resourceUrl(this.client.baseUrl, path, info.uri, this.version(info));
  }

  /** The views that exist (created and not destroyed). */
  list(): PluginView[] {
    return Array.from(this.views);
  }

  /** Calls `handler` for every background error of the factory and of its views (see `ViewErrorEvent`). */
  on<K extends keyof PluginViewsEvents>(event: K, handler: (event: PluginViewsEvents[K]) => void): Off {
    return this.emitter.on(event, handler);
  }

  /** Forgets the cached modgui files and scripts (after installing a new version of a plugin, for instance). */
  clearCache(): void {
    this.assets.clear();
    this.scripts.clear();
  }

  /** Destroys every view, removes the stylesheets the library added and stops listening to the client. */
  destroy(): void {
    for (const view of Array.from(this.views)) view.destroy();
    this.styles?.clear();
    for (const off of this.offs.splice(0)) off();
    this.outputListeners.clear();
    this.emitter.clear();
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------------

  private version(info: PluginInfo): string {
    return renderedVersion(info, this.stamp);
  }

  private async createLive(instance: PluginInstance, info: PluginInfo, options: CreateViewOptions): Promise<PluginView> {
    // The view's writes carry this object as `source`, so the view does not hear back about them.
    const backend = new LiveBackend(instance, {});
    const pathParams = (info.parameters ?? []).filter((parameter) => parameter.type === ATOM_PATH && (parameter.fileTypes ?? []).length > 0);
    const [active, presets, files] = await Promise.all([
      instance.isActive(),
      backend.presets.list().catch((error) => {
        this.report(error, 'preset', info.uri);
        return info.presets ?? [];
      }),
      Promise.all(
        pathParams.map(async (parameter): Promise<[string, FileList | null]> => {
          try {
            return [parameter.uri, await this.assets.files(parameter.fileTypes!)];
          } catch (error) {
            this.report(error, 'files', info.uri);
            return [parameter.uri, null];
          }
        }),
      ),
    ]);
    if (!instance.alive) {
      throw new PluginViewError(`There is no plugin "${instance.instance}" in the running pedalboard`);
    }
    return this.build(info, backend, !active, { presets, files: new Map(files) }, options);
  }

  private async build(
    info: PluginInfo,
    backend: ViewBackend,
    bypassed: boolean,
    live: { presets: PluginPresetInfo[]; files: Map<string, FileList | null> } | null,
    options: CreateViewOptions,
  ): Promise<PluginView> {
    const version = this.version(info);
    const key = `${info.uri}|${version}`;
    const globals = this.styles?.ensureGlobals(this.styleOptions);
    const files = await this.assets.guiFiles(info, version);
    for (const { error } of files.errors) {
      this.report(error, 'files', info.uri);
    }
    const defaults = await this.assets.defaultTemplates().catch((error) => {
      this.report(error, 'files', info.uri);
      return { icon: 'Template missing', settings: 'Template missing' };
    });

    if (files.stylesheet !== null && this.styles) {
      const css = this.mustache(files.stylesheet, namespace(info.uri, version));
      this.styles.ensurePlugin(key, rebaseUrls(css, this.client.baseUrl));
    }
    // Do not hold the view for the fonts; the filmstrips measure themselves once their stylesheet applies.
    void globals;

    const script = this.scriptFor(key, info, files.javascript, options);
    const prepared = buildTemplateData({ info, version, presets: live?.presets, files: live?.files });
    const callback = await script;

    const instancePath = backend.instance?.instance ?? '';
    const view = new PluginView({
      document: this.document,
      baseUrl: this.client.baseUrl,
      info,
      version,
      prepared,
      iconTemplate: files.iconTemplate ?? defaults.icon,
      settingsTemplate: files.settingsTemplate ?? defaults.settings,
      defaultIconTemplate: defaults.icon,
      mustache: this.mustache,
      backend,
      bypassed,
      script: callback,
      jQuery: this.jQuery,
      output: (symbol) => this.outputs.get(instancePath)?.get(symbol),
      onOutput: (listener) => {
        if (!instancePath) {
          return () => undefined;
        }
        let set = this.outputListeners.get(instancePath);
        if (!set) {
          set = new Set();
          this.outputListeners.set(instancePath, set);
        }
        set.add(listener);
        return () => set!.delete(listener);
      },
      imageSize: (url) => loadImageSize(this.document, url),
      promptName: async (title, current) => {
        if (this.options.promptName) {
          return (await this.options.promptName(title, current)) ?? null;
        }
        const view = this.document.defaultView;
        return view && typeof view.prompt === 'function' ? view.prompt(title, current) : null;
      },
      reportError: (error, context) => this.emitter.emit('error', { error, context, uri: info.uri }),
      onDestroy: (gone) => this.views.delete(gone),
    });
    this.views.add(view);
    return view;
  }

  /** The compiled plugin script for this version, or `null` (none, disabled, no jQuery, does not compile). */
  private scriptFor(key: string, info: PluginInfo, code: string | null, options: CreateViewOptions): Promise<ScriptCallback | null> {
    const enabled = options.scripts ?? this.options.scripts ?? true;
    if (code === null || !enabled) {
      return Promise.resolve(null);
    }
    if (!this.jQuery) {
      if (!this.warnedNoJQuery.has(info.uri)) {
        this.warnedNoJQuery.add(info.uri);
        this.report(new PluginViewError(`${info.uri} has a modgui javascript, which needs jQuery (options.jQuery); it is not run`), 'script', info.uri);
      }
      return Promise.resolve(null);
    }
    let compiled = this.scripts.get(key);
    if (!compiled) {
      compiled = Promise.resolve().then(() => {
        try {
          return compileScript(code);
        } catch (error) {
          this.report(error, 'script', info.uri);
          return null;
        }
      });
      this.scripts.set(key, compiled);
    }
    return compiled;
  }

  private report(error: unknown, context: ViewErrorContext, uri: string): void {
    this.emitter.emit('error', { error, context, uri });
  }
}
