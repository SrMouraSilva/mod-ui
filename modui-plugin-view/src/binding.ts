// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a view reads and writes its values (internal): a plugin of the running pedalboard through `modui-client`, or local memory for a
 * preview.
 * @module
 */

import type { PatchValue, PluginInstance, PluginPresetInfo, Preset } from 'modui-client';
import { PluginViewError } from './types';

/** What the backend tells the view. Every callback is for a change the view did **not** make itself. */
export interface BackendListener {
  param(symbol: string, value: number): void;
  active(active: boolean): void;
  patch(uri: string, value: PatchValue | undefined): void;
  preset(uri: string | null): void;
  presetList(presets: PluginPresetInfo[]): void;
  removed(reason: 'removed' | 'cleared' | 'reloaded'): void;
}

/** Preset operations of a live view, by preset URI. */
export interface PresetBackend {
  list(): Promise<PluginPresetInfo[]>;
  load(uri: string): Promise<void>;
  create(name: string): Promise<void>;
  save(uri: string, name?: string): Promise<void>;
  delete(uri: string): Promise<void>;
}

/** Reads and writes of a view. */
export interface ViewBackend {
  readonly live: boolean;
  readonly instance: PluginInstance | null;
  portValue(symbol: string, fallback: number): number;
  active(): Promise<boolean>;
  patchValue(uri: string): PatchValue | undefined;
  preset(): string | null;
  setPort(symbol: string, value: number): Promise<void>;
  setActive(active: boolean): Promise<void>;
  setPatch(uri: string, value: PatchValue): Promise<void>;
  refreshPatch(uri: string): Promise<void>;
  readonly presets: PresetBackend | null;
  /** Starts the notifications; returns the function that stops them. */
  subscribe(listener: BackendListener): () => void;
}

function presetInfo(preset: Preset): PluginPresetInfo {
  return { valid: true, uri: preset.uri, label: preset.label, path: preset.bundlepath ?? '' };
}

/**
 * A plugin of the running pedalboard. Writes carry `{ source }` (the view) and the subscriptions skip that source, so a view never hears
 * back about its own changes, while every other change (classic UI, HMI, other clients, other code of the page) reaches it.
 */
export class LiveBackend implements ViewBackend {
  readonly live = true;
  readonly presets: PresetBackend;

  constructor(readonly instance: PluginInstance, private readonly source: object) {
    const presets = instance.presets;
    const find = async (uri: string): Promise<Preset> => {
      const preset = (await presets.list()).find((item) => item.uri === uri);
      if (!preset) {
        throw new PluginViewError(`No preset ${uri}`);
      }
      return preset;
    };
    this.presets = {
      list: async () => (await presets.list()).map(presetInfo),
      load: (uri) => presets.load(uri, { source }),
      create: async (name) => {
        await presets.create(name, { source });
      },
      save: async (uri, name) => {
        await presets.save(await find(uri), name, { source });
      },
      delete: async (uri) => presets.delete(await find(uri), { source }),
    };
  }

  portValue(symbol: string, fallback: number): number {
    return this.instance.params.get(symbol)?.value ?? fallback;
  }

  active(): Promise<boolean> {
    return this.instance.isActive();
  }

  patchValue(uri: string): PatchValue | undefined {
    return this.instance.patchParams.get(uri)?.value;
  }

  preset(): string | null {
    return this.instance.preset;
  }

  setPort(symbol: string, value: number): Promise<void> {
    const param = this.instance.params.get(symbol);
    return param ? param.setValue(value, { source: this.source }) : Promise.reject(new PluginViewError(`No control port "${symbol}"`));
  }

  setActive(active: boolean): Promise<void> {
    return this.instance.setActive(active, { source: this.source });
  }

  setPatch(uri: string, value: PatchValue): Promise<void> {
    const param = this.instance.patchParams.get(uri);
    return param ? param.setValue(value, { source: this.source }) : Promise.reject(new PluginViewError(`No patch parameter "${uri}"`));
  }

  async refreshPatch(uri: string): Promise<void> {
    const param = this.instance.patchParams.get(uri);
    if (!param) {
      throw new PluginViewError(`No patch parameter "${uri}"`);
    }
    await param.refresh({ source: this.source });
  }

  subscribe(listener: BackendListener): () => void {
    const instance = this.instance;
    const options = { ignoreSource: this.source };
    const offs = [
      instance.on('param', ({ param, value }) => listener.param(param.symbol, value), options),
      instance.on('active', ({ active }) => listener.active(active), options),
      instance.on('patch', ({ uri, value }) => listener.patch(uri, value), options),
      instance.on('preset', ({ preset }) => listener.preset(preset), options),
      instance.on('removed', ({ reason }) => listener.removed(reason)),
      instance.presets.on('list', ({ presets }) => listener.presetList(presets.map(presetInfo))),
    ];
    return () => offs.forEach((off) => off());
  }
}

/** A preview: values live in the view only; nothing is sent anywhere and nothing is ever announced. */
export class PreviewBackend implements ViewBackend {
  readonly live = false;
  readonly instance = null;
  readonly presets = null;
  private readonly values = new Map<string, number>();
  private readonly patches = new Map<string, PatchValue>();

  constructor(values: Record<string, number> = {}, private bypassed = false) {
    for (const symbol of Object.keys(values)) {
      this.values.set(symbol, values[symbol]);
    }
  }

  portValue(symbol: string, fallback: number): number {
    return this.values.get(symbol) ?? fallback;
  }

  active(): Promise<boolean> {
    return Promise.resolve(!this.bypassed);
  }

  patchValue(uri: string): PatchValue | undefined {
    return this.patches.get(uri);
  }

  preset(): string | null {
    return null;
  }

  setPort(symbol: string, value: number): Promise<void> {
    this.values.set(symbol, value);
    return Promise.resolve();
  }

  setActive(active: boolean): Promise<void> {
    this.bypassed = !active;
    return Promise.resolve();
  }

  setPatch(uri: string, value: PatchValue): Promise<void> {
    this.patches.set(uri, value);
    return Promise.resolve();
  }

  refreshPatch(): Promise<void> {
    return Promise.resolve();
  }

  subscribe(): () => void {
    return () => undefined;
  }
}
