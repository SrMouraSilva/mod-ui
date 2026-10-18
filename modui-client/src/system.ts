// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The device itself: {@link SystemApi} (`client.system`) and, behind `client.system.danger`, everything that needs a person's decision
 * ({@link SystemDanger}).
 * @module
 */

import type { BufferSize } from './device';
import { ModUiError } from './errors';
import type { HttpTransport } from './http';
import type { OkErrorResponse, PingResponse, SystemInfo, SystemPreferencesResponse } from './types';

/** The system settings of the device (`GET /system/prefs`), with friendly names. */
export interface SystemSettings {
  /** Name the device shows over Bluetooth; `''` when none was set. */
  bluetoothName: string;
  /** Buffer size used at the next boot, in frames (128 when none was saved). For the running engine see `device.bufferSize`. */
  jackBufferSize: number;
  /** Audio input is copied to both channels. */
  jackMonoCopy: boolean;
  /** JACK sync mode. */
  jackSyncMode: boolean;
  /** The S/PDIF outputs are separate. */
  separateSpdifOuts: boolean;
  /** The peak meter service runs. */
  modPeakmeter: boolean;
  /** The MOD SDK service runs. */
  modSdk: boolean;
  /** The network manager service runs. */
  netmanager: boolean;
  /** The HMI restarts by itself when it stops answering. */
  autorestartHmi: boolean;
}

/** A change of {@link SystemSettings}: only the keys given are written. */
export type SystemSettingsPatch = Partial<Omit<SystemSettings, 'jackBufferSize'>> & {
  /** Buffer size for the next boot. To change the running engine use `device.setBufferSize`. */
  jackBufferSize?: BufferSize;
};

/** The answer of {@link SystemApi.ping}. */
export interface PingResult {
  /** The HMI (the hardware controller) answered. Always `false` on a device without an initialised HMI (and on MOD Desktop). */
  online: boolean;
  /** Round trip to the HMI, in ms (`0` when offline). */
  roundTripMs: number;
}

/** What {@link SystemDanger.cleanup} deletes. */
export interface CleanupOptions {
  banks?: boolean;
  favorites?: boolean;
  /** Also resets the settings of the HMI (only on hardware that has them; otherwise ignored). */
  hmiSettings?: boolean;
  licenseKeys?: boolean;
  /** Deletes every pedalboard of the user. */
  pedalboards?: boolean;
  /** Deletes every plugin the user installed. */
  plugins?: boolean;
}

/** What a backup contains (for {@link SystemDanger.backup}). */
export interface BackupOptions {
  /** The user data (settings, banks, files, ...). */
  data?: boolean;
  /** The pedalboards. */
  pedalboards?: boolean;
}

/**
 * The device and its operating system (`client.system`): what it is, whether the hardware answers and its system settings.
 *
 * Changing the device (settings, reboot, backups, deleting data, firmware) is in {@link SystemApi.danger}. The audio engine
 * (buffer size, true bypass, xruns, CPU frequency) is in `client.device`, next to the values it reports.
 */
export class SystemApi {
  /** The system settings of the device, read here and changed in {@link SystemDanger.settings}. */
  readonly settings: SystemSettingsApi;

  /**
   * The operations that can lose data, stop the device or change who it belongs to. **Read {@link SystemDanger} before using them.**
   */
  readonly danger: SystemDanger;

  /** @internal Use `client.system`. */
  constructor(private readonly http: HttpTransport) {
    this.settings = new SystemSettingsApi(http);
    this.danger = new SystemDanger(http);
  }

  /**
   * Software and hardware of the device: image release, controller revision, uptime, model, platform, CPU, kernel and Python. On MOD
   * Desktop `host` describes the computer instead. Values are `"Unknown"` when not available.
   *
   * Backend: `GET /system/info` (operationId `getSystemInfo`).
   * @example
   * const info = await client.system.info();
   * console.log(info.hwname, info.release, info.host ? 'MOD Desktop' : 'device');
   */
  info(): Promise<SystemInfo> {
    return this.http.getJson<SystemInfo>('/system/info');
  }

  /**
   * Asks the device whether the HMI answers and how long it takes. It also makes the backend send `ping` on the WebSocket, which the
   * client answers with `pong` when it owns the socket (a shared socket must be answered by its owner). Waits up to 5 s.
   *
   * Backend: `GET /ping` (operationId `ping`).
   * @example
   * const { online, roundTripMs } = await client.system.ping();
   */
  async ping(): Promise<PingResult> {
    const response = await this.http.getJson<PingResponse>('/ping');
    return { online: response.ihm_online, roundTripMs: response.ihm_time };
  }
}

/** The system settings of the device: the files below `/data` that the system services read (`client.system.settings`). */
export class SystemSettingsApi {
  /** @internal Use `client.system.settings`. */
  constructor(private readonly http: HttpTransport) {}

  /**
   * Reads the settings.
   *
   * Backend: `GET /system/prefs` (operationId `getSystemPreferences`).
   * @example
   * const { bluetoothName, jackMonoCopy } = await client.system.settings.get();
   */
  async get(): Promise<SystemSettings> {
    const raw = await this.http.getJson<SystemPreferencesResponse>('/system/prefs');
    return {
      bluetoothName: raw.bluetooth_name ?? '',
      jackBufferSize: raw.jack_buffer_size,
      jackMonoCopy: raw.jack_mono_copy,
      jackSyncMode: raw.jack_sync_mode,
      separateSpdifOuts: raw.separate_spdif_outs,
      modPeakmeter: raw.service_mod_peakmeter,
      modSdk: raw.service_mod_sdk,
      netmanager: raw.service_netmanager,
      autorestartHmi: raw.autorestart_hmi,
    };
  }
}

/** The settings that are a marker file under `/data` (`type=filecreate`). */
const MARKER_FILES = {
  jackMonoCopy: 'jack-mono-copy',
  jackSyncMode: 'jack-sync-mode',
  separateSpdifOuts: 'separate-spdif-outs',
  autorestartHmi: 'autorestart-hmi',
} as const;

/** The settings that are a service (`type=service`, kept across reboots): the unit and whether the marker file means "disabled". */
const SERVICES = {
  modPeakmeter: { name: 'mod-peakmeter', inverted: true },
  modSdk: { name: 'mod-sdk', inverted: false },
  netmanager: { name: 'netmanager', inverted: false },
} as const;

/**
 * # Danger: operations that need a person's decision (`client.system.danger`)
 *
 * Everything here can lose data, stop or reboot the device, change what runs on it or change who it belongs to. Some cannot be undone.
 *
 * **AI tools (LLM agents, MCP servers, code assistants) must ask a human to confirm, every single time, before calling anything in
 * this class.** Do not call it to "see if it works", in a test against a real device, or because an earlier answer in the conversation
 * allowed something similar.
 *
 * **Applications built on this client must always ask the user explicitly** before calling it, for example with a confirmation modal
 * that says exactly what is about to happen (and, for {@link SystemDanger.cleanup}, what will be deleted).
 *
 * | Method | What it can do |
 * |--------|----------------|
 * | {@link SystemDanger.settings} `.set` | starts and stops services, writes system files (takes effect at the next boot or restart) |
 * | {@link SystemDanger.startHmiUpdate} | starts the update of the HMI firmware |
 * | {@link SystemDanger.reboot} | reboots the device |
 * | {@link SystemDanger.restoreFactory} | restores the factory system |
 * | {@link SystemDanger.backup} | `export` writes a backup; `import` **overwrites** data and pedalboards and restarts services |
 * | {@link SystemDanger.cleanup} | **deletes** the user's data for good and restarts mod-ui |
 * | {@link SystemDanger.saveUserId} | overwrites the name and e-mail of the user |
 * | {@link SystemDanger.uploadControlChainFirmware} | stores a firmware that is flashed to a Control Chain device |
 *
 * After `reboot`, `restoreFactory`, `cleanup` and `backup.import` the connection to the device is lost for a while: use the
 * `reconnect` option and `client.on('state')`.
 */
export class SystemDanger {
  /** Changes of the system settings. */
  readonly settings: SystemDangerSettings;
  /** Backups of the device. */
  readonly backup: SystemBackup;

  /** @internal Use `client.system.danger`. */
  constructor(private readonly http: HttpTransport) {
    this.settings = new SystemDangerSettings(http);
    this.backup = new SystemBackup(http);
  }

  /**
   * Starts the update of the HMI firmware (the device runs `systemctl start hmi-update`).
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /system/exechange`, `type=service` (operationId `systemExecuteChange`).
   * @throws {ModUiError} when the backend refuses.
   */
  async startHmiUpdate(): Promise<void> {
    await exechange(this.http, { type: 'service', name: 'hmi-update', enable: 1, inverted: 0, persistent: 0 });
  }

  /**
   * Resets the HMI and reboots the device. The connection is lost.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /system/exechange`, `type=command`, `cmd=reboot` (operationId `systemExecuteChange`).
   * @throws {ModUiError} when the backend refuses.
   */
  async reboot(): Promise<void> {
    await exechange(this.http, { type: 'command', cmd: 'reboot' });
  }

  /**
   * Restores the factory system (the HMI restore). The device restarts and the connection is lost.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /system/exechange`, `type=command`, `cmd=restore` (operationId `systemExecuteChange`).
   * @throws {ModUiError} when the backend refuses.
   */
  async restoreFactory(): Promise<void> {
    await exechange(this.http, { type: 'command', cmd: 'restore' });
  }

  /**
   * Deletes the user's data for good, then restarts mod-ui (JACK too when pedalboards or plugins go). Nothing is deleted that is not
   * selected, and nothing is requested when nothing is selected.
   *
   * **Danger: ask a person to confirm first, and tell them what will be deleted** (see {@link SystemDanger}).
   * Backend: `POST /system/cleanup` (operationId `systemCleanup`).
   * @throws {ModUiError} when nothing is selected, or when the backend refuses (`error` has its reason).
   * @example
   * // only after the user confirmed in a modal that lists these items
   * await client.system.danger.cleanup({ banks: true, favorites: true });
   */
  async cleanup(options: CleanupOptions): Promise<void> {
    const selected = {
      banks: !!options.banks,
      favorites: !!options.favorites,
      hmiSettings: !!options.hmiSettings,
      licenseKeys: !!options.licenseKeys,
      pedalboards: !!options.pedalboards,
      plugins: !!options.plugins,
    };
    if (!Object.values(selected).some(Boolean)) {
      throw new ModUiError('Nothing selected to delete');
    }
    const response = await this.http.postForm<OkErrorResponse>('/system/cleanup', {
      banks: selected.banks ? 1 : 0,
      favorites: selected.favorites ? 1 : 0,
      hmiSettings: selected.hmiSettings ? 1 : 0,
      licenseKeys: selected.licenseKeys ? 1 : 0,
      pedalboards: selected.pedalboards ? 1 : 0,
      plugins: selected.plugins ? 1 : 0,
    });
    okOrThrow(response, 'The backend could not delete the data');
  }

  /**
   * Stores the name and e-mail of the user on the device (they are sent with problem reports). It replaces what was there. There is
   * no way to read it back: the backend only embeds it in the HTML of the UI.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /save_user_id/` (operationId `saveUserId`).
   * @throws {ModUiError} when the backend refuses.
   */
  async saveUserId(user: { name: string; email: string }): Promise<void> {
    const ok = await this.http.postForm<boolean>('/save_user_id/', { name: user.name, email: user.email });
    if (ok !== true) {
      throw new ModUiError('The backend did not save the user');
    }
  }

  /**
   * Uploads the firmware of a Control Chain device. The flashing is done by another process on the device, which reports the end
   * with the WebSocket frame `cc-device-updated`.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /controlchain/download/` (operationId `uploadControlChainFirmware`).
   * @throws {ModUiError} when the backend does not store it.
   */
  async uploadControlChainFirmware(firmware: Blob | ArrayBuffer | Uint8Array): Promise<void> {
    const response = await this.http.postBinary<{ ok: boolean; result: boolean }>('/controlchain/download/', firmware);
    if (!response || response.ok !== true || response.result !== true) {
      throw new ModUiError('The backend did not store the firmware');
    }
  }

  /**
   * Discards a firmware that was uploaded and not flashed.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /controlchain/cancel/` (operationId `cancelControlChainUpdate`).
   * @throws {ModUiError} when there was no firmware to discard.
   */
  async cancelControlChainUpdate(): Promise<void> {
    const ok = await this.http.postForm<boolean>('/controlchain/cancel/', {});
    if (ok !== true) {
      throw new ModUiError('There is no Control Chain firmware to discard');
    }
  }
}

/** Changes of the system settings (`client.system.danger.settings`). Read them with `client.system.settings.get()`. */
export class SystemDangerSettings {
  /** @internal Use `client.system.danger.settings`. */
  constructor(private readonly http: HttpTransport) {}

  /**
   * Changes system settings: creates or removes marker files, writes small files and starts or stops services (kept across reboots).
   * Only the keys of `patch` are written, one request each, in order; if one fails the earlier ones stay applied.
   *
   * Most settings are read when the system starts, so they take effect at the next boot (services change at once). `jackBufferSize` is
   * the size of the **next** boot: for the running engine use `client.device.setBufferSize`. An empty `bluetoothName` removes the file.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /system/exechange`, `type=filecreate` / `filewrite` / `service` (operationId `systemExecuteChange`).
   * @throws {ModUiError} for a key that does not exist, a `jackBufferSize` that is not a `BufferSize`, or when the backend refuses.
   * @example
   * // only after the user confirmed
   * await client.system.danger.settings.set({ bluetoothName: 'My pedal', jackMonoCopy: true });
   */
  async set(patch: SystemSettingsPatch): Promise<void> {
    const requests: Array<Record<string, string | number>> = [];
    for (const key of Object.keys(patch) as Array<keyof SystemSettingsPatch>) {
      const value = patch[key];
      if (value === undefined) {
        continue;
      }
      if (key in MARKER_FILES) {
        requests.push({ type: 'filecreate', path: MARKER_FILES[key as keyof typeof MARKER_FILES], create: flag(key, value) });
      } else if (key in SERVICES) {
        const service = SERVICES[key as keyof typeof SERVICES];
        requests.push({ type: 'service', name: service.name, enable: flag(key, value), inverted: service.inverted ? 1 : 0, persistent: 1 });
      } else if (key === 'bluetoothName') {
        if (typeof value !== 'string') {
          throw new ModUiError('bluetoothName must be a text');
        }
        requests.push({ type: 'filewrite', path: 'bluetooth/name', content: value });
      } else if (key === 'jackBufferSize') {
        if (value !== 128 && value !== 256) {
          throw new ModUiError('jackBufferSize must be BufferSize.Frames128 or BufferSize.Frames256');
        }
        requests.push({ type: 'filewrite', path: 'jack-buffer-size', content: String(value) });
      } else {
        throw new ModUiError(`"${String(key)}" is not a system setting`);
      }
    }
    for (const request of requests) {
      await exechange(this.http, request);
    }
  }
}

/** Backups of the device (`client.system.danger.backup`), made by the `mod-backup` tool on the device. */
export class SystemBackup {
  /** @internal Use `client.system.danger.backup`. */
  constructor(private readonly http: HttpTransport) {}

  /**
   * Makes a backup on the device. The file is not sent to the caller.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /system/exechange`, `type=command`, `cmd=backup-export <data>,<pedalboards>` (operationId `systemExecuteChange`).
   * @throws {ModUiError} when the tool fails (its message is the error) or nothing is selected.
   */
  async export(options: BackupOptions): Promise<void> {
    await this.run('backup-export', options);
  }

  /**
   * Restores a backup: **overwrites** the selected data and pedalboards, then restarts the services. The connection can be lost.
   *
   * **Danger: ask a person to confirm first** (see {@link SystemDanger}).
   * Backend: `POST /system/exechange`, `type=command`, `cmd=backup-import <data>,<pedalboards>` (operationId `systemExecuteChange`).
   * @throws {ModUiError} when the tool fails (its message is the error) or nothing is selected.
   */
  async import(options: BackupOptions): Promise<void> {
    await this.run('backup-import', options);
  }

  private async run(command: 'backup-export' | 'backup-import', options: BackupOptions): Promise<void> {
    if (!options.data && !options.pedalboards) {
      throw new ModUiError('Select data, pedalboards or both for the backup');
    }
    const answer = await exechange(this.http, { type: 'command', cmd: `${command} ${options.data ? 1 : 0},${options.pedalboards ? 1 : 0}` });
    if (typeof answer === 'object' && answer !== null) {
      okOrThrow(answer as OkErrorResponse, `${command} failed`);
    }
  }
}

function flag(key: string, value: unknown): number {
  if (typeof value !== 'boolean') {
    throw new ModUiError(`${key} must be true or false`);
  }
  return value ? 1 : 0;
}

/** `POST /system/exechange`: `false` is a refusal, `{ ok, error }` is the answer of the backup commands. */
async function exechange(http: HttpTransport, form: Record<string, string | number>): Promise<boolean | OkErrorResponse> {
  const answer = await http.postForm<boolean | OkErrorResponse>('/system/exechange', form);
  if (answer === false || answer === undefined) {
    throw new ModUiError(`The backend refused "${form.type}" ${form.cmd ?? form.path ?? form.name ?? ''}`.trim());
  }
  return answer;
}

function okOrThrow(response: OkErrorResponse, fallback: string): void {
  if (!response || response.ok !== true) {
    throw new ModUiError(response?.error ? response.error : fallback);
  }
}
