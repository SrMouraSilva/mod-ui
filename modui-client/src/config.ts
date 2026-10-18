// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The preferences stored on the device: {@link ConfigApi} (`client.config`), split in what is mod-ui's ({@link ModConfig},
 * `client.config.mod`) and what belongs to the application built on this client ({@link AppConfig}, `client.config.app`).
 * @module
 */

import { ModUiConfigTooLargeError, ModUiError } from './errors';
import type { HttpTransport } from './http';

/**
 * The preferences that **mod-ui itself** reads and writes (the values are the names it uses on the wire).
 *
 * Only these can be read or written through {@link ModConfig}. The others in the preferences file (the settings that the hardware keeps
 * for itself, the API keys) are not exposed.
 */
export enum ModConfigKey {
  /** Developer mode of the UI. */
  DevMode = 'dev-mode',
  /** The plugin list of the UI is folded. */
  PluginsFolded = 'plugins-folded',
  /** The plugin list also shows plugins from the labs. */
  ShowLabsPlugins = 'show-labs-plugins',
  /** How the pedalboard library is shown. */
  PedalboardsViewMode = 'pb-view-mode',
  /** The user accepted the terms of the cloud. */
  CloudTermsAccepted = 'cloud-terms-accepted',
  /** Which releases the device updates to. */
  UpdateChannel = 'update-channel',
}

/** The values each {@link ModConfigKey} takes. mod-ui stores them as text. */
const MOD_CONFIG_VALUES = {
  [ModConfigKey.DevMode]: ['on', 'off'],
  [ModConfigKey.PluginsFolded]: ['true', 'false'],
  [ModConfigKey.ShowLabsPlugins]: ['true', 'false'],
  [ModConfigKey.PedalboardsViewMode]: ['grid', 'list'],
  [ModConfigKey.CloudTermsAccepted]: ['true', 'false'],
  [ModConfigKey.UpdateChannel]: ['stable', 'testing'],
} as const;

/** The value type of one {@link ModConfigKey}, e.g. `'on' | 'off'` for `ModConfigKey.DevMode`. */
export type ModConfigValue<K extends ModConfigKey> = (typeof MOD_CONFIG_VALUES)[K][number];

/** The preferences of mod-ui: every key is optional, because a preference nobody set yet is absent. */
export type ModConfigData = { [K in ModConfigKey]?: ModConfigValue<K> };

/** Any value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** What an application keeps in {@link AppConfig}: a JSON object. */
export type AppConfigData = { [key: string]: JsonValue };

/** The preference that holds all of {@link AppConfig} (a JSON object, as text). Reserved: {@link ModConfig} cannot touch it. */
export const APP_CONFIG_KEY = 'modui-client';

/** Largest size of the JSON kept by {@link AppConfig}, in bytes (10 KiB). */
export const APP_CONFIG_MAX_BYTES = 10 * 1024;

/**
 * The preferences stored on the device (`client.config`), in two separate parts so it is clear whose they are:
 *
 * - {@link ConfigApi.mod} (`client.config.mod`): the preferences **mod-ui** keeps for its own interface. Typed, a fixed set of keys.
 * - {@link ConfigApi.app} (`client.config.app`): anything **your application** wants to keep on the device (zoom level, last tab,
 *   layout, ...). The client stores it in a single preference, so it can never clash with mod-ui's.
 */
export class ConfigApi {
  /** The preferences of mod-ui itself (`dev-mode`, `pb-view-mode`, ...). */
  readonly mod: ModConfig;
  /** The settings of the application built on this client. */
  readonly app: AppConfig;

  /** @internal Use `client.config`. */
  constructor(http: HttpTransport) {
    const preferences = new Preferences(http);
    this.mod = new ModConfig(preferences);
    this.app = new AppConfig(preferences);
  }
}

/** Reads and writes the preferences file of the device (`GET /config/get`, `POST /config/set`). */
class Preferences {
  constructor(private readonly http: HttpTransport) {}

  all(): Promise<Record<string, unknown>> {
    return this.http.getJson<Record<string, unknown>>('/config/get');
  }

  async set(key: string, value: string): Promise<void> {
    const ok = await this.http.postForm<boolean>('/config/set', { key, value });
    if (ok !== true) {
      throw new ModUiError(`The backend did not save the preference "${key}"`);
    }
  }
}

/**
 * The preferences that are **specific to mod-ui**: the settings of its own interface (`client.config.mod`). Do not use it to store the
 * settings of your application, use {@link AppConfig} (`client.config.app`).
 *
 * Only the keys of {@link ModConfigKey} exist here, with the values mod-ui understands; API keys and other secrets are never returned
 * by the backend. Nothing is cached: every read asks the device.
 *
 * @example
 * import { ModConfigKey } from 'modui-client';
 * await client.config.mod.set(ModConfigKey.PedalboardsViewMode, 'list');
 * const { 'dev-mode': devMode } = await client.config.mod.getAll();
 */
export class ModConfig {
  /** @internal Use `client.config.mod`. */
  constructor(private readonly preferences: Preferences) {}

  /**
   * Every preference of {@link ModConfigKey} that has a value. A preference nobody set is absent, and so is one whose stored value mod-ui
   * would not understand.
   *
   * Backend: `GET /config/get` (operationId `getUserPreferences`).
   * @example
   * const config = await client.config.mod.getAll();
   * if (config[ModConfigKey.DevMode] === 'on') showDeveloperTools();
   */
  async getAll(): Promise<ModConfigData> {
    const stored = await this.preferences.all();
    const result: Record<string, string> = {};
    for (const key of modConfigKeys()) {
      const value = stored[key];
      if (typeof value === 'string' && (MOD_CONFIG_VALUES[key] as readonly string[]).includes(value)) {
        result[key] = value;
      }
    }
    return result as ModConfigData;
  }

  /**
   * One preference, `undefined` when nobody set it. Same request as {@link ModConfig.getAll}.
   * @throws {ModUiError} when `key` is not a {@link ModConfigKey}.
   */
  async get<K extends ModConfigKey>(key: K): Promise<ModConfigValue<K> | undefined> {
    assertModKey(key);
    return (await this.getAll())[key];
  }

  /**
   * Saves one preference.
   *
   * Backend: `POST /config/set` (operationId `setUserPreference`).
   * @throws {ModUiError} when `key` is not a {@link ModConfigKey} or `value` is not one of its values (nothing is sent).
   * @example
   * await client.config.mod.set(ModConfigKey.DevMode, 'on');
   */
  async set<K extends ModConfigKey>(key: K, value: ModConfigValue<K>): Promise<void> {
    assertModKey(key);
    if (!(MOD_CONFIG_VALUES[key] as readonly string[]).includes(value)) {
      throw new ModUiError(`"${String(value)}" is not a value of "${key}" (use ${MOD_CONFIG_VALUES[key].join(' or ')})`);
    }
    await this.preferences.set(key, value);
  }
}

/**
 * The settings of **your application** (`client.config.app`): a JSON object that lives on the device, so every browser that opens the
 * application sees it. mod-ui does not read it.
 *
 * - It is kept in one preference, `modui-client`. This class hides that detail and never touches the preferences of mod-ui.
 * - **At most 10 KiB** of JSON ({@link APP_CONFIG_MAX_BYTES}), because the preferences are sent again with every page load. Every write
 *   checks the size first and throws {@link ModUiConfigTooLargeError} without sending anything.
 * - **Not secret.** Anyone who can reach the device can read it (`GET /config/get`, the HTML of the UI). Never store a password or a token.
 * - A write reads the whole object, changes it and writes it back; writes of this client are queued. Two browsers writing at the same
 *   moment can overwrite each other (last write wins): the device has no compare-and-set. There is no event when someone else writes.
 *
 * @example
 * await client.config.app.set('zoom', 2);
 * await client.config.app.set('layout', { left: ['gain'], right: [] });
 * const { zoom } = await client.config.app.getAll();
 */
export class AppConfig {
  private queue: Promise<unknown> = Promise.resolve();

  /** @internal Use `client.config.app`. */
  constructor(private readonly preferences: Preferences) {}

  /**
   * Everything the application saved; `{}` when nothing was.
   *
   * Backend: `GET /config/get` (operationId `getUserPreferences`).
   * @throws {ModUiError} when the stored text is not a JSON object (somebody wrote the `modui-client` preference by hand). Nothing is
   * changed; {@link AppConfig.replaceAll} repairs it.
   */
  getAll(): Promise<AppConfigData> {
    return this.read();
  }

  /** One value, `undefined` when it was never saved. Same request as {@link AppConfig.getAll}. */
  async get(key: string): Promise<JsonValue | undefined> {
    assertAppKey(key);
    const all = await this.read();
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : undefined;
  }

  /**
   * Saves one value (any JSON: text, number, boolean, `null`, list, object) and keeps the others.
   *
   * Backend: `GET /config/get` then `POST /config/set` with `key=modui-client` (operationIds `getUserPreferences`, `setUserPreference`).
   * @throws {ModUiConfigTooLargeError} when the settings would pass 10 KiB; nothing is sent.
   * @throws {ModUiError} when `key` is empty or `__proto__`, or `value` is not JSON (`undefined`, a function, a cycle).
   * @example
   * await client.config.app.set('lastPedalboard', bundlepath);
   */
  set(key: string, value: JsonValue): Promise<void> {
    return this.enqueue(async () => {
      assertAppKey(key);
      if (value === undefined) {
        throw new ModUiError(`The value of "${key}" is undefined, which is not JSON`);
      }
      const all = await this.read();
      all[key] = value;
      await this.write(all);
    });
  }

  /**
   * Removes one value. Nothing is written when it was not there. Unlike the other writes it is never refused for size, so that an
   * oversized object can always be made smaller.
   *
   * Backend: `GET /config/get`, then `POST /config/set` when something changed.
   */
  delete(key: string): Promise<void> {
    return this.enqueue(async () => {
      assertAppKey(key);
      const all = await this.read();
      if (Object.prototype.hasOwnProperty.call(all, key)) {
        delete all[key];
        await this.write(all, false);
      }
    });
  }

  /**
   * Replaces everything the application saved (the values left out are deleted).
   *
   * Backend: `POST /config/set` with `key=modui-client`.
   * @throws {ModUiConfigTooLargeError} when the settings would pass 10 KiB; nothing is sent.
   * @example
   * await client.config.app.replaceAll({ zoom: 1 });
   */
  replaceAll(values: AppConfigData): Promise<void> {
    return this.enqueue(async () => {
      if (values === null || typeof values !== 'object' || Array.isArray(values)) {
        throw new ModUiError('The application settings must be an object');
      }
      await this.write(values);
    });
  }

  // ------------------------------------------------------------------------------------------------------------------

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<AppConfigData> {
    const stored = (await this.preferences.all())[APP_CONFIG_KEY];
    if (stored === undefined || stored === '') {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
    } catch {
      throw new ModUiError(`The preference "${APP_CONFIG_KEY}" does not hold JSON; replaceAll() can repair it`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ModUiError(`The preference "${APP_CONFIG_KEY}" does not hold a JSON object; replaceAll() can repair it`);
    }
    return parsed as AppConfigData;
  }

  private async write(values: AppConfigData, checkSize = true): Promise<void> {
    let json: string | undefined;
    try {
      json = JSON.stringify(values);
    } catch {
      json = undefined; // a cycle, a BigInt
    }
    if (json === undefined) {
      throw new ModUiError('The application settings are not JSON');
    }
    if (checkSize) {
      const size = new TextEncoder().encode(json).length;
      if (size > APP_CONFIG_MAX_BYTES) {
        throw new ModUiConfigTooLargeError(size, APP_CONFIG_MAX_BYTES);
      }
    }
    await this.preferences.set(APP_CONFIG_KEY, json);
  }
}

function modConfigKeys(): ModConfigKey[] {
  return Object.keys(MOD_CONFIG_VALUES) as ModConfigKey[];
}

function assertModKey(key: unknown): asserts key is ModConfigKey {
  if (!modConfigKeys().includes(key as ModConfigKey)) {
    throw new ModUiError(`"${String(key)}" is not a ModConfigKey`);
  }
}

function assertAppKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key === '' || key === '__proto__') {
    throw new ModUiError('The key of an application setting must be a non-empty text (not "__proto__")');
  }
}
