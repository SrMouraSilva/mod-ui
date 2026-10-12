// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The banks of the device: {@link BanksApi} (`client.banks`) and {@link Bank}.
 *
 * A bank is an ordered collection of pedalboards; the hardware uses banks to navigate pedalboards. The backend stores only the user's
 * banks, as one list that is replaced as a whole, so every change here is a read followed by a write of that list.
 * @module
 */

import { ModUiError } from './errors';
import type { HttpTransport } from './http';
import { PedalboardReference, sameBundle, type PedalboardsApi } from './pedalboards';
import type { BankInput, BankPedalboardInput, BankSummary } from './types';

/** What {@link BanksApi.replaceAll} takes for a bank: a {@link Bank}, or plain data. */
export interface BankData {
  title: string;
  /** Pedalboards of the library, or `{ bundle, title }` as the backend stores them. */
  pedalboards: ReadonlyArray<PedalboardReference | BankPedalboardInput>;
}

/** Options of {@link Bank.add}. */
export interface AddToBankOptions {
  /** Position to insert at, from 0 to the number of pedalboards. Default: the end. */
  at?: number;
  /**
   * A factory pedalboard cannot go into a user bank as it is; with `copyFactory` it is copied into the user's library first
   * ({@link PedalboardReference.copy}) and the copy goes into the bank, as the classic UI does. Default: refuse.
   */
  copyFactory?: boolean;
}

/** A bank as read from the backend, with the properties the client does not know kept for the next write. */
interface BankRecord {
  title: string;
  pedalboards: PedalboardReference[];
  extras: Record<string, unknown>;
}

/**
 * A bank of the device, as it was when it was read. A **value**: it does not follow changes made by others; read the banks again
 * ({@link BanksApi.list}) to see them. The editing methods read the banks from the device again, change that fresh copy, write it
 * and then update **this** object, so an old object still edits the current state of its bank (found by its title).
 *
 * Nothing here selects a bank on the hardware; to play a pedalboard of a bank use `client.device.load(bank.pedalboards[0])`.
 *
 * @example
 * const [bank] = await client.banks.list();
 * await bank.rename('Live set');
 * await bank.add(mine[0]);                 // appended
 * await bank.move(0, 2);
 * await client.device.load(bank.pedalboards[0]);
 */
export class Bank {
  private record: BankRecord;
  private position: number;

  /** @internal Built by {@link BanksApi}. */
  constructor(record: BankRecord, position: number, private readonly api: BanksApi) {
    this.record = record;
    this.position = position;
  }

  /** The title, unique among the banks (ignoring case). */
  get title(): string {
    return this.record.title;
  }

  /** Position among the banks, from 0, when it was last read or written. */
  get index(): number {
    return this.position;
  }

  /** The pedalboards, in order. A pedalboard can appear more than once. A new array after every change of this object. */
  get pedalboards(): readonly PedalboardReference[] {
    return this.record.pedalboards;
  }

  /** @internal Properties of the stored bank that the client does not interpret. */
  get extras(): Record<string, unknown> {
    return this.record.extras;
  }

  /** @internal */
  update(record: BankRecord, position: number): void {
    this.record = { ...record, pedalboards: record.pedalboards.slice() };
    this.position = position;
  }

  /**
   * Renames the bank.
   *
   * Backend: `GET /banks` and `POST /banks/save` (operationIds `listBanks`, `saveBanks`).
   * @throws {ModUiError} when the title is blank or another bank has it (ignoring case), or the bank no longer exists.
   * @example
   * await bank.rename('Live set');
   */
  rename(title: string): Promise<void> {
    return this.api.edit(this, (banks, at) => {
      const clean = checkTitle(title);
      checkTitleFree(banks, clean, at);
      banks[at].title = clean;
    });
  }

  /**
   * Deletes the bank (its pedalboards stay in the library). To take one pedalboard out of the bank use {@link Bank.remove}.
   *
   * Backend: `GET /banks` and `POST /banks/save`.
   * @throws {ModUiError} when the bank no longer exists.
   * @example
   * await bank.delete();
   */
  delete(): Promise<void> {
    return this.api.edit(this, (banks, at) => {
      banks.splice(at, 1);
    });
  }

  /**
   * Adds a pedalboard.
   *
   * Backend: `GET /banks` and `POST /banks/save`; with `copyFactory`, `GET /pedalboard/info/`, `GET /pedalboard/factorycopy/` and
   * `GET /pedalboard/list` first. If the bank cannot be written after the copy, the copy stays in the library.
   * @param pedalboard A pedalboard of the library.
   * @throws {ModUiError} when it is a factory or the default pedalboard (and `copyFactory` is off), is broken, `at` is out of
   *   range, or the bank no longer exists.
   * @example
   * await bank.add(reference, { at: 0 });
   * await bank.add(factoryReference, { copyFactory: true });
   */
  async add(pedalboard: PedalboardReference, options: AddToBankOptions = {}): Promise<void> {
    let target = pedalboard;
    if (options.copyFactory && pedalboard instanceof PedalboardReference && (pedalboard.factory || pedalboard.isDefault)) {
      target = await pedalboard.copy();
    }
    checkPedalboard(target);
    return this.api.edit(this, (banks, at) => {
      const list = banks[at].pedalboards;
      const place = options.at ?? list.length;
      if (!Number.isInteger(place) || place < 0 || place > list.length) {
        throw new ModUiError(`The position ${place} is out of range: the bank has ${list.length} pedalboards`);
      }
      list.splice(place, 0, target);
    });
  }

  /**
   * Takes a pedalboard out of the bank (it stays in the library).
   *
   * Backend: `GET /banks` and `POST /banks/save`.
   * @param pedalboard The position, or a pedalboard (its first occurrence is removed).
   * @throws {ModUiError} when the position is out of range or the pedalboard is not in the bank.
   * @example
   * await bank.remove(0);
   */
  remove(pedalboard: number | PedalboardReference): Promise<void> {
    return this.api.edit(this, (banks, at) => {
      const list = banks[at].pedalboards;
      const place =
        typeof pedalboard === 'number'
          ? pedalboard
          : list.findIndex((item) => sameBundle(item.bundlepath, pedalboard && pedalboard.bundlepath));
      if (!Number.isInteger(place) || place < 0 || place >= list.length) {
        throw new ModUiError(
          typeof pedalboard === 'number' ? `The position ${pedalboard} is out of range: the bank has ${list.length} pedalboards` : 'The pedalboard is not in the bank',
        );
      }
      list.splice(place, 1);
    });
  }

  /**
   * Moves a pedalboard inside the bank.
   *
   * Backend: `GET /banks` and `POST /banks/save`.
   * @param from Current position.
   * @param to Position it ends at.
   * @throws {ModUiError} when a position is out of range.
   * @example
   * await bank.move(0, 2); // the first one becomes the third
   */
  move(from: number, to: number): Promise<void> {
    return this.api.edit(this, (banks, at) => {
      const list = banks[at].pedalboards;
      for (const place of [from, to]) {
        if (!Number.isInteger(place) || place < 0 || place >= list.length) {
          throw new ModUiError(`The position ${place} is out of range: the bank has ${list.length} pedalboards`);
        }
      }
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
    });
  }

  /**
   * Replaces the content of the bank (it can be empty).
   *
   * Backend: `GET /banks` and `POST /banks/save`.
   * @throws {ModUiError} when a pedalboard is a factory or default one, or broken.
   * @example
   * await bank.setPedalboards([b, a]);
   */
  setPedalboards(pedalboards: readonly PedalboardReference[]): Promise<void> {
    let list: PedalboardReference[];
    try {
      list = Array.from(pedalboards, (pedalboard) => checkPedalboard(pedalboard));
    } catch (error) {
      return Promise.reject(error);
    }
    return this.api.edit(this, (banks, at) => {
      banks[at].pedalboards = list;
    });
  }
}

/**
 * The banks of the device (`client.banks`).
 *
 * The backend keeps **user banks only**, as a single list that every write replaces. Because of that:
 * - reading is not side-effect free: `GET /banks` drops from the banks the pedalboards that no longer exist or that are broken (a
 *   plugin is missing), renames duplicate bank titles, and saves the cleaned list;
 * - the bank methods read the list again, change it and write it back (a single client never interleaves its own calls); two writers
 *   at the same moment (another tab, the HMI) are last-write-wins;
 * - a bank is found by its title, which is unique ignoring case; the client refuses duplicates instead of letting the backend rename them;
 * - a pedalboard deleted with `reference.delete()` leaves every bank on the device; banks read before are stale.
 *
 * @example
 * const banks = await client.banks.list();
 * const bank = await client.banks.create('Live set', [mine[0], mine[1]]);
 * await client.device.load(bank.pedalboards[0]);
 */
export class BanksApi {
  private tail: Promise<unknown> = Promise.resolve();

  /** @internal Use `client.banks`. */
  constructor(private readonly http: HttpTransport, private readonly pedalboards: PedalboardsApi) {}

  /**
   * Lists the user's banks, each with its pedalboards as library entries (usable with `device.load()`).
   *
   * Backend: `GET /banks` (operationId `listBanks`). **Side effect on the device**: missing and broken pedalboards are removed from
   * the banks for good (a pedalboard that is only temporarily broken is lost from its bank).
   * @example
   * for (const bank of await client.banks.list()) console.log(bank.title, bank.pedalboards.map((pb) => pb.title));
   */
  list(): Promise<Bank[]> {
    return this.queue(async () => {
      const records = await this.read();
      return records.map((record, index) => new Bank(record, index, this));
    });
  }

  /**
   * One bank by its title (ignoring case), or `undefined`. Reads the list ({@link BanksApi.list}).
   * @example
   * const bank = await client.banks.get('Live set');
   */
  async get(title: string): Promise<Bank | undefined> {
    const wanted = String(title).toUpperCase();
    return (await this.list()).find((bank) => bank.title.toUpperCase() === wanted);
  }

  /**
   * Creates a bank at the end of the list.
   *
   * Backend: `GET /banks` and `POST /banks/save`.
   * @param title Its title. Surrounding spaces are removed.
   * @param pedalboards Its content (library entries; not factory, not broken).
   * @throws {ModUiError} when the title is blank or taken (ignoring case), or a pedalboard is refused.
   * @example
   * const bank = await client.banks.create('Live set', [mine[0]]);
   */
  create(title: string, pedalboards: readonly PedalboardReference[] = []): Promise<Bank> {
    let list: PedalboardReference[];
    try {
      checkTitle(title);
      list = Array.from(pedalboards, (pedalboard) => checkPedalboard(pedalboard));
    } catch (error) {
      return Promise.reject(error);
    }
    return this.queue(async () => {
      const banks = await this.read();
      const clean = checkTitle(title);
      checkTitleFree(banks, clean, -1);
      banks.push({ title: clean, pedalboards: list, extras: {} });
      await this.write(banks);
      return new Bank(banks[banks.length - 1], banks.length - 1, this);
    });
  }

  /**
   * Moves a bank to another position (the hardware lists banks in this order).
   *
   * Backend: `GET /banks` and `POST /banks/save`.
   * @param bank A {@link Bank} or its title.
   * @param toIndex The position it ends at.
   * @returns The banks after the move (new objects; the one passed in is updated too).
   * @throws {ModUiError} when the bank no longer exists or the position is out of range.
   * @example
   * await client.banks.move('Live set', 0);
   */
  move(bank: Bank | string, toIndex: number): Promise<Bank[]> {
    return this.queue(async () => {
      const banks = await this.read();
      const from = this.find(banks, bank);
      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= banks.length) {
        throw new ModUiError(`The position ${toIndex} is out of range: there are ${banks.length} banks`);
      }
      const [moved] = banks.splice(from, 1);
      banks.splice(toIndex, 0, moved);
      await this.write(banks);
      this.adopt(bank, moved, banks);
      return banks.map((record, index) => new Bank(record, index, this));
    });
  }

  /**
   * Replaces **every** bank with `banks` (and deletes the ones left out). Low level: prefer the methods of {@link Bank} and {@link BanksApi.create}, which keep what
   * they do not change.
   *
   * Backend: `POST /banks/save` (operationId `saveBanks`); each pedalboard is stored as `{ bundle, title }`. Nothing is read first.
   * @param banks {@link Bank} objects or plain data.
   * @throws {ModUiError} when a title is blank or repeated (ignoring case), a pedalboard of the library is a factory or default one
   *   or broken, or the backend does not answer `true`.
   * @example
   * await client.banks.replaceAll([{ title: 'Live set', pedalboards: [mine[0]] }]);
   */
  replaceAll(banks: ReadonlyArray<Bank | BankData>): Promise<void> {
    let payload: BankInput[];
    try {
      payload = banks.map((bank) => {
        const title = checkTitle(bank.title);
        const extras = bank instanceof Bank ? bank.extras : extrasOf(bank);
        const pedalboards = Array.from(bank.pedalboards, (item) =>
          item instanceof PedalboardReference ? serialize(checkPedalboard(item)) : checkInput(item),
        );
        return { ...extras, title, pedalboards };
      });
      const seen = new Set<string>();
      for (const bank of payload) {
        const key = bank.title.toUpperCase();
        if (seen.has(key)) {
          throw new ModUiError(`There are two banks titled "${bank.title}" (titles are compared ignoring case)`);
        }
        seen.add(key);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return this.queue(() => this.send(payload));
  }

  /** @internal The read-modify-write behind the methods of {@link Bank}. */
  edit(bank: Bank, change: (banks: BankRecord[], at: number) => void): Promise<void> {
    return this.queue(async () => {
      const banks = await this.read();
      const at = this.find(banks, bank);
      const edited = banks[at];
      change(banks, at);
      await this.write(banks);
      this.adopt(bank, edited, banks);
    });
  }

  // ------------------------------------------------------------------------------------------------------------------

  /** Runs `task` after the ones before it; a failure does not stop the later ones. */
  private queue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<BankRecord[]> {
    const banks = await this.http.getJson<BankSummary[]>('/banks');
    return (banks ?? []).map((bank) => {
      const { title, pedalboards, ...extras } = bank;
      return {
        title: String(title),
        pedalboards: (pedalboards ?? []).map((summary) => this.pedalboards.reference(summary)),
        extras,
      };
    });
  }

  private write(banks: BankRecord[]): Promise<void> {
    return this.send(banks.map((bank) => ({ ...bank.extras, title: bank.title, pedalboards: bank.pedalboards.map(serialize) })));
  }

  private async send(payload: BankInput[]): Promise<void> {
    const ok = await this.http.postJson<boolean>('/banks/save', payload);
    if (ok !== true) {
      throw new ModUiError('The backend did not save the banks');
    }
  }

  /** After a write: the `bank` object shows what was written (nothing to show when the bank was deleted). */
  private adopt(bank: Bank | string, edited: BankRecord, banks: BankRecord[]): void {
    const at = banks.indexOf(edited);
    if (typeof bank !== 'string' && at >= 0) {
      bank.update(edited, at);
    }
  }

  /** Position of `bank` (an object, found by its title, or a title) in `banks`. */
  private find(banks: BankRecord[], bank: Bank | string): number {
    const title = (typeof bank === 'string' ? bank : bank && bank.title).toUpperCase();
    const at = banks.findIndex((record) => record.title.toUpperCase() === title);
    if (at < 0) {
      throw new ModUiError(`The bank "${typeof bank === 'string' ? bank : bank.title}" no longer exists`);
    }
    return at;
  }
}

function checkTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new ModUiError('The bank title must be a non-empty string');
  }
  return title.trim();
}

function checkTitleFree(banks: BankRecord[], title: string, except: number): void {
  const key = title.toUpperCase();
  if (banks.some((bank, at) => at !== except && bank.title.toUpperCase() === key)) {
    throw new ModUiError(`There is already a bank titled "${title}" (titles are compared ignoring case)`);
  }
}

/** A pedalboard that can go into a user bank: from the library, not broken, not a factory or the default one. */
function checkPedalboard(pedalboard: PedalboardReference): PedalboardReference {
  if (!(pedalboard instanceof PedalboardReference)) {
    throw new ModUiError('Expected a pedalboard of the library (client.pedalboards.list())');
  }
  if (pedalboard.broken) {
    throw new ModUiError(`"${pedalboard.title}" is broken (a plugin is missing) and cannot go into a bank`);
  }
  if (pedalboard.factory || pedalboard.isDefault) {
    throw new ModUiError(
      `"${pedalboard.title}" is a factory or default pedalboard: copy it first (reference.copy(), or { copyFactory: true } in bank.add())`,
    );
  }
  return pedalboard;
}

function checkInput(item: BankPedalboardInput): BankPedalboardInput {
  if (!item || typeof item.bundle !== 'string' || item.bundle === '' || typeof item.title !== 'string') {
    throw new ModUiError('A pedalboard entry needs a bundle path and a title');
  }
  return { bundle: item.bundle, title: item.title };
}

function serialize(pedalboard: PedalboardReference): BankPedalboardInput {
  return { bundle: pedalboard.bundlepath, title: pedalboard.title };
}

/** The properties of plain bank data other than the ones the client writes itself. */
function extrasOf(bank: BankData): Record<string, unknown> {
  const { title: _title, pedalboards: _pedalboards, ...extras } = bank as unknown as Record<string, unknown>;
  return extras;
}
