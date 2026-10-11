// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The snapshots of the running pedalboard: {@link PedalboardSnapshots} (`client.device.currentPedalboard.snapshots`) and
 * {@link Snapshot}.
 *
 * A *snapshot* here is a saved set of plugin values (control ports, bypass, patch parameters, presets) that the user switches between
 * while playing. Not to be confused with `currentPedalboard.getSnapshot()` (the immutable state for UI frameworks) nor with
 * `device.on('snapshot')` (the raw report of the current snapshot).
 * @module
 */

import { Emitter, type EventMeta, type ListenOptions, type Unsubscribe } from './emitter';
import { ModUiError } from './errors';
import type { EventChannel } from './events';
import type { GraphChange } from './graph-state';
import type { HttpTransport } from './http';
import type { Enqueue, PedalboardGraph } from './pedalboard-graph';
import type {
  SnapshotListResponse,
  SnapshotRenameResponse,
  SnapshotSaveAsResponse,
  WriteOptions,
} from './types';

/** `snapshots.on('current')`: the current snapshot changed (a load, `saveAs`, `remove`, a pedalboard load, the device's own report). */
export interface SnapshotCurrentEvent extends EventMeta {
  /** The new current snapshot; `null` when there is none, or when the names are not read yet (call `list()`). */
  snapshot: Snapshot | null;
  /** Its index; `null` when the pedalboard has no current snapshot. */
  index: number | null;
  /** The index before; `null` when there was none. */
  previous: number | null;
}

/** `snapshots.on('list')`: the names or the order changed, or the list was invalidated by a pedalboard load. */
export interface SnapshotListEvent extends EventMeta {
  /** The snapshots now, by index. Empty after a pedalboard load, until `list()` reads them again. */
  snapshots: readonly Snapshot[];
}

/** Events of `currentPedalboard.snapshots.on(...)`. */
export interface SnapshotEvents {
  current: SnapshotCurrentEvent;
  list: SnapshotListEvent;
}

/** What the model keeps for each snapshot. */
interface Entry {
  index: number;
  name: string;
  object: Snapshot;
}

/** Operations a {@link Snapshot} asks of its collection (internal). */
interface SnapshotOps {
  indexOf(snapshot: Snapshot): number | undefined;
  nameOf(snapshot: Snapshot): string | undefined;
  isCurrent(snapshot: Snapshot): boolean;
  load(snapshot: Snapshot, options?: WriteOptions): Promise<void>;
  rename(snapshot: Snapshot, name: string, options?: WriteOptions): Promise<string>;
  remove(snapshot: Snapshot, options?: WriteOptions): Promise<void>;
}

/**
 * One snapshot of the running pedalboard. The same object is returned by `list()` and `get()` for as long as the snapshot exists
 * (it is told apart by its name, which the backend keeps unique), so it can be kept and compared.
 *
 * `index` and `name` are live: removing an earlier snapshot lowers `index`, `rename()` changes `name`. After the snapshot is removed,
 * or another pedalboard is loaded, `alive` is `false`, the getters keep the last known values and every method rejects.
 *
 * A snapshot holds the plugin values at the time it was saved; no endpoint returns them, so only the name and the place are known.
 *
 * @example
 * const [first, second] = await client.device.currentPedalboard.snapshots.list();
 * await second.load();
 * console.log(second.isCurrent); // true
 */
export class Snapshot {
  private dead = false;
  private last = { index: -1, name: '' };

  /** @internal Built by {@link PedalboardSnapshots}. */
  constructor(private readonly ops: SnapshotOps) {}

  /** Position in the list, from 0. This is the `id` the backend uses; it changes when an earlier snapshot is removed. */
  get index(): number {
    return this.dead ? this.last.index : this.ops.indexOf(this) ?? this.last.index;
  }

  /** The name, unique inside the pedalboard. */
  get name(): string {
    return this.dead ? this.last.name : this.ops.nameOf(this) ?? this.last.name;
  }

  /** Whether this is the snapshot the backend considers current (it is the one `save()` would overwrite). */
  get isCurrent(): boolean {
    return !this.dead && this.ops.isCurrent(this);
  }

  /** `false` once the snapshot was removed or another pedalboard was loaded. */
  get alive(): boolean {
    return !this.dead;
  }

  /** @internal */
  kill(index: number, name: string): void {
    this.last = { index, name };
    this.dead = true;
  }

  /**
   * Applies this snapshot: every plugin value it holds is set on the device. Same as {@link PedalboardSnapshots.load}.
   * @throws {ModUiError} when the snapshot is gone, or the backend did not apply it.
   * @example
   * await snapshot.load();
   */
  load(options?: WriteOptions): Promise<void> {
    return this.ops.load(this, options);
  }

  /**
   * Renames the snapshot. Backend: `GET /snapshot/rename` (operationId `renameSnapshot`).
   * @returns The final name: the backend adds ` (2)` when the name is taken.
   * @throws {ModUiError} when the name is blank, the snapshot is gone, or the backend refuses.
   * @example
   * const name = await snapshot.rename('Solo'); // "Solo", or "Solo (2)" when taken
   */
  rename(name: string, options?: WriteOptions): Promise<string> {
    return this.ops.rename(this, name, options);
  }

  /**
   * Deletes the snapshot; the later ones move up by one. The last remaining snapshot cannot be deleted.
   * Backend: `GET /snapshot/remove` (operationId `removeSnapshot`).
   * @throws {ModUiError} when the snapshot is gone, it is the only one, or the backend refuses.
   * @example
   * await snapshot.remove();
   */
  remove(options?: WriteOptions): Promise<void> {
    return this.ops.remove(this, options);
  }
}

const VALUE_CHANGES: ReadonlyArray<GraphChange['type']> = ['param', 'patch', 'active', 'preset'];

/**
 * The snapshots of the running pedalboard (`client.device.currentPedalboard.snapshots`).
 *
 * Snapshots belong to the pedalboard: they are saved with it, and a pedalboard load replaces the whole list (the old {@link Snapshot}
 * objects are then `alive === false`). The backend identifies a snapshot by its **position**, and every write is applied on the
 * device and stored in the pedalboard's bundle at once (a titled pedalboard rewrites `snapshots.json` immediately; an untitled one
 * keeps them in memory until it is saved).
 *
 * What the client knows, and how:
 * - the **names** are read with {@link PedalboardSnapshots.list} (the only request; no event makes one), and kept up to date from the
 *   client's own writes and from the device's `pedal_snapshot` reports;
 * - the **current** snapshot: {@link PedalboardSnapshots.currentIndex} is known right after the pedalboard loads (`loading_end`), the
 *   object {@link PedalboardSnapshots.current} once the names are known;
 * - changes made by **other clients** (the classic UI, the HMI) to the list are not announced by the backend: call `list()` again.
 *
 * Backend limits worth knowing (see `docs/plans/2026-10-modui-client-snapshots-banks.md`):
 * - removing a snapshot that comes *before* the current one leaves the backend's current index unchanged, so it then points at the
 *   next snapshot; the client mirrors that number (`currentIndex`) and does not correct it;
 * - when the snapshot selector is addressed to a hardware actuator the classic UI refuses to add, delete or load snapshots, and the
 *   backend would let the hardware options go stale. The client cannot see addressings and does not refuse.
 *
 * Writes are queued behind `device.load()`, `device.reset()` and saves, and take `{ source }` like every other write.
 *
 * @example
 * const { snapshots } = client.device.currentPedalboard;
 * const solo = await snapshots.saveAs('Solo');       // captures the live values, becomes current
 * await (await snapshots.get(0))!.load();            // back to the first one
 * snapshots.on('current', ({ snapshot }) => label.textContent = snapshot?.name ?? '-');
 */
export class PedalboardSnapshots {
  private readonly emitter = new Emitter<SnapshotEvents>();
  private entries: Entry[] = [];
  /** The names were read since the last pedalboard load. */
  private known = false;
  private currentId: number | null = null;
  /** Last current published, to emit `current` only when it changes. */
  private published: { index: number | null; snapshot: Snapshot | null } = { index: null, snapshot: null };
  /** Set while a `load` request is in flight: the `pedal_snapshot` frame it provokes is ours. */
  private loadingFor: { source: unknown } | null = null;

  /** @internal Use `client.device.currentPedalboard.snapshots`. */
  constructor(
    private readonly http: HttpTransport,
    events: EventChannel,
    private readonly enqueue: Enqueue,
    private readonly graph: PedalboardGraph,
  ) {
    const bus = graph.store.bus;
    bus.on('loading', (event) => this.invalidate(event));
    // `device.reset()`: the backend keeps one snapshot, the current one, and says nothing about it.
    bus.on('cleared', (event) => {
      this.invalidate(event);
      this.currentId = 0;
      this.publishCurrent(event);
    });
    bus.on('loaded', (event) => {
      this.currentId = event.snapshotId >= 0 ? event.snapshotId : null;
      this.publishCurrent(event);
    });
    events.on('pedal_snapshot', (args) => this.reported(args));
  }

  // ---- reads --------------------------------------------------------------------------------------------------------

  /**
   * The snapshots of the pedalboard, by index. The same {@link Snapshot} objects as before for the names that are still there.
   *
   * Backend: `GET /snapshot/list` (operationId `listSnapshots`). Waits for a running load.
   * @throws {ModUiTimeoutError} when the WebSocket does not get in sync.
   * @example
   * for (const snapshot of await client.device.currentPedalboard.snapshots.list()) console.log(snapshot.index, snapshot.name);
   */
  list(): Promise<Snapshot[]> {
    return this.enqueue(async () => {
      await this.graph.sync();
      await this.readList();
      return this.objects();
    });
  }

  /**
   * One snapshot by its index, or `undefined` when there is none. Reads the list ({@link PedalboardSnapshots.list}); it does not use
   * `GET /snapshot/name`, which answers `Default` for any index.
   * @example
   * const first = await client.device.currentPedalboard.snapshots.get(0);
   */
  async get(index: number): Promise<Snapshot | undefined> {
    return (await this.list()).find((snapshot) => snapshot.index === index);
  }

  /**
   * The snapshot the backend considers current (the one {@link PedalboardSnapshots.save} overwrites), or `null` when there is none or
   * the names are not read yet. Synchronous; call `list()` first, and see {@link PedalboardSnapshots.currentIndex}.
   */
  get current(): Snapshot | null {
    return this.resolveCurrent();
  }

  /**
   * Index of the current snapshot, `null` when there is none (the pedalboard has not loaded yet, or the current one was removed).
   * Known from `loading_end` and from the device's reports, so it is valid before `list()` has run. Mirrors the backend's number.
   */
  get currentIndex(): number | null {
    return this.currentId;
  }

  // ---- writes -------------------------------------------------------------------------------------------------------

  /**
   * Overwrites the current snapshot with the live values of the pedalboard.
   *
   * Backend: `POST /snapshot/save` (operationId `saveSnapshot`).
   * @throws {ModUiError} when there is no current snapshot (nothing is sent), or the backend answers `false`.
   * @example
   * await client.device.currentPedalboard.snapshots.save();
   */
  save(): Promise<void> {
    return this.enqueue(async () => {
      await this.graph.sync();
      if (this.currentId === null || (this.known && !this.entry(this.currentId))) {
        throw new ModUiError('The pedalboard has no current snapshot to save: load or create one first');
      }
      const ok = await this.http.postForm<boolean>('/snapshot/save', {});
      if (ok !== true) {
        throw new ModUiError('The backend could not save the current snapshot');
      }
    });
  }

  /**
   * Creates a snapshot with the live values; it becomes the current one.
   *
   * Backend: `GET /snapshot/saveas` (operationId `saveSnapshotAs`).
   * @param name Wished name. The backend makes it unique (`Solo (2)`): read the real one from the result.
   * @throws {ModUiError} when the name is blank, or the backend could not create it.
   * @example
   * const solo = await client.device.currentPedalboard.snapshots.saveAs('Solo');
   * console.log(solo.index, solo.name);
   */
  saveAs(name: string, options: WriteOptions = {}): Promise<Snapshot> {
    if (!isValidName(name)) {
      return Promise.reject(blankName());
    }
    return this.enqueue(async () => {
      await this.graph.sync();
      const response = await this.http.getJson<SnapshotSaveAsResponse>('/snapshot/saveas', { title: name });
      if (!response || !response.ok || response.id === null || response.id === undefined) {
        throw new ModUiError(`The backend could not create the snapshot "${name}"`);
      }
      const meta = localMeta(options);
      this.currentId = response.id;
      if (!this.known) {
        // The names are not known, so the new one cannot be placed: read them.
        await this.readList(meta);
      } else {
        const previous = this.entry(response.id);
        if (previous) {
          this.entries = this.entries.filter((entry) => entry !== previous);
          this.retire(previous);
        }
        this.entries.push({ index: response.id, name: response.title, object: new Snapshot(this.ops) });
        this.entries.sort((a, b) => a.index - b.index);
        this.emitList(meta);
      }
      this.publishCurrent(meta);
      const created = this.entry(response.id);
      if (!created) {
        throw new ModUiError(`The snapshot "${response.title}" is not in the list after it was created`);
      }
      return created.object;
    });
  }

  /**
   * Applies a snapshot: its values are set on every plugin, and it becomes the current one. Resolves when the backend finished.
   *
   * Backend: `GET /snapshot/load` (operationId `loadSnapshot`). The values arrive as ordinary frames, so `instance.params`,
   * `patchParams`, `isActive()`, `instance.preset` and `currentPedalboard.getSnapshot()` update by themselves; their events carry
   * `origin: 'local'` and your `source`. Frames sent by another client while the request is in flight get the same tag: the backend
   * does not allow telling them apart.
   * @param target A {@link Snapshot} or its index.
   * @throws {ModUiError} when the index is not a non-negative integer, the snapshot is gone, or the backend did not apply it (unknown
   *   index, or interrupted by another load).
   * @example
   * await client.device.currentPedalboard.snapshots.load(2, { source: 'footswitch' });
   */
  load(target: Snapshot | number, options: WriteOptions = {}): Promise<void> {
    if (!(target instanceof Snapshot) && (typeof target !== 'number' || !Number.isInteger(target) || target < 0)) {
      return Promise.reject(new ModUiError('A snapshot index must be a non-negative integer'));
    }
    return this.enqueue(async () => {
      await this.graph.sync();
      const index = target instanceof Snapshot ? this.live(target).index : target;
      if (this.known && !this.entry(index)) {
        throw new ModUiError(`There is no snapshot ${index} in the pedalboard`);
      }
      this.loadingFor = { source: options.source };
      const release = this.graph.expect((change) => VALUE_CHANGES.includes(change.type), options.source);
      try {
        const ok = await this.http.getJson<boolean>('/snapshot/load', { id: index });
        if (ok !== true) {
          throw new ModUiError(`The backend did not apply the snapshot ${index} (unknown index, or interrupted by another load)`);
        }
      } finally {
        release();
        this.loadingFor = null;
      }
      this.currentId = index;
      this.publishCurrent(localMeta(options));
    });
  }

  // ---- events -------------------------------------------------------------------------------------------------------

  /**
   * Calls `handler` when the snapshots change.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `current` | the current snapshot changed: a load, `saveAs`, `remove` of the current one, a pedalboard load, the device's report | `{ snapshot, index, previous }` |
   * | `list` | names or order changed, or a pedalboard load emptied the list | `{ snapshots }` |
   *
   * Both carry `origin` and `source` like the pedalboard events. No event makes a request: after a pedalboard load `current.snapshot`
   * is `null` until you call `list()`. Changes other clients make to the list are not announced by the backend; `list()` finds them.
   * @param options `signal`, `ignoreSource`, `ignoreLocal`.
   * @returns A function that removes the subscription.
   * @example
   * snapshots.on('current', ({ snapshot }) => title.textContent = snapshot?.name ?? '');
   * snapshots.on('list', ({ snapshots }) => menu.render(snapshots), { ignoreLocal: true });
   */
  on<K extends keyof SnapshotEvents>(event: K, handler: (event: SnapshotEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.emitter.on(event, handler, options);
  }

  /** Like {@link PedalboardSnapshots.on}, but the handler runs once. */
  once<K extends keyof SnapshotEvents>(event: K, handler: (event: SnapshotEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.emitter.once(event, handler, options);
  }

  // ---- the objects' operations --------------------------------------------------------------------------------------

  private readonly ops: SnapshotOps = {
    indexOf: (snapshot) => this.entryOf(snapshot)?.index,
    nameOf: (snapshot) => this.entryOf(snapshot)?.name,
    isCurrent: (snapshot) => this.currentId !== null && this.entryOf(snapshot)?.index === this.currentId,
    load: (snapshot, options) => this.load(snapshot, options),
    rename: (snapshot, name, options) => this.renameSnapshot(snapshot, name, options),
    remove: (snapshot, options) => this.removeSnapshot(snapshot, options),
  };

  private renameSnapshot(snapshot: Snapshot, name: string, options: WriteOptions = {}): Promise<string> {
    if (!isValidName(name)) {
      return Promise.reject(blankName());
    }
    return this.enqueue(async () => {
      await this.graph.sync();
      const entry = this.live(snapshot);
      const response = await this.http.getJson<SnapshotRenameResponse>('/snapshot/rename', { id: entry.index, title: name });
      if (!response || !response.ok) {
        throw new ModUiError(`The backend could not rename the snapshot ${entry.index} to "${name}"`);
      }
      // The pedalboard could have been replaced while the request was in flight.
      if (this.entries.includes(entry) && entry.name !== response.title) {
        entry.name = response.title;
        this.emitList(localMeta(options));
      }
      return response.title;
    });
  }

  private removeSnapshot(snapshot: Snapshot, options: WriteOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      await this.graph.sync();
      const entry = this.live(snapshot);
      if (this.entries.length === 1) {
        throw new ModUiError('The last snapshot of a pedalboard cannot be removed');
      }
      const ok = await this.http.getJson<boolean>('/snapshot/remove', { id: entry.index });
      if (ok !== true) {
        throw new ModUiError(`The backend could not remove the snapshot ${entry.index}`);
      }
      if (!this.entries.includes(entry)) {
        return;
      }
      // The backend's rules: the entries after it move up; the current index is cleared when it was the removed one and otherwise
      // stays as it is, although the positions shifted.
      this.entries = this.entries.filter((other) => other !== entry);
      for (const other of this.entries) {
        if (other.index > entry.index) {
          other.index--;
        }
      }
      this.retire(entry);
      if (this.currentId === entry.index) {
        this.currentId = null;
      }
      const meta = localMeta(options);
      this.emitList(meta);
      this.publishCurrent(meta);
    });
  }

  // ---- model --------------------------------------------------------------------------------------------------------

  private entry(index: number): Entry | undefined {
    return this.entries.find((entry) => entry.index === index);
  }

  private entryOf(snapshot: Snapshot): Entry | undefined {
    return this.entries.find((entry) => entry.object === snapshot);
  }

  private objects(): Snapshot[] {
    return this.entries.map((entry) => entry.object);
  }

  private resolveCurrent(): Snapshot | null {
    if (this.currentId === null || !this.known) {
      return null;
    }
    return this.entry(this.currentId)?.object ?? null;
  }

  /** The entry of a snapshot that can still be used. */
  private live(snapshot: Snapshot): Entry {
    const entry = snapshot instanceof Snapshot ? this.entryOf(snapshot) : undefined;
    if (!entry) {
      throw new ModUiError('The snapshot is gone: it was removed or another pedalboard was loaded');
    }
    return entry;
  }

  private retire(entry: Entry): void {
    entry.object.kill(entry.index, entry.name);
  }

  /** Reads `GET /snapshot/list` and reconciles by name; emits what differs. */
  private async readList(meta: EventMeta = { origin: 'remote' }): Promise<void> {
    const response = await this.http.getJson<SnapshotListResponse>('/snapshot/list');
    const fresh = Object.keys(response ?? {})
      .map((key) => ({ index: parseInt(key, 10), name: String(response[key]) }))
      .filter((item) => Number.isInteger(item.index) && item.index >= 0)
      .sort((a, b) => a.index - b.index);

    const byName = new Map(this.entries.map((entry) => [entry.name, entry]));
    const next: Entry[] = fresh.map((item) => {
      const kept = byName.get(item.name);
      if (kept) {
        byName.delete(item.name);
        return { index: item.index, name: item.name, object: kept.object };
      }
      return { index: item.index, name: item.name, object: new Snapshot(this.ops) };
    });
    for (const gone of byName.values()) {
      this.retire(gone);
    }

    const changed =
      !this.known ||
      byName.size > 0 ||
      next.length !== this.entries.length ||
      next.some((entry, i) => entry.object !== this.entries[i].object || entry.index !== this.entries[i].index);
    this.entries = next;
    this.known = true;
    if (changed) {
      this.emitList(meta);
    }
    this.publishCurrent(meta);
  }

  private emitList(meta: EventMeta): void {
    this.emitter.emit('list', { snapshots: this.objects(), ...meta });
  }

  /** Emits `current` when the current index or its object is not the one last published. */
  private publishCurrent(meta: EventMeta): void {
    const snapshot = this.resolveCurrent();
    const last = this.published;
    if (last.index === this.currentId && last.snapshot === snapshot) {
      return;
    }
    this.published = { index: this.currentId, snapshot };
    this.emitter.emit('current', { snapshot, index: this.currentId, previous: last.index, ...meta });
  }

  /** A pedalboard is loading: the snapshots of the previous one are gone. */
  private invalidate(meta: EventMeta): void {
    const had = this.known || this.entries.length > 0;
    for (const entry of this.entries) {
      this.retire(entry);
    }
    this.entries = [];
    this.known = false;
    this.currentId = null;
    if (had) {
      this.emitList(meta);
    }
    this.publishCurrent(meta);
  }

  /** The device reported `pedal_snapshot <index> <name...>` (a snapshot load by anyone). */
  private reported(args: string): void {
    const space = args.indexOf(' ');
    const index = parseInt(space < 0 ? args : args.slice(0, space), 10);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    const name = space < 0 ? '' : args.slice(space + 1);
    const meta: EventMeta = this.loadingFor ? { origin: 'local', source: this.loadingFor.source } : { origin: 'remote' };
    this.currentId = index;
    if (this.known) {
      const entry = this.entry(index);
      if (!entry) {
        this.known = false; // a snapshot this client has not seen: the next list() reads them again
      } else if (entry.name !== name && name !== '') {
        entry.name = name;
        this.emitList(meta);
      }
    }
    this.publishCurrent(meta);
  }
}

function localMeta(options: WriteOptions): EventMeta {
  return { origin: 'local', source: options.source };
}

function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.trim() !== '';
}

function blankName(): ModUiError {
  return new ModUiError('The snapshot name must be a non-empty string');
}
