// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The files of a plugin's GUI (modgui): {@link PluginGui} (`plugin.gui`).
 * @module
 */

import type { HttpTransport } from './http';
import type { PluginInfo, PluginSummary } from './types';

/** A text file of the modgui that the plugin may declare (`info.gui`). */
export type GuiFile = 'iconTemplate' | 'settingsTemplate' | 'stylesheet' | 'javascript';

/** The files {@link PluginGui.getAll} reads, in this order. */
export const GUI_FILES: readonly GuiFile[] = ['iconTemplate', 'settingsTemplate', 'stylesheet', 'javascript'];

/** The text files of a plugin's modgui. A file is `null` when the plugin does not have it, or when it failed to load (see `errors`). */
export interface GuiFiles {
  iconTemplate: string | null;
  settingsTemplate: string | null;
  stylesheet: string | null;
  javascript: string | null;
  /** Files the plugin declares but that could not be read. */
  errors: { file: GuiFile; error: unknown }[];
}

/** The templates mod-ui itself uses for a plugin without a modgui (see {@link PluginsApi.getDefaultTemplates}). */
export interface DefaultGuiTemplates {
  iconTemplate: string;
  settingsTemplate: string;
}

/** The fields of a plugin description that make its version. */
type VersionFields = Pick<PluginSummary, 'uri' | 'builder' | 'microVersion' | 'minorVersion' | 'release' | 'buildEnvironment'>;

/**
 * @internal What every {@link PluginGui} shares (owned by `PluginsApi`): the transport, the cache of the text files and the stamp that
 * makes the URLs of plugins in development unique to this session.
 */
export class GuiAssets {
  private readonly texts = new Map<string, Promise<string>>();
  /** Stamps the version of the plugins that are not from the store, once per client (see {@link PluginGui.version}). */
  readonly stamp = Date.now();

  constructor(
    private readonly http: HttpTransport,
    /** The cached description of a plugin (`GET /effect/get`). */
    readonly info: (uri: string) => Promise<PluginInfo>,
  ) {}

  /** `GET path` as text (`path` already carries its query string), cached. A failed request is not cached. */
  text(path: string): Promise<string> {
    let pending = this.texts.get(path);
    if (!pending) {
      pending = this.http.getText(path);
      pending.catch(() => this.texts.delete(path));
      this.texts.set(path, pending);
    }
    return pending;
  }

  /** `baseUrl` + `path`, where `path` already carries its query string. */
  url(path: string): string {
    return this.http.url(path);
  }

  clear(): void {
    this.texts.clear();
  }
}

/** `escape()` of the URI, as the classic UI builds its URLs (kept so both pages share the browser cache). */
function escapeUri(uri: string): string {
  return escape(uri);
}

/**
 * The GUI files of one plugin (`plugin.gui`): URLs for an `<img>` or a `<link>`, and the text of the modgui templates, stylesheet and
 * script. It does not render anything: Mustache, the widgets and the plugin script belong to `modui-plugin-view`.
 *
 * Every URL carries the plugin's {@link PluginGui.version}, exactly like the classic UI's, so the browser keeps the files until the plugin
 * is updated (and the classic page and your page share them).
 *
 * @example
 * const plugin = await client.device.plugins.get('http://moddevices.com/plugins/mod-devel/BigMuffPi');
 * img.src = plugin.gui.getThumbnailUrl();
 * const { iconTemplate, stylesheet } = await plugin.gui.getAll();
 */
export class PluginGui {
  /** URI of the plugin. */
  readonly uri: string;
  /**
   * The version that goes in every URL (`v=…`) and in the `ns` / `cns` of the templates: `builder_micro_minor_release`, plus `_<time>` for
   * a plugin that does not come from the store (no `buildEnvironment`: it is being developed, so the browser must not keep an old copy).
   * The time is taken when the client is created.
   */
  readonly version: string;

  /** @internal Use `plugin.gui`. */
  constructor(plugin: VersionFields, private readonly assets: GuiAssets) {
    this.uri = plugin.uri;
    const version = [plugin.builder, plugin.microVersion, plugin.minorVersion, plugin.release].join('_');
    this.version = plugin.buildEnvironment ? version : `${version}_${assets.stamp}`;
  }

  /**
   * URL of a file of the modgui. No request is made.
   *
   * Backend: `GET /effect/file/{prop}?uri=…&v=…` (operationId `getPluginGuiFile`).
   * @example
   * link.href = plugin.gui.getFileUrl('stylesheet');
   */
  getFileUrl(file: GuiFile | 'documentation'): string {
    return this.assets.url(this.filePath(file));
  }

  /**
   * URL of any file below the plugin's modgui resources directory (what the plugin script gets from `get_custom_resource_filename`).
   * No request is made.
   *
   * Backend: `GET /effect/file/custom?filename=…&uri=…&v=…` (operationId `getPluginGuiFile`, `prop = custom`).
   * @example
   * const url = plugin.gui.getCustomFileUrl('img/logo.png');
   */
  getCustomFileUrl(filename: string): string {
    return this.assets.url(`/effect/file/custom?filename=${encodeURIComponent(filename)}&uri=${escapeUri(this.uri)}&v=${this.version}`);
  }

  /**
   * URL of a resource of the plugin, which falls back to the shared resources of mod-ui when the plugin has none by that name. No request is
   * made.
   *
   * Backend: `GET /resources/{path}?uri=…&v=…` (operationId `getResource`).
   * @example
   * img.src = plugin.gui.getResourceUrl('knobs/black.png');
   */
  getResourceUrl(path: string): string {
    return this.assets.url(`/resources/${path.replace(/^\/+/, '')}?uri=${escapeUri(this.uri)}&v=${this.version}`);
  }

  /**
   * URL of the thumbnail (small image of the pedal). No request is made. The backend answers a default image when the plugin has none.
   *
   * Backend: `GET /effect/image/thumbnail.png?uri=…&v=…` (operationId `getPluginImage`).
   * @example
   * img.src = plugin.gui.getThumbnailUrl();
   */
  getThumbnailUrl(): string {
    return this.imageUrl('thumbnail');
  }

  /**
   * URL of the screenshot (the whole pedal). No request is made. The backend answers a default image when the plugin has none.
   *
   * Backend: `GET /effect/image/screenshot.png?uri=…&v=…` (operationId `getPluginImage`).
   */
  getScreenshotUrl(): string {
    return this.imageUrl('screenshot');
  }

  /**
   * Reads one text file of the modgui. The answer is cached per plugin version.
   *
   * The plugin description (`GET /effect/get`, cached) says which files the plugin has; a file it does not declare is not requested.
   *
   * Backend: `GET /effect/get?uri=…` (operationId `getPlugin`) and `GET /effect/file/{prop}` (operationId `getPluginGuiFile`).
   * @returns The text, or `null` when the plugin does not have that file.
   * @throws {ModUiHttpError} when the plugin is not installed (`404`) or the file cannot be read.
   * @example
   * const css = await plugin.gui.get('stylesheet');
   */
  async get(file: GuiFile): Promise<string | null> {
    const info = await this.assets.info(this.uri);
    if (!info.gui?.[file]) {
      return null;
    }
    return this.assets.text(this.filePath(file));
  }

  /**
   * Reads the four text files of the modgui at once (in parallel). Never throws for a file: one that fails is `null` and listed in `errors`,
   * because a missing stylesheet or script should not stop a UI from showing the plugin.
   *
   * Backend: as {@link PluginGui.get}.
   * @throws {ModUiHttpError} only when the plugin description cannot be read (`404`: not installed).
   * @example
   * const { iconTemplate, settingsTemplate, stylesheet, javascript, errors } = await plugin.gui.getAll();
   * if (iconTemplate === null) useDefaultTemplates();
   */
  async getAll(): Promise<GuiFiles> {
    const result: GuiFiles = { iconTemplate: null, settingsTemplate: null, stylesheet: null, javascript: null, errors: [] };
    await this.assets.info(this.uri);
    await Promise.all(
      GUI_FILES.map(async (file) => {
        try {
          result[file] = await this.get(file);
        } catch (error) {
          result.errors.push({ file, error });
        }
      }),
    );
    return result;
  }

  private filePath(file: GuiFile | 'documentation'): string {
    return `/effect/file/${file}?uri=${escapeUri(this.uri)}&v=${this.version}`;
  }

  private imageUrl(kind: 'thumbnail' | 'screenshot'): string {
    return this.assets.url(`/effect/image/${kind}.png?uri=${encodeURIComponent(this.uri)}&v=${this.version}`);
  }
}
