// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The installed plugins: {@link PluginsApi} (`client.device.plugins`) and {@link Plugin}.
 * @module
 */

import { ModUiError } from './errors';
import type { HttpTransport } from './http';
import { GuiAssets, PluginGui, type DefaultGuiTemplates } from './plugin-gui';
import { PresetCatalog } from './plugin-presets';
import type { PluginInfo, PluginSummary } from './types';

/**
 * An installed LV2 plugin, as listed by {@link PluginsApi.list}. Lightweight: call {@link Plugin.info} for the
 * ports and the rest of the description, or pass it to `device.currentPedalboard.plugins.add()`.
 */
export class Plugin {
  readonly uri: string;
  readonly name: string;
  readonly brand: string;
  readonly label: string;
  readonly category: string[];
  /**
   * The files of the plugin's GUI: URLs for the thumbnail, the screenshot and the modgui files, and their text. Built from the summary, so
   * it is available at once (no request).
   */
  readonly gui: PluginGui;

  /** @internal Use {@link PluginsApi.list} or {@link PluginsApi.get}. */
  constructor(readonly summary: PluginSummary, private readonly api: PluginsApi) {
    this.uri = summary.uri;
    this.name = summary.name;
    this.brand = summary.brand;
    this.label = summary.label;
    this.category = summary.category;
    this.gui = api.guiOf(summary);
  }

  /**
   * Reads the full description (ports, parameters, presets, ...). The answer is cached by the client.
   *
   * Backend: `GET /effect/get?uri=…` (operationId `getPlugin`).
   * @throws {ModUiHttpError} `404` when the plugin is not installed.
   * @example
   * const info = await plugin.info();
   * console.log(info.ports.audio?.input?.map((port) => port.symbol));
   */
  info(): Promise<PluginInfo> {
    return this.api.info(this.uri);
  }
}

/**
 * The plugins installed on the device (`client.device.plugins`).
 *
 * @example
 * const plugins = await client.device.plugins.list();
 * const gain = plugins.find((plugin) => plugin.label === 'Gain');
 */
export class PluginsApi {
  private readonly infos = new Map<string, PluginInfo>();
  /** Descriptions that are about to arrive from another request (a plugin being added), by URI. */
  private readonly arriving = new Map<string, Promise<void>>();
  /** The presets of each plugin, shared by its instances. */
  private readonly catalogs = new Map<string, PresetCatalog>();
  /** The GUI files (cached text) and the version stamp, shared by every {@link PluginGui}. */
  private readonly guiAssets: GuiAssets;

  /** @internal Use `client.device.plugins`. */
  constructor(private readonly http: HttpTransport) {
    this.guiAssets = new GuiAssets(http, (uri) => this.info(uri));
  }

  /**
   * Lists every installed plugin (summaries only).
   *
   * Backend: `GET /effect/list` (operationId `listPlugins`). The first call makes the server scan the LV2 plugins.
   * @example
   * const plugins = await client.device.plugins.list();
   * console.log(plugins.length, 'plugins installed');
   */
  async list(): Promise<Plugin[]> {
    const summaries = await this.http.getJson<PluginSummary[]>('/effect/list');
    return summaries.map((summary) => new Plugin(summary, this));
  }

  /**
   * The plugin with this URI, for when you have the URI of a plugin (a pedalboard's plugin, a saved setting) and not the {@link Plugin}
   * from {@link PluginsApi.list}. Pass a summary or a description you already have to get the {@link Plugin} without a request (a full
   * description is also remembered, so `plugin.info()` and `plugin.gui` do not ask for it again).
   *
   * Backend: `GET /effect/get?uri=…` (operationId `getPlugin`, cached) when given a URI.
   * @throws {ModUiHttpError} `404` when the plugin is not installed.
   * @example
   * const plugin = await client.device.plugins.get('http://moddevices.com/plugins/mod-devel/BigMuffPi');
   * img.src = plugin.gui.getThumbnailUrl();
   */
  async get(plugin: string | PluginSummary | PluginInfo): Promise<Plugin> {
    if (typeof plugin === 'string') {
      return new Plugin(await this.info(plugin), this);
    }
    if ('ports' in plugin && !this.infos.has(plugin.uri)) {
      this.remember(plugin as PluginInfo);
    }
    return new Plugin(plugin, this);
  }

  /**
   * The templates mod-ui draws a plugin with when it has no modgui (an icon like a generic pedal, and a settings panel). Cached.
   *
   * Backend: `GET /resources/templates/pedal-default.html` and `GET /resources/settings.html` (operationId `getResource`).
   * @example
   * const files = await plugin.gui.getAll();
   * const icon = files.iconTemplate ?? (await client.device.plugins.getDefaultTemplates()).iconTemplate;
   */
  async getDefaultTemplates(): Promise<DefaultGuiTemplates> {
    const [iconTemplate, settingsTemplate] = await Promise.all([
      this.guiAssets.text('/resources/templates/pedal-default.html'),
      this.guiAssets.text('/resources/settings.html'),
    ]);
    return { iconTemplate, settingsTemplate };
  }

  /** Forgets the cached text of the GUI files, e.g. after installing a new version of a plugin. URLs already handed out stay valid. */
  clearGuiCache(): void {
    this.guiAssets.clear();
  }

  /** @internal The GUI of a plugin, for {@link Plugin.gui}. */
  guiOf(summary: PluginSummary): PluginGui {
    return new PluginGui(summary, this.guiAssets);
  }

  /** @internal Full description of one plugin, cached. */
  async info(uri: string): Promise<PluginInfo> {
    const cached = this.infos.get(uri);
    if (cached) {
      return cached;
    }
    const info = await this.http.getJson<PluginInfo>('/effect/get', { uri });
    this.infos.set(uri, info);
    return info;
  }

  /** @internal Remembers a description the backend already returned (e.g. by `GET /effect/add/…`). */
  remember(info: PluginInfo): void {
    this.infos.set(info.uri, info);
  }

  /**
   * @internal Descriptions of several plugins with one request. Unknown plugins are missing from the result
   * (the backend skips them).
   *
   * Backend: `POST /effect/bulk/` (operationId `getPluginsBulk`).
   */
  async infosOf(uris: string[]): Promise<Map<string, PluginInfo>> {
    const arrivals = uris.filter((uri) => !this.infos.has(uri)).map((uri) => this.arriving.get(uri));
    await Promise.all(arrivals);
    const missing = uris.filter((uri, index) => !this.infos.has(uri) && uris.indexOf(uri) === index);
    if (missing.length > 0) {
      const found = await this.http.postJson<Record<string, PluginInfo>>('/effect/bulk/', missing);
      if (!found || typeof found !== 'object') {
        throw new ModUiError('Unexpected answer of POST /effect/bulk/');
      }
      for (const uri of Object.keys(found)) {
        this.infos.set(uri, found[uri]);
      }
    }
    const result = new Map<string, PluginInfo>();
    for (const uri of uris) {
      const info = this.infos.get(uri);
      if (info) {
        result.set(uri, info);
      }
    }
    return result;
  }

  /**
   * @internal The presets of a plugin, shared by all its instances. Whenever the list is replaced the cached description is updated in
   * place (`info.presets`), so code that reads it sees the list the client last knew.
   */
  presetCatalog(uri: string): PresetCatalog {
    let catalog = this.catalogs.get(uri);
    if (!catalog) {
      catalog = new PresetCatalog((presets) => {
        const info = this.infos.get(uri);
        if (info) {
          info.presets = presets;
        }
      });
      this.catalogs.set(uri, catalog);
    }
    return catalog;
  }

  /** The description of a plugin when it is already known, without a request. */
  peek(uri: string): PluginInfo | undefined {
    return this.infos.get(uri);
  }

  /**
   * Announces that the description of `uri` is about to arrive from another request (`GET /effect/add/...` returns it), so
   * that {@link PluginsApi.infosOf} waits for it instead of asking the backend again. Call `done()` when the request ended,
   * after {@link PluginsApi.remember} when it succeeded.
   * @internal
   */
  expect(uri: string): { done(): void } {
    let finish!: () => void;
    const arrival = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.arriving.set(uri, arrival);
    return {
      done: () => {
        if (this.arriving.get(uri) === arrival) {
          this.arriving.delete(uri);
        }
        finish();
      },
    };
  }
}
