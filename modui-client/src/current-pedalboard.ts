// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pedalboard that is running on the device: {@link CurrentPedalboard} (`client.device.currentPedalboard`).
 * @module
 */

import type { ListenOptions, Unsubscribe } from './emitter';
import { ModUiError } from './errors';
import type { PedalboardSnapshot } from './snapshot';
import type { HttpTransport } from './http';
import { waitForPendingImages } from './pedalboard-images';
import { PedalboardConnections, PedalboardPorts } from './pedalboard-connections';
import type { NewerFormat, PedalboardEvents } from './pedalboard-events';
import type { Enqueue, PedalboardGraph } from './pedalboard-graph';
import { PedalboardPlugins } from './pedalboard-plugins';
import { PedalboardSnapshots } from './pedalboard-snapshots';
import type { EventChannel } from './events';
import { sameBundle } from './pedalboards';
import type { PedalboardReference, PedalboardsApi } from './pedalboards';
import type { CurrentPedalboardState, SavePedalboardResponse } from './types';

/**
 * The pedalboard running on the device right now (`client.device.currentPedalboard`).
 *
 * It knows how to find out which pedalboard that is ({@link CurrentPedalboard.get}) and how to persist it
 * ({@link CurrentPedalboard.save}, {@link CurrentPedalboard.saveAs}). Operations are queued behind
 * `device.load()` / `device.reset()`, so they never run in the middle of a load.
 *
 * Notes:
 * - The classic UI keeps its own copy of the title and path (taken from its own HTTP responses). It is not
 *   updated when the client saves.
 * - The running pedalboard becomes the saved bundle after a save, so later `save()` calls overwrite it.
 *
 * @example
 * const device = client.device;
 * const current = await device.currentPedalboard.get();       // PedalboardReference | null
 * await device.currentPedalboard.save();                       // overwrite, keep the title
 * await device.currentPedalboard.save('Renamed');              // overwrite and rename
 * const copy = await device.currentPedalboard.saveAs('Solo');  // new bundle, "Solo (2)" if "Solo" exists
 */
export class CurrentPedalboard {
  /** The plugins in the pedalboard: list, add, remove. */
  readonly plugins: PedalboardPlugins;
  /** The connections between plugin ports and pedalboard ports: list, connect, disconnect. */
  readonly connections: PedalboardConnections;
  /** The inputs and outputs of the pedalboard itself, to connect plugins to. */
  readonly ports: PedalboardPorts;
  /**
   * The snapshots of the pedalboard (saved sets of plugin values): list, create, save, load, rename, delete. Not to be confused with
   * {@link CurrentPedalboard.getSnapshot}, the immutable state for UI frameworks.
   */
  readonly snapshots: PedalboardSnapshots;

  /** @internal Use `client.device.currentPedalboard`. */
  constructor(
    private readonly http: HttpTransport,
    private readonly pedalboards: PedalboardsApi,
    private readonly enqueue: Enqueue,
    private readonly graph: PedalboardGraph,
    events: EventChannel,
  ) {
    this.plugins = new PedalboardPlugins(graph);
    this.connections = new PedalboardConnections(graph);
    this.ports = new PedalboardPorts(graph);
    this.snapshots = new PedalboardSnapshots(http, events, enqueue, graph);
  }

  /**
   * The library entry of the running pedalboard, or `null` when it is untitled (after `device.reset()`, after
   * `device.loadDefault()`, or a pedalboard that was never saved): such a pedalboard has no bundle yet.
   *
   * Backend: `GET /pedalboard/current` (operationId `getCurrentPedalboard`) and `GET /pedalboard/list`.
   * @throws {ModUiError} when the running bundle is not in the pedalboard list.
   * @example
   * const current = await client.device.currentPedalboard.get();
   * if (current) console.log(current.title, current.bundlepath);
   */
  get(): Promise<PedalboardReference | null> {
    return this.enqueue(async () => {
      const state = await this.readState();
      if (!state.bundlepath) {
        return null;
      }
      return this.findInLibrary(state.bundlepath);
    });
  }

  /**
   * Saves the running pedalboard **over its own bundle** ("Save").
   *
   * @param newTitle Title to store. When omitted, the current title of the pedalboard is read from the backend and
   *   kept. When given, the pedalboard is renamed.
   *
   * Special cases decided by the backend (see `savePedalboard` in `docs/openapi.yml`):
   * - a **factory** pedalboard is never modified: the result is a copy in the user's directory;
   * - a pedalboard that has no bundle yet (untitled) is saved as a **new** bundle, which needs a title.
   *
   * Backend: `GET /pedalboard/current` (only when `newTitle` is omitted), `POST /pedalboard/save` with `asNew=0`,
   * `GET /pedalboard/list` to build the result, and `GET /pedalboard/image/wait` so the promise resolves only after
   * the thumbnail and the screenshot (regenerated in the background when the graph changed) are ready.
   * @returns The saved pedalboard (its `bundlepath` can differ from the previous one, see above).
   * @throws {ModUiError} when no title is given and the pedalboard is untitled, when the title is blank, or when
   *   the backend fails to save.
   * @example
   * await client.device.currentPedalboard.save();
   * await client.device.currentPedalboard.save('New name');
   */
  save(newTitle?: string): Promise<PedalboardReference> {
    if (newTitle !== undefined && !isValidTitle(newTitle)) {
      return Promise.reject(blankTitleError());
    }
    return this.enqueue(async () => {
      let title = newTitle;
      if (title === undefined) {
        title = (await this.readState()).title;
        if (!title.trim()) {
          throw new ModUiError(
            'The running pedalboard has no title yet: pass a title to save() or use saveAs(title)',
          );
        }
      }
      return this.persist(title, false);
    });
  }

  /**
   * Saves the running pedalboard as a **new** pedalboard ("Save as"). The previous bundle is left untouched, and the
   * running pedalboard becomes the new one.
   *
   * @param suggestedTitle Wished title. The backend makes it unique among the user's pedalboards: if
   *   `"Solo"` exists the result is titled `"Solo (2)"`. Read the real title from the returned reference.
   *
   * Backend: `POST /pedalboard/save` with `asNew=1` (operationId `savePedalboard`), `GET /pedalboard/list`, and
   * `GET /pedalboard/image/wait` (the promise resolves only after the images of the new pedalboard are ready).
   * @returns The new pedalboard.
   * @throws {ModUiError} when the title is blank or the backend fails to save.
   * @example
   * const copy = await client.device.currentPedalboard.saveAs('Solo');
   * console.log(copy.title); // "Solo", or "Solo (2)" when taken
   */
  saveAs(suggestedTitle: string): Promise<PedalboardReference> {
    if (!isValidTitle(suggestedTitle)) {
      return Promise.reject(blankTitleError());
    }
    return this.enqueue(() => this.persist(suggestedTitle, true));
  }

  /**
   * Calls `handler` when the running pedalboard changes, whoever causes it (this client, the classic UI, the HMI, another
   * client). The client keeps the whole state in memory, so no event makes a request.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `plugin:added` | a plugin appeared | `{ plugin }` (a complete {@link PluginInstance}) |
   * | `plugin:removed` | a plugin was removed | `{ plugin, reason }` (`plugin.alive` is `false`) |
   * | `connection:added`, `connection:removed` | a connection changed | `{ from, to }` (port ids) |
   * | `port:added`, `port:removed` | a port of the pedalboard itself changed | `{ id, ... }` |
   * | `loading` | a pedalboard starts loading | `{ empty, modified }` |
   * | `loaded` | the pedalboard is complete (also once after the first connection) | `{ snapshotId }` |
   * | `newerFormat` | the pedalboard being loaded was saved on a newer MOD OS (see {@link CurrentPedalboard.newerFormat}) | `{ fileFormat, supportedFormat }` |
   * | `cleared` | the pedalboard was emptied | `{}` |
   * | `error` | a background request failed (a plugin description) | `{ error, context }` |
   *
   * Every payload except `error` also has `origin` (`'local'` when this client caused the change, `'remote'` otherwise) and
   * `source` (what you passed in the `source` option of the call that caused it).
   *
   * Rules:
   * - Events are delivered in the order of the WebSocket frames, after the state is updated, so a handler reads the new state.
   * - Between `loading` and `loaded` nothing else is delivered (a load is hundreds of frames), except `newerFormat`: show a loading state, and read
   *   `plugins.list()`, `connections.list()` and `ports.list()` again on `loaded`. `cleared` also stands for every removal.
   * - A handler that throws does not affect the others; the error is rethrown asynchronously (visible in the console).
   * - Render from events, not from the promise of a write: local writes emit their event too, so one path serves every cause.
   *   To keep a control from reacting to the user's own gesture, pass `{ source }` to the write and `{ ignoreSource }` here.
   *
   * @param options `signal` (an `AbortSignal` that ends the subscription), `ignoreSource`, `ignoreLocal`.
   * @returns A function that removes the subscription.
   * @example
   * const off = client.device.currentPedalboard.on('plugin:added', ({ plugin }) => view.add(plugin));
   * client.device.currentPedalboard.on('loaded', async () => view.render(await pedalboard.plugins.list()));
   * client.device.currentPedalboard.on('connection:added', ({ from, to }) => view.wire(from, to), { ignoreLocal: true });
   */
  on<K extends keyof PedalboardEvents>(
    event: K,
    handler: (event: PedalboardEvents[K]) => void,
    options?: ListenOptions,
  ): Unsubscribe {
    return this.graph.store.bus.on(event, handler, options);
  }

  /**
   * Set when the running pedalboard was saved on a newer MOD OS than the device runs (its `pedal:formatVersion` is higher than the one the
   * device writes), `null` otherwise. It loads and plays as usual, but saving it on this device drops what this version does not know,
   * so warn the user before they save. Live: it follows every load (and `reset()`, which clears it), and `on('newerFormat')` announces it.
   *
   * WebSocket: `pb_newer_format <fileFormat> <supportedFormat>`, sent inside the loading bracket (and in the state replay of a new socket).
   * @example
   * const notice = client.device.currentPedalboard.newerFormat;
   * if (notice) warn(`Made with pedalboard format ${notice.fileFormat}; this device knows ${notice.supportedFormat}.`);
   */
  get newerFormat(): NewerFormat | null {
    return this.graph.store.newerFormat;
  }

  /**
   * The state of the pedalboard as one immutable, JSON-serializable object (plugins with their values, connections, the pedalboard's
   * own ports, `loading` / `ready`). Synchronous, and the **same object until something changes**; what did not change keeps its
   * identity, so frameworks skip it. Meant for `useSyncExternalStore`-style bindings; see {@link CurrentPedalboard.subscribe}.
   *
   * Not to be confused with {@link CurrentPedalboard.snapshots}, the pedalboard's saved sets of plugin values.
   *
   * It is an arrow property, so it can be passed around without `this`: `useSyncExternalStore(pedalboard.subscribe, pedalboard.getSnapshot)`.
   * It is empty and `ready: false` until the first state replay ends, and during a load.
   * @example
   * const { plugins, connections, ready } = client.device.currentPedalboard.getSnapshot();
   */
  readonly getSnapshot = (): PedalboardSnapshot => this.graph.store.snapshots.current();

  /**
   * Calls `listener` (no arguments) after the snapshot changed. Notifications are **batched**: however many frames arrive, the
   * listener runs once per animation frame in a browser (once per microtask elsewhere; see `ModUiClientOptions.schedule`), and
   * {@link CurrentPedalboard.getSnapshot} then returns the latest state. Use the events (`on`) instead when you must see every change.
   * An arrow property, like `getSnapshot`. A listener that throws does not affect the others (rethrown asynchronously).
   * @returns A function that removes the subscription.
   * @example
   * // React
   * const snapshot = useSyncExternalStore(pedalboard.subscribe, pedalboard.getSnapshot);
   * // anything else
   * const off = pedalboard.subscribe(() => render(pedalboard.getSnapshot()));
   */
  readonly subscribe = (listener: () => void): Unsubscribe => this.graph.store.snapshots.subscribe(listener);

  /** Like {@link CurrentPedalboard.on}, but the handler runs once. */
  once<K extends keyof PedalboardEvents>(
    event: K,
    handler: (event: PedalboardEvents[K]) => void,
    options?: ListenOptions,
  ): Unsubscribe {
    return this.graph.store.bus.once(event, handler, options);
  }

  // ------------------------------------------------------------------------------------------------------------------

  private readState(): Promise<CurrentPedalboardState> {
    return this.http.getJson<CurrentPedalboardState>('/pedalboard/current');
  }

  private async findInLibrary(bundlepath: string): Promise<PedalboardReference> {
    const references = await this.pedalboards.list();
    const reference = references.find((ref) => sameBundle(ref.bundlepath, bundlepath));
    if (!reference) {
      throw new ModUiError(`The pedalboard "${bundlepath}" is not in the pedalboard list`);
    }
    return reference;
  }

  private async persist(title: string, asNew: boolean): Promise<PedalboardReference> {
    const response = await this.http.postForm<SavePedalboardResponse>('/pedalboard/save', {
      title,
      asNew: asNew ? 1 : 0,
    });
    if (!response || !response.ok || !response.bundlepath) {
      throw new ModUiError(`The backend failed to save the pedalboard "${title}"`);
    }
    const reference = await this.findInLibrary(response.bundlepath);
    await this.waitForImages(reference.bundlepath);
    return reference;
  }

  /**
   * A save regenerates the screenshot and the thumbnail in the background when the graph changed; wait for it so
   * the saved pedalboard is complete when the promise resolves. The pedalboard is already saved at this point, so a
   * failure of this wait (or of the rendering itself) must not make the save look failed: it is ignored.
   */
  private async waitForImages(bundlepath: string): Promise<void> {
    try {
      await waitForPendingImages(this.http, bundlepath);
    } catch {
      // best effort, see above
    }
  }
}

function isValidTitle(title: string): boolean {
  return typeof title === 'string' && title.trim() !== '';
}

function blankTitleError(): ModUiError {
  return new ModUiError('The pedalboard title must be a non-empty string');
}
