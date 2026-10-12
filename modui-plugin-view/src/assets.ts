// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Loads (and caches) the files of a plugin's modgui and the shared files of mod-ui (internal).
 * @module
 */

import type { PluginInfo } from 'modui-client';
import type { FetchLike } from './types';
import { PluginViewError } from './types';
import type { FileList } from './template-data';
import { guiFileUrl, resourceUrl, type GuiFile } from './urls';

/** The text files of a plugin's modgui. `null` when the plugin has none of that kind (or it failed to load: see `errors`). */
export interface GuiFiles {
  iconTemplate: string | null;
  settingsTemplate: string | null;
  stylesheet: string | null;
  javascript: string | null;
  /** Files the plugin declares but that could not be read. */
  errors: { file: GuiFile; error: unknown }[];
}

/** Error of a request made by the library. */
export class AssetError extends PluginViewError {
  constructor(readonly url: string, readonly status: number) {
    super(`GET ${url} answered ${status}`);
    this.name = 'AssetError';
  }
}

const FILES: GuiFile[] = ['iconTemplate', 'settingsTemplate', 'stylesheet', 'javascript'];

/** Fetches text files once per URL. */
export class AssetLoader {
  private readonly texts = new Map<string, Promise<string>>();

  constructor(private readonly baseUrl: string, private readonly fetchImpl: FetchLike) {}

  /** `GET url` as text, cached (the modgui URLs carry the plugin version). A failed request is not cached. */
  text(url: string): Promise<string> {
    let pending = this.texts.get(url);
    if (!pending) {
      pending = this.fetchImpl(url).then(async (response) => {
        if (!response.ok) {
          throw new AssetError(url, response.status);
        }
        return response.text();
      });
      pending.catch(() => this.texts.delete(url));
      this.texts.set(url, pending);
    }
    return pending;
  }

  /** `GET url` as JSON, never cached. */
  async json<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new AssetError(url, response.status);
    }
    return (await response.json()) as T;
  }

  /**
   * The text files the plugin declares in `info.gui`, in parallel: `GET /effect/file/{iconTemplate|settingsTemplate|stylesheet|javascript}`
   * (operationId `getPluginGuiFile`). A file that fails to load is reported in `errors` and treated as missing.
   */
  async guiFiles(info: PluginInfo, version: string): Promise<GuiFiles> {
    const gui = (info.gui ?? {}) as Record<string, unknown>;
    const result: GuiFiles = { iconTemplate: null, settingsTemplate: null, stylesheet: null, javascript: null, errors: [] };
    await Promise.all(
      FILES.map(async (file) => {
        if (!gui[file]) {
          return;
        }
        try {
          result[file] = await this.text(guiFileUrl(this.baseUrl, file, info.uri, version));
        } catch (error) {
          result.errors.push({ file, error });
        }
      }),
    );
    return result;
  }

  /**
   * The templates the classic UI uses for a plugin without modgui: `GET /resources/templates/pedal-default.html` and
   * `GET /resources/settings.html` (operationId `getResource`, shared resources).
   */
  async defaultTemplates(): Promise<{ icon: string; settings: string }> {
    const [icon, settings] = await Promise.all([
      this.text(resourceUrl(this.baseUrl, 'templates/pedal-default.html')),
      this.text(resourceUrl(this.baseUrl, 'settings.html')),
    ]);
    return { icon, settings };
  }

  /** `GET /files/list?types=…` (operationId `listUserFiles`): the user files a path parameter accepts. */
  files(types: string[]): Promise<FileList> {
    return this.json<FileList>(`${this.baseUrl}/files/list?types=${encodeURIComponent(types.join(','))}`);
  }

  clear(): void {
    this.texts.clear();
  }
}

/** Loads an image and resolves with its natural size. */
export function loadImageSize(document: Document, url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const view = document.defaultView;
    if (!view || typeof view.Image !== 'function') {
      reject(new PluginViewError('No Image constructor'));
      return;
    }
    const image = new view.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new PluginViewError(`Cannot load ${url}`));
    image.src = url;
  });
}
