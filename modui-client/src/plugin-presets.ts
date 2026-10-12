// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The presets of a plugin: {@link PluginPresets} (`instance.presets`) and {@link Preset}.
 *
 * A preset is a named set of control-port values of **one plugin**. *Factory* presets ship with the plugin; *user* presets are saved by
 * the user and can be overwritten and deleted. Presets belong to the plugin, not to the instance: two instances of the same plugin see
 * the same list. Not to be confused with a pedalboard *snapshot* (`currentPedalboard.snapshots`), which holds the values of every plugin.
 * @module
 */

import { Emitter, type EventMeta, type ListenOptions, type Unsubscribe } from './emitter';
import { ModUiError, ModUiHttpError } from './errors';
import type { GraphChange } from './graph-state';
import type { PluginInstance } from './pedalboard-graph';
import type { NonCachedPluginInfo, PluginPresetInfo, PresetSaveResponse, WriteOptions } from './types';

/** `presets.on('list')`: the presets of the plugin changed. */
export interface PresetListEvent extends EventMeta {
  /** The presets now (factory ones first, as the backend lists them). */
  presets: readonly Preset[];
}

/** Events of `instance.presets.on(...)`. */
export interface PresetEvents {
  list: PresetListEvent;
}

/** What the plugin's catalog keeps for each preset. */
interface CatalogEntry {
  /** Identity: the bundle for a user preset (it survives a save, which changes the URI and the label), the URI for a factory one. */
  key: string;
  uri: string;
  label: string;
  path: string;
  dead: boolean;
}

/**
 * The presets of one plugin URI, shared by every instance of that plugin (internal; owned by `PluginsApi`).
 * `null` entries mean the list was never read.
 */
export class PresetCatalog {
  entries: CatalogEntry[] | null = null;
  readonly emitter = new Emitter<{ change: EventMeta }>();

  /** @param onChange Called with the raw list whenever it is replaced (it keeps the cached plugin description up to date). */
  constructor(private readonly onChange: (presets: PluginPresetInfo[]) => void = () => undefined) {}

  /** Replaces the list, keeping the entries whose key is still there. Emits `change` when something differs. */
  update(raw: readonly PluginPresetInfo[], meta: EventMeta): void {
    const previous = this.entries;
    const byKey = new Map((previous ?? []).map((entry) => [entry.key, entry]));
    let changed = previous === null;
    const next: CatalogEntry[] = [];
    for (const item of raw) {
      if (item.valid === false) {
        continue;
      }
      const path = item.path ?? '';
      const key = path ? `bundle:${path}` : `uri:${item.uri}`;
      const kept = byKey.get(key);
      if (kept) {
        byKey.delete(key);
        if (kept.uri !== item.uri || kept.label !== item.label) {
          changed = true;
          kept.uri = item.uri;
          kept.label = item.label;
        }
        kept.path = path;
        next.push(kept);
      } else {
        changed = true;
        next.push({ key, uri: item.uri, label: item.label, path, dead: false });
      }
    }
    for (const gone of byKey.values()) {
      gone.dead = true;
      changed = true;
    }
    if (previous && previous.length !== next.length) {
      changed = true;
    }
    if (previous && !changed) {
      changed = next.some((entry, i) => entry !== previous[i]);
    }
    this.entries = next;
    this.onChange(next.map((entry) => ({ valid: true, uri: entry.uri, label: entry.label, path: entry.path })));
    if (changed) {
      this.emitter.emit('change', { ...meta });
    }
  }
}

/** What {@link PluginPresets} needs from the engine of the running pedalboard (internal). */
export interface PresetEngine {
  getJson<T>(path: string, query?: Record<string, string | number | boolean>): Promise<T>;
  /** Runs `task` in the device queue once the socket is in sync. */
  queue<T>(task: () => Promise<T>): Promise<T>;
  /** Whether the plugin is in the running pedalboard now. */
  has(instance: string): boolean;
  /** Tags the changes `match` accepts as made by this client until the returned function is called. */
  expect(match: (change: GraphChange) => boolean, source: unknown): () => void;
  /** Records the current preset (`null`: none) of a plugin as a local change; the backend sends no frame for a save. */
  setCurrent(instance: string, uri: string | null, source: unknown): void;
}

/**
 * One preset of a plugin, as listed by {@link PluginPresets.list}. The same object is returned for as long as the preset exists:
 * a user preset keeps its object when it is saved over (its `uri` and `label` change), so it can be kept and compared.
 *
 * It belongs to the instance it was listed from: `load()`, `save()` and `delete()` act on that instance. After the preset is deleted
 * (or the instance is removed) `alive` is `false`, the getters keep the last known values and every method rejects.
 *
 * @example
 * const [first] = await instance.presets.list();
 * await first.load();
 * console.log(first.isCurrent); // true
 */
export class Preset {
  /** @internal Built by {@link PluginPresets}. */
  constructor(private readonly entry: CatalogEntry, private readonly owner: PluginPresets) {}

  /** URI of the preset. A user preset gets a new one when it is saved over under another name. */
  get uri(): string {
    return this.entry.uri;
  }

  /** The name shown to the user. Not unique. */
  get label(): string {
    return this.entry.label;
  }

  /** The bundle directory of a user preset, `null` for a factory preset. */
  get bundlepath(): string | null {
    return this.entry.path || null;
  }

  /** Whether it is a user preset: the only kind that can be saved over and deleted. */
  get isUser(): boolean {
    return this.entry.path !== '';
  }

  /** Whether it is the current preset of the instance it was listed from. */
  get isCurrent(): boolean {
    return !this.entry.dead && this.owner.currentUri === this.entry.uri;
  }

  /** `false` once the preset was deleted or is not listed any more, or the instance is gone. */
  get alive(): boolean {
    return !this.entry.dead && this.owner.instance.alive;
  }

  /** @internal */
  get raw(): CatalogEntry {
    return this.entry;
  }

  /**
   * Loads this preset into the instance. Same as {@link PluginPresets.load}.
   * @throws {ModUiError} see {@link PluginPresets.load}.
   * @example
   * await preset.load({ source: 'footswitch' });
   */
  load(options?: WriteOptions): Promise<void> {
    return this.owner.load(this, options);
  }

  /**
   * Writes the **live values** of the instance over this user preset, optionally under a new name. Same as {@link PluginPresets.save}.
   * @throws {ModUiError} see {@link PluginPresets.save}.
   * @example
   * await preset.save('Crunchy');
   */
  save(name?: string, options?: WriteOptions): Promise<Preset> {
    return this.owner.save(this, name, options);
  }

  /**
   * Deletes this user preset from the device. Same as {@link PluginPresets.delete}.
   * @throws {ModUiError} see {@link PluginPresets.delete}.
   * @example
   * await preset.delete();
   */
  delete(options?: WriteOptions): Promise<void> {
    return this.owner.delete(this, options);
  }
}

/** Characters a name cannot contain: a newline would split the command sent to mod-host, a backslash can escape its closing quote. */
const BAD_NAME = /[\u0000-\u001f\u007f\\]/;

/**
 * The presets of a plugin instance (`instance.presets`).
 *
 * - The list is read with {@link PluginPresets.list} from `GET /effect/get_non_cached`, never from the cached description of the plugin,
 *   which goes stale after every save. The names of other clients' changes are found by calling `list()` again; no event makes a request.
 * - **User** presets can be saved over and deleted, only while they are the instance's **current** preset (the backend refuses anything
 *   else without saying why, so the client checks first). **Factory** presets are read-only.
 * - Saving **overwrites the preset's values with the live values** of the instance. The backend has no rename-only operation:
 *   `save(preset, newName)` is how a user preset is renamed, and it also takes the live values.
 * - The backend sends no frame when a preset is saved, so the client records the new current preset itself
 *   (`instance.preset`, `instance.on('preset')`).
 * - A failed `save` can lose the preset (the backend removes its bundle); the list is read again, so `alive` tells the truth.
 * - Operations are queued behind `device.load()`, `device.reset()` and saves, and take `{ source }` like every other write.
 *
 * @example
 * const { presets } = instance;
 * const [first] = await presets.list();
 * await first.load();
 * const mine = await presets.create('Warm');      // saves the live values, becomes current
 * await instance.params.get('gain').setValue(3);
 * await mine.save();                               // overwrite with the new values
 * await mine.delete();
 */
export class PluginPresets {
  /** @internal Built by {@link PluginInstance}. */
  constructor(
    /** @internal */
    readonly instance: PluginInstance,
    private readonly catalog: PresetCatalog,
    private readonly engine: PresetEngine,
  ) {}

  private readonly objects = new Map<CatalogEntry, Preset>();

  // ---- reads --------------------------------------------------------------------------------------------------------

  /**
   * The presets of the plugin, factory presets and user presets, as the backend lists them. The same {@link Preset} objects as before
   * for the presets that are still there (a user preset is told apart by its bundle).
   *
   * Backend: `GET /effect/get_non_cached` (operationId `getPluginNonCached`). Waits for a running load.
   * @throws {ModUiError} when the plugin is not installed.
   * @throws {ModUiTimeoutError} when the WebSocket does not get in sync.
   * @example
   * for (const preset of await instance.presets.list()) console.log(preset.label, preset.isUser);
   */
  list(): Promise<Preset[]> {
    return this.engine.queue(async () => {
      await this.read({ origin: 'remote' });
      return this.all();
    });
  }

  /**
   * One preset by its URI, or `undefined`. Reads the list ({@link PluginPresets.list}).
   * @example
   * const preset = await instance.presets.get(instance.preset!);
   */
  async get(uri: string): Promise<Preset | undefined> {
    return (await this.list()).find((preset) => preset.uri === uri);
  }

  /** URI of the current preset of the instance, `null` when none. Synchronous; the same as `instance.preset`. */
  get currentUri(): string | null {
    return this.instance.preset;
  }

  /**
   * The current preset as an object, `null` when there is none or the list was never read (call `list()` first; `currentUri` is always
   * available).
   */
  get current(): Preset | null {
    const uri = this.instance.preset;
    const entries = this.catalog.entries;
    const entry = uri === null || !entries ? undefined : entries.find((item) => item.uri === uri);
    return entry ? this.wrap(entry) : null;
  }

  // ---- writes -------------------------------------------------------------------------------------------------------

  /**
   * Loads a preset into the instance: its port values are set, and it becomes the current preset. Resolves when the backend finished.
   *
   * Backend: `GET /effect/preset/load/{instance}` (operationId `loadPreset`). The values arrive as ordinary frames, so
   * `instance.params`, `instance.preset` and the immutable `getSnapshot()` update by themselves; their events carry `origin: 'local'` and
   * your `source` (frames another client sends meanwhile get the same tag). The pedalboard is marked as modified.
   * @param target A {@link Preset} or a preset URI.
   * @throws {ModUiError} when the instance is gone, the preset is gone, or the backend answers `false`: an unknown preset, another load
   *   interrupted this one, **or the hardware did not answer within 10 seconds although the preset was applied**.
   * @example
   * await instance.presets.load(preset);
   * await instance.presets.load('http://example.org/presets#clean');
   */
  load(target: Preset | string, options: WriteOptions = {}): Promise<void> {
    const gone = this.rejectIfGone();
    if (gone) {
      return gone;
    }
    if (typeof target !== 'string' && !(target instanceof Preset)) {
      return Promise.reject(new ModUiError('Expected a preset or a preset URI'));
    }
    if (typeof target === 'string' && target === '') {
      return Promise.reject(new ModUiError('Expected a preset or a preset URI'));
    }
    return this.engine.queue(async () => {
      const uri = typeof target === 'string' ? target : this.live(target).uri;
      const path = this.require();
      const release = this.engine.expect(
        (change) => (change.type === 'param' || change.type === 'preset') && change.instance === path,
        options.source,
      );
      try {
        const ok = await this.engine.getJson<boolean>(`/effect/preset/load/${path}`, { uri });
        if (ok !== true) {
          throw new ModUiError(
            `The backend did not load the preset "${uri}": it is unknown, another load interrupted this one, or the hardware did not answer within 10 s (the preset may have been applied)`,
          );
        }
      } finally {
        release();
      }
    });
  }

  /**
   * Saves the **live values** of the instance as a new user preset, which becomes the current preset.
   *
   * Backend: `GET /effect/preset/save_new/{instance}` (operationId `savePresetAsNew`), then `GET /effect/get_non_cached` to read the list.
   * The backend sends no frame for it; the client records the new current preset (`instance.preset`, `instance.on('preset')`).
   * @param name The label. Trimmed; labels are not unique.
   * @throws {ModUiError} when the name is blank or has a control character or a backslash (nothing is sent), the instance is gone, or
   *   the backend refuses.
   * @example
   * const warm = await instance.presets.create('Warm');
   */
  create(name: string, options: WriteOptions = {}): Promise<Preset> {
    const gone = this.rejectIfGone();
    if (gone) {
      return gone;
    }
    let clean: string;
    try {
      clean = checkName(name);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.engine.queue(async () => {
      const path = this.require();
      const response = await this.engine.getJson<PresetSaveResponse>(`/effect/preset/save_new/${path}`, { name: clean });
      if (!response || !response.ok || !response.uri || !response.bundle) {
        throw new ModUiError(`The backend could not save the preset "${clean}"`);
      }
      this.engine.setCurrent(path, response.uri, options.source);
      await this.read({ origin: 'local', source: options.source });
      const created = (this.catalog.entries ?? []).find((entry) => entry.path === response.bundle || entry.uri === response.uri);
      if (!created) {
        throw new ModUiError(`The preset "${clean}" is not in the list after it was saved`);
      }
      return this.wrap(created);
    });
  }

  /**
   * Writes the **live values** of the instance over a user preset, optionally under a new name (this is also how a user preset is
   * renamed: the backend has no rename that keeps the old values). The preset keeps its object; its `uri` and `label` may change.
   *
   * Only the instance's **current** preset can be saved over, and only a user preset: load it first, change the values, then save.
   * A failure on the backend side can delete the preset; the list is read again before the error is thrown.
   *
   * Backend: `GET /effect/preset/save_replace/{instance}` (operationId `savePresetReplace`), then `GET /effect/get_non_cached`.
   * @param preset A {@link Preset} of this plugin.
   * @param name The new label. Default: its current label.
   * @throws {ModUiError} when the preset is gone, a factory preset, or not the current one (nothing is sent), the name is invalid, the
   *   instance is gone, or the backend refuses.
   * @example
   * await instance.presets.load(preset);
   * await instance.params.get('gain').setValue(6);
   * await instance.presets.save(preset);            // or save(preset, 'Louder') to rename it too
   */
  save(preset: Preset, name?: string, options: WriteOptions = {}): Promise<Preset> {
    const gone = this.rejectIfGone();
    if (gone) {
      return gone;
    }
    let clean: string | undefined;
    try {
      clean = name === undefined ? undefined : checkName(name);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.engine.queue(async () => {
      const entry = this.writable(preset, 'saved over');
      const path = this.require();
      const response = await this.engine.getJson<PresetSaveResponse>(`/effect/preset/save_replace/${path}`, {
        uri: entry.uri,
        bundle: entry.path,
        name: clean ?? entry.label,
      });
      if (!response || !response.ok || !response.uri) {
        // the backend may have removed the preset: read the list so `alive` tells the truth
        await this.read({ origin: 'local', source: options.source }).catch(() => undefined);
        throw new ModUiError(`The backend could not save over the preset "${entry.label}" (it may have been lost: check list())`);
      }
      this.engine.setCurrent(path, response.uri, options.source);
      await this.read({ origin: 'local', source: options.source });
      return this.wrap(entry);
    });
  }

  /**
   * Deletes a user preset from the device. Only the instance's **current** preset can be deleted (load it first); factory presets
   * cannot. The current preset becomes `null`.
   *
   * Backend: `GET /effect/preset/delete/{instance}` (operationId `deletePreset`), then `GET /effect/get_non_cached`.
   * @param preset A {@link Preset} of this plugin.
   * @throws {ModUiError} when the preset is gone, a factory preset, or not the current one (nothing is sent), the instance is gone, or
   *   the backend answers `false`.
   * @example
   * await instance.presets.load(preset);
   * await instance.presets.delete(preset);
   */
  delete(preset: Preset, options: WriteOptions = {}): Promise<void> {
    const gone = this.rejectIfGone();
    if (gone) {
      return gone;
    }
    return this.engine.queue(async () => {
      const entry = this.writable(preset, 'deleted');
      const path = this.require();
      // the backend broadcasts "preset <instance> null"
      const release = this.engine.expect((change) => change.type === 'preset' && change.instance === path, options.source);
      try {
        const ok = await this.engine.getJson<boolean>(`/effect/preset/delete/${path}`, { uri: entry.uri, bundle: entry.path });
        if (ok !== true) {
          throw new ModUiError(`The backend could not delete the preset "${entry.label}"`);
        }
      } finally {
        release();
      }
      await this.read({ origin: 'local', source: options.source });
    });
  }

  // ---- events -------------------------------------------------------------------------------------------------------

  /**
   * Calls `handler` when the presets of the plugin change: a read that finds a difference, or a save, a replace or a delete made through
   * this client (on any instance of the plugin). Changes other clients make are found only by calling `list()` again.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `list` | the list changed | `{ presets, origin, source? }` |
   *
   * For the current preset use `instance.on('preset')`. The subscription ends when the instance is removed.
   * @param options `signal`, `ignoreSource`, `ignoreLocal`.
   * @returns A function that removes the subscription.
   * @example
   * instance.presets.on('list', ({ presets }) => menu.render(presets));
   */
  on<K extends keyof PresetEvents>(event: K, handler: (event: PresetEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.subscribe(event, handler, options, false);
  }

  /** Like {@link PluginPresets.on}, but the handler runs once. */
  once<K extends keyof PresetEvents>(event: K, handler: (event: PresetEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.subscribe(event, handler, options, true);
  }

  // ---- internals ----------------------------------------------------------------------------------------------------

  private subscribe<K extends keyof PresetEvents>(
    _event: K,
    handler: (event: PresetEvents[K]) => void,
    options: ListenOptions | undefined,
    once: boolean,
  ): Unsubscribe {
    if (!this.instance.alive) {
      return () => undefined;
    }
    const deliver = (meta: EventMeta) => handler({ presets: this.all(), origin: meta.origin, source: meta.source });
    const off = once ? this.catalog.emitter.once('change', deliver, options) : this.catalog.emitter.on('change', deliver, options);
    const stop = this.instance.once('removed', () => off());
    return () => {
      off();
      stop();
    };
  }

  private rejectIfGone(): Promise<never> | undefined {
    return this.instance.rejectIfGone();
  }

  /** The instance's path, or an error when it is not in the pedalboard (the backend would answer 500). Run inside the queue. */
  private require(): string {
    if (!this.instance.alive || !this.engine.has(this.instance.instance)) {
      throw new ModUiError(`There is no plugin "${this.instance.instance}" in the running pedalboard`);
    }
    return this.instance.instance;
  }

  /** Reads `GET /effect/get_non_cached` into the shared catalog. */
  private async read(meta: EventMeta): Promise<void> {
    let answer: NonCachedPluginInfo;
    try {
      answer = await this.engine.getJson<NonCachedPluginInfo>('/effect/get_non_cached', { uri: this.instance.uri });
    } catch (error) {
      if (error instanceof ModUiHttpError && error.status === 404) {
        throw new ModUiError(`The plugin "${this.instance.uri}" is not installed: its presets cannot be read`);
      }
      throw error;
    }
    this.catalog.update(answer?.presets ?? [], meta);
  }

  private all(): Preset[] {
    return (this.catalog.entries ?? []).map((entry) => this.wrap(entry));
  }

  private wrap(entry: CatalogEntry): Preset {
    let preset = this.objects.get(entry);
    if (!preset) {
      preset = new Preset(entry, this);
      this.objects.set(entry, preset);
    }
    return preset;
  }

  /** The entry of a preset of this plugin that is still listed. */
  private live(preset: Preset): CatalogEntry {
    const entry = preset instanceof Preset ? preset.raw : undefined;
    if (!entry || entry.dead || !this.catalog.entries?.includes(entry)) {
      throw new ModUiError('The preset is gone: it was deleted or is not listed any more');
    }
    return entry;
  }

  /** The entry of a preset that `save` / `delete` can act on: a user preset that is the instance's current one. */
  private writable(preset: Preset, what: string): CatalogEntry {
    const entry = this.live(preset);
    if (entry.path === '') {
      throw new ModUiError(`"${entry.label}" is a factory preset and cannot be ${what}: use create() to keep a copy of the values`);
    }
    if (this.instance.preset !== entry.uri) {
      throw new ModUiError(`"${entry.label}" is not the current preset of ${this.instance.instance}: load it first, the backend only lets the current preset be ${what}`);
    }
    return entry;
  }
}

function checkName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ModUiError('The preset name must be a non-empty string');
  }
  if (BAD_NAME.test(name)) {
    throw new ModUiError('The preset name cannot contain control characters or a backslash');
  }
  return name.trim();
}
