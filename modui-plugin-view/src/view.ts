// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * {@link PluginView}: the icon and the settings panel of one plugin, alive. The port of `GUI` in `html/js/modgui.js` (`render`,
 * `assignControlFunctionality`, `setPortValue`, `setPortWidgetsValue`, `lv2PatchSet`, `selectPreset`, the preset buttons, `triggerJS`).
 * @module
 */

import type { PatchValue, PluginInfo, PluginInstance, PluginPresetInfo } from 'modui-client';
import type { BackendListener, ViewBackend } from './binding';
import { Emitter, type Off } from './emitter';
import type { MustacheRender } from './mustache';
import { ScriptRunner, type ScriptCallback, type ScriptFuncs } from './script';
import { sprintf } from './sprintf';
import type { ControlSpec, PreparedPlugin, ScalePoint } from './template-data';
import type { JQueryLike, ViewErrorContext, ViewEvents, ViewOrigin } from './types';
import { PluginViewError } from './types';
import { customFileUrl, rebaseUrls } from './urls';
import { BypassWidget, createWidget, type Widget, type WidgetHost } from './widgets';

/** Classes of icons made for the first MOD UI, which the classic UI refuses (it draws the default pedal instead). */
const RESERVED_CLASSES = [
  'mod-pedal-boxy',
  'mod-pedal-british',
  'mod-pedal-japanese',
  'mod-pedal-lata',
  'mod-combo-model-001',
  'mod-head-model-001',
  'mod-rack-model-001',
];

/** Port roles that get a type class, so the jacks are styled (`mod-audio-input`, ...). */
const PORT_CLASSES: [string, string][] = [
  ['input-audio-port', 'mod-audio-input'],
  ['output-audio-port', 'mod-audio-output'],
  ['input-midi-port', 'mod-midi-input'],
  ['output-midi-port', 'mod-midi-output'],
  ['input-cv-port', 'mod-cv-input'],
  ['output-cv-port', 'mod-cv-output'],
];

/** One control of the view: its description, its value and the elements that show it. */
interface Control {
  spec: ControlSpec;
  value: number | string;
  enabled: boolean;
  widgets: Widget[];
  fields: HTMLElement[];
  scalePoints: Map<string, ScalePoint> | null;
}

/** Everything {@link PluginView} is built from (internal; see `PluginViews.create`). */
export interface ViewContext {
  document: Document;
  baseUrl: string;
  info: PluginInfo;
  version: string;
  prepared: PreparedPlugin;
  iconTemplate: string;
  settingsTemplate: string;
  /** The template used when the icon uses reserved classes. */
  defaultIconTemplate: string;
  mustache: MustacheRender;
  backend: ViewBackend;
  /** Initial bypass state (`true`: bypassed). */
  bypassed: boolean;
  script: ScriptCallback | null;
  jQuery: JQueryLike | null;
  /** The last known value of an output port of this plugin. */
  output(symbol: string): number | undefined;
  /** Subscribes to the output values of this plugin. */
  onOutput(listener: (symbol: string, value: number) => void): Off;
  imageSize(url: string): Promise<{ width: number; height: number }>;
  promptName(title: string, current: string): Promise<string | null>;
  reportError(error: unknown, context: ViewErrorContext): void;
  onDestroy(view: PluginView): void;
}

function queryAll(root: Element, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/** `[attr="value"]` with the value quoted for CSS. */
function attr(name: string, value: string): string {
  return `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/** The value a widget shows for a patch value: booleans become `1` / `0`. */
function widgetValue(value: PatchValue | undefined): number | string | undefined {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * The GUI of one plugin: the pedal (`icon`) and its settings panel (`settings`), two plain elements that the application puts where it
 * wants. Built by {@link PluginViews.create}.
 *
 * A **live** view (created from a `PluginInstance`) follows the running pedalboard: any change of a control, the bypass, a patch parameter
 * or the current preset, made by anybody, moves its widgets; gestures on the view write through `modui-client` with `{ source: view }`.
 * A **preview** (created from a catalogue plugin) keeps its values to itself and sends nothing.
 *
 * Not supported yet: hardware addressing (the `mod-address` elements are hidden), dragging the block (`mod-role=drag-handle`), cables.
 *
 * @example
 * const view = await views.create(instance);
 * document.querySelector('#pedal')!.append(view.icon);
 * document.querySelector('#settings')!.append(view.settings);
 * view.on('change', ({ symbol, value, origin }) => console.log(symbol, value, origin));
 * view.on('close', () => settingsDialog.close());
 * // later
 * view.destroy();
 */
export class PluginView {
  /** The pedal: `<div class="mod-pedal" mod-instance="…">` with the rendered icon template. */
  readonly icon: HTMLElement;
  /** The settings panel: `<div class="mod-settings" mod-instance="…">` with the rendered settings template. */
  readonly settings: HTMLElement;
  /** The plugin URI. */
  readonly uri: string;
  /** The plugin description the view was built from. */
  readonly info: PluginInfo;
  /** The plugin of the running pedalboard, `null` for a preview. */
  readonly instance: PluginInstance | null;

  private readonly emitter = new Emitter<ViewEvents>();
  private readonly controls = new Map<string, Control>();
  private readonly parameters = new Map<string, Control>();
  private readonly cleanups: (() => void)[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly runner: ScriptRunner;
  private currentPreset: string | null;
  private presetsEnabled = false;
  private dead = false;

  /** @internal Use `PluginViews.create`. */
  constructor(private readonly context: ViewContext) {
    const { document, prepared, backend, info } = context;
    this.uri = info.uri;
    this.info = info;
    this.instance = backend.instance;
    this.currentPreset = backend.preset();

    // makePortIndexes / makeParameterIndexes, with the live values
    for (const spec of prepared.controls.values()) {
      const value = spec.kind === 'bypass' ? (context.bypassed ? 1 : 0) : spec.kind === 'port' ? backend.portValue(spec.key, spec.ranges.default) : spec.ranges.default;
      this.controls.set(spec.key, { spec, value, enabled: true, widgets: [], fields: [], scalePoints: null });
    }
    for (const spec of prepared.parameters.values()) {
      const value = widgetValue(backend.patchValue(spec.key)) ?? spec.ranges.default;
      this.parameters.set(spec.key, { spec, value, enabled: true, widgets: [], fields: [], scalePoints: null });
    }

    const instancePath = backend.instance?.instance;
    this.icon = document.createElement('div');
    this.icon.className = 'mod-pedal';
    this.settings = document.createElement('div');
    this.settings.className = 'mod-settings';
    if (instancePath) {
      this.icon.setAttribute('mod-instance', instancePath);
      this.settings.setAttribute('mod-instance', instancePath);
    }

    this.icon.innerHTML = this.render(context.iconTemplate, prepared.data);
    if (Array.from(this.icon.children).some((child) => RESERVED_CLASSES.some((name) => child.classList.contains(name)))) {
      console.warn(`modui-plugin-view: the icon of ${info.uri} uses reserved MOD css classes; drawing the default pedal instead`);
      this.icon.innerHTML = this.render(context.defaultIconTemplate, prepared.data);
    }
    for (const [role, name] of PORT_CLASSES) {
      for (const element of queryAll(this.icon, `[mod-role="${role}"]`)) element.classList.add(name);
    }
    this.assignControls(this.icon);
    for (const element of queryAll(this.icon, '[mod-role=presets]')) {
      this.on_(element, 'change', () => this.loadPreset((element as HTMLSelectElement).value));
    }

    this.settings.innerHTML = this.render(context.settingsTemplate, prepared.data);
    this.assignControls(this.settings);
    this.setupPresets(prepared.effect.presets);
    this.setupFileLists();
    // Addressing is not supported (yet): its buttons would do nothing.
    for (const element of queryAll(this.settings, '.mod-address, .assign-all, .preset-btn-assign-sel')) element.style.display = 'none';
    for (const element of queryAll(this.settings, '.js-close')) {
      if (backend.live) {
        this.on_(element, 'click', () => this.emitter.emit('close', {}));
      } else {
        element.style.display = 'none';
      }
    }
    this.followIconSize();

    // The values the widgets show (the classic UI gets them from the host right after rendering).
    for (const control of [...this.controls.values(), ...this.parameters.values()]) {
      this.showValue(control, control.value, null, true);
    }
    this.updateLights();
    this.selectPreset(this.currentPreset);

    const funcs = this.scriptFuncs();
    const wrap = context.jQuery;
    this.runner = new ScriptRunner(
      context.script,
      funcs,
      wrap ? wrap(this.icon) : this.icon,
      wrap ? wrap(this.settings) : this.settings,
      (error) => {
        console.warn(`modui-plugin-view: the javascript of ${info.uri} threw and has been disabled`, error);
        this.reportError(error, 'script');
      },
    );

    this.cleanups.push(backend.subscribe(this.listener()));
    this.cleanups.push(context.onOutput((symbol, value) => this.outputChanged(symbol, value)));
    this.runner.start(this.startValues());
  }

  // ---- public API ------------------------------------------------------------------------------------------------------------

  /** `true` for a view of a plugin of the running pedalboard, `false` for a preview. */
  get live(): boolean {
    return this.context.backend.live;
  }

  /** `false` once the view was destroyed (by {@link PluginView.destroy}, or because the plugin left the pedalboard). */
  get alive(): boolean {
    return !this.dead;
  }

  /** `true` when the plugin is on, `false` when bypassed (as the view shows it). */
  get active(): boolean {
    return !this.controls.get(':bypass')!.value;
  }

  /** URI of the current preset, `null` when none. */
  get preset(): string | null {
    return this.currentPreset;
  }

  /** Whether the plugin's JavaScript runs in this view (it exists, jQuery was given, it has not thrown). */
  get scriptActive(): boolean {
    return this.runner.active;
  }

  /** The value of a control port as the view shows it (`undefined` for an unknown symbol). Also `:bypass` (`1`: bypassed). */
  getValue(symbol: string): number | undefined {
    const control = this.controls.get(symbol);
    return control && symbol !== ':presets' ? Number(control.value) : undefined;
  }

  /** The last value an output control port reported (meters, ...), `undefined` when none yet. */
  getOutput(symbol: string): number | undefined {
    return this.context.output(symbol);
  }

  /**
   * Sets a control port like a gesture would: clamped to its range, written through the client (live view), shown by every widget and
   * passed to the plugin script. Events carry `origin: 'api'`. `:bypass` is the bypass (`1`: bypassed).
   * @returns Resolves when the client sent the change (a preview resolves at once).
   * @throws {PluginViewError} for an unknown symbol; rejects with the client's error when it refuses the write.
   * @example
   * await view.setValue('gain', 3);
   */
  setValue(symbol: string, value: number): Promise<void> {
    if (!this.controls.has(symbol) || symbol === ':presets') {
      return Promise.reject(new PluginViewError(`No control port "${symbol}" in ${this.uri}`));
    }
    return this.setPort(symbol, value, null, 'api');
  }

  /** Turns the plugin on (`true`) or bypasses it (`false`), like the footswitch. */
  setActive(active: boolean): Promise<void> {
    return this.setPort(':bypass', active ? 0 : 1, null, 'api');
  }

  /** The value of a patch parameter as the view shows it (booleans as `1` / `0`). */
  getPatchValue(uri: string): number | string | undefined {
    return this.parameters.get(uri)?.value;
  }

  /** Sets a patch parameter like a gesture would (see {@link PluginView.setValue}). */
  setPatchValue(uri: string, value: number | string | boolean): Promise<void> {
    if (!this.parameters.has(uri)) {
      return Promise.reject(new PluginViewError(`No patch parameter "${uri}" in ${this.uri}`));
    }
    return this.setPatch(uri, widgetValue(value)!, null, 'api');
  }

  /**
   * Calls `handler` on news of the view.
   *
   * | Event | When | Payload |
   * |-------|------|---------|
   * | `change` | a control port changed | `{ symbol, value, origin }` |
   * | `active` | switched on or bypassed | `{ active, origin }` |
   * | `patch` | a patch parameter changed | `{ uri, value, origin }` |
   * | `preset` | the current preset changed | `{ preset, origin }` |
   * | `output` | an output port reported a value | `{ symbol, value }` |
   * | `close` | the settings panel's "Close" button | `{}` |
   * | `error` | a background failure (the view goes on) | `{ error, context, uri }` |
   * | `destroyed` | the view is gone | `{ reason }` |
   *
   * `origin` is `'user'`, `'script'`, `'api'` or `'external'` (see `ViewOrigin`).
   * @returns A function that removes the subscription.
   */
  on<K extends keyof ViewEvents>(event: K, handler: (event: ViewEvents[K]) => void): Off {
    return this.emitter.on(event, handler);
  }

  /**
   * Stops following the device, sends `end` to the plugin script, removes the icon and the settings panel from the page. Called by itself
   * when the plugin leaves the pedalboard. Safe to call twice.
   */
  destroy(): void {
    this.dispose('destroyed');
  }

  // ---- rendering ---------------------------------------------------------------------------------------------------------------

  private render(template: string, data: unknown): string {
    return rebaseUrls(this.context.mustache(template, data), this.context.baseUrl);
  }

  private on_<K extends keyof HTMLElementEventMap>(element: EventTarget, type: K, handler: (event: HTMLElementEventMap[K]) => void): void {
    element.addEventListener(type, handler as EventListener);
    this.cleanups.push(() => element.removeEventListener(type, handler as EventListener));
  }

  private host(key: string, kind: 'port' | 'parameter', widget: () => Widget | undefined): WidgetHost {
    return {
      change: (value) => {
        if (kind === 'port') {
          void this.setPort(key, Number(value), widget() ?? null, 'user').catch(() => undefined);
        } else {
          void this.setPatch(key, value, widget() ?? null, 'user').catch(() => undefined);
        }
      },
      imageSize: (url) => this.context.imageSize(url),
    };
  }

  /** `assignControlFunctionality`: binds the widgets, value fields, bypass and min / max labels found in `root`. */
  private assignControls(root: HTMLElement): void {
    for (const element of queryAll(root, '[mod-role=input-control-port]')) {
      const symbol = element.getAttribute('mod-port-symbol') ?? '';
      const control = this.controls.get(symbol);
      if (!control || control.spec.kind !== 'port') {
        element.textContent = 'No such symbol: ' + symbol;
        continue;
      }
      const spec = control.spec;
      if (spec.scalePoints.length > 0) {
        control.scalePoints = new Map(spec.scalePoints.map((point) => [sprintf(spec.format, point.value), point]));
      }
      if (spec.properties.includes('expensive')) {
        for (const address of queryAll(root, `.mod-address${attr('mod-port-symbol', symbol)}`)) address.classList.add('disabled');
      }
      let widget: Widget | undefined;
      widget = createWidget(element, spec, this.host(symbol, 'port', () => widget));
      control.widgets.push(widget);
      const prefix = this.instance ? this.instance.instance + '/' : '';
      element.setAttribute('mod-port', prefix + symbol);
      element.classList.add('mod-port');
      const fields = queryAll(root, `[mod-role=input-control-value]${attr('mod-port-symbol', symbol)}`);
      control.fields.push(...fields);
      if (!['enumeration', 'toggled', 'trigger'].some((name) => spec.properties.includes(name))) {
        for (const field of fields) {
          this.setupValueField(field, control, (value) => {
            void this.setPort(symbol, Number(value), widget ?? null, 'user').catch(() => undefined);
            widget?.setValue(value, true);
          });
        }
      }
    }

    const bypass = this.controls.get(':bypass')!;
    for (const element of queryAll(root, '[mod-role=bypass]')) {
      let widget: Widget | undefined;
      widget = new BypassWidget(element, bypass.spec, this.host(':bypass', 'port', () => widget), () => this.updateLights());
      bypass.widgets.push(widget);
      element.setAttribute('mod-port', (this.instance ? this.instance.instance + '/' : '') + ':bypass');
      element.setAttribute('mod-widget', 'bypass');
      element.classList.add('mod-port');
    }

    for (const element of queryAll(root, '[mod-role=input-parameter]')) {
      const uri = element.getAttribute('mod-parameter-uri') ?? '';
      const control = this.parameters.get(uri);
      if (!control) {
        element.textContent = 'No such parameter: ' + uri;
        continue;
      }
      const spec = control.spec;
      if (!spec.valuetype || !(spec.control || spec.string || spec.path)) {
        continue;
      }
      let widget: Widget | undefined;
      widget = createWidget(element, spec, this.host(uri, 'parameter', () => widget));
      control.widgets.push(widget);
      if (this.instance) {
        element.setAttribute('mod-instance', this.instance.instance);
      }
      if (spec.control || spec.string) {
        const fields = queryAll(root, `[mod-role=input-parameter-value]${attr('mod-parameter-uri', uri)}`);
        control.fields.push(...fields);
        if (!spec.properties.includes('toggled')) {
          for (const field of fields) {
            this.setupValueField(field, control, (value) => {
              void this.setPatch(uri, value, widget ?? null, 'user').catch(() => undefined);
              widget?.setValue(value, true);
            });
          }
        }
      }
    }

    for (const [role, which] of [['input-control-minimum', 'minimum'], ['input-control-maximum', 'maximum']] as const) {
      for (const element of queryAll(root, `[mod-role=${role}]`)) {
        const symbol = element.getAttribute('mod-port-symbol');
        const uri = element.getAttribute('mod-parameter-uri');
        const control = symbol ? this.controls.get(symbol) : uri ? this.parameters.get(uri) : undefined;
        if (!symbol && !uri) {
          element.textContent = 'missing mod-port-symbol or mod-parameter-uri attribute';
          continue;
        }
        if (!control) {
          continue;
        }
        const limit = control.spec.ranges[which];
        let format = control.spec.units.render || '%f';
        let text: string;
        if (control.spec.properties.includes('integer')) {
          text = sprintf(format.replace(/%\.\d+f/, '%d'), limit);
        } else {
          text = sprintf(format, limit);
          if (text.length > 8) {
            format = format.replace('%f', '%.2f');
            text = sprintf(format, limit);
          }
        }
        element.textContent = text;
      }
    }
  }

  /** `setupValueField`: an editable value; Enter commits, digits / `.` / `-` only for numbers, clamped on blur. */
  private setupValueField(field: HTMLElement, control: Control, commit: (value: number | string) => void): void {
    const spec = control.spec;
    const textarea = field.tagName === 'TEXTAREA';
    if (!textarea) {
      field.setAttribute('contenteditable', String(!spec.string || spec.writable !== false));
    }
    this.on_(field, 'focus', () => {
      if (!spec.string) {
        field.textContent = sprintf(spec.format, control.value);
      }
    });
    this.on_(field, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !(textarea && event.shiftKey)) {
        event.preventDefault();
        field.blur();
        return;
      }
      if (spec.string || event.ctrlKey || event.metaKey || event.key.length > 1) {
        return;
      }
      if (!/^[0-9.\-]$/.test(event.key)) {
        event.preventDefault();
      }
    });
    this.on_(field, 'blur', () => {
      if (spec.string) {
        commit(textarea ? (field as HTMLTextAreaElement).value : field.textContent ?? '');
        return;
      }
      let value = parseFloat(field.textContent ?? '');
      if (isNaN(value)) {
        value = Number(control.value);
      }
      value = Math.min(spec.ranges.maximum, Math.max(spec.ranges.minimum, value));
      // Show the formatted value again even when it did not change (the field holds the raw text being edited).
      this.showValue(control, Number(control.value), null, true, true);
      commit(value);
    });
  }

  /** Keeps the size of the `.mod-pedal` box equal to its pedal (the classic UI does it after rendering and on resize). */
  private followIconSize(): void {
    const sync = () => {
      const child = this.icon.firstElementChild as HTMLElement | null;
      if (!child) {
        return;
      }
      const width = child.offsetWidth;
      const height = child.offsetHeight;
      if (width !== 0 && height !== 0) {
        this.icon.style.width = `${width}px`;
        this.icon.style.height = `${height}px`;
        for (const info of queryAll(this.icon, '.mod-information')) info.style.display = width < 150 ? 'none' : '';
      }
    };
    this.later(sync, 1);
    const view = this.context.document.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
    const child = this.icon.firstElementChild;
    if (view?.ResizeObserver && child) {
      const observer = new view.ResizeObserver(sync);
      observer.observe(child);
      this.cleanups.push(() => observer.disconnect());
    }
  }

  private later(callback: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.dead) callback();
    }, ms);
    this.timers.add(timer);
  }

  // ---- values ----------------------------------------------------------------------------------------------------------------

  /**
   * `setPortWidgetsValue` / `setWritableParameterValue`: shows `value` on every widget but `source` and on the value fields, then tells
   * the plugin script (unless the script made the change). A trigger port goes back to its default 100 ms later.
   */
  private showValue(control: Control, value: number | string, source: Widget | null, quiet: boolean, fieldsOnly = false): void {
    control.value = value;
    if (!fieldsOnly) {
      for (const widget of control.widgets) {
        if (widget !== source) widget.setValue(value, true);
      }
    }
    const spec = control.spec;
    for (const field of control.fields) {
      if (spec.string) {
        if (field.tagName === 'TEXTAREA') (field as HTMLTextAreaElement).value = String(value);
        else field.textContent = String(value);
        continue;
      }
      let label = sprintf(spec.format, value);
      label = control.scalePoints?.get(label)?.label ?? label;
      field.textContent = label;
    }
    if (spec.kind === 'bypass') {
      this.updateLights();
    }
    if (!quiet) {
      this.runner.change(spec.kind === 'parameter' ? { uri: spec.key, value } : { symbol: spec.key, value: Number(value) });
    }
    if (spec.properties.includes('trigger') && value !== spec.ranges.default && spec.kind === 'port') {
      this.later(() => this.showValue(control, spec.ranges.default, null, false), 100);
    }
  }

  /** `setPortValue`: clamps, writes through the backend, shows, notifies. */
  private setPort(symbol: string, raw: number, source: Widget | null, origin: ViewOrigin): Promise<void> {
    const control = this.controls.get(symbol);
    if (this.dead || !control || !control.enabled) {
      return Promise.resolve();
    }
    if (typeof raw !== 'number' || isNaN(raw)) {
      return Promise.reject(new PluginViewError(`Invalid value for "${symbol}": ${String(raw)}`));
    }
    const value = Math.min(control.spec.ranges.maximum, Math.max(control.spec.ranges.minimum, raw));
    if (control.value === value) {
      return Promise.resolve();
    }
    const write = symbol === ':bypass' ? this.context.backend.setActive(!value) : this.context.backend.setPort(symbol, value);
    this.showValue(control, value, source, origin === 'script');
    if (symbol === ':bypass') {
      this.emitter.emit('active', { active: !value, origin });
    } else {
      this.emitter.emit('change', { symbol, value, origin });
    }
    return write.catch((error) => {
      this.reportError(error, 'write');
      throw error;
    });
  }

  /** `lv2PatchSet`: clamps a numeric parameter, converts to the parameter's type, writes, shows, notifies. */
  private setPatch(uri: string, raw: number | string, source: Widget | null, origin: ViewOrigin): Promise<void> {
    const control = this.parameters.get(uri);
    if (this.dead || !control || !control.enabled) {
      return Promise.resolve();
    }
    const spec = control.spec;
    let value: number | string = raw;
    if (spec.control) {
      value = Math.min(spec.ranges.maximum, Math.max(spec.ranges.minimum, Number(raw)));
      if (isNaN(value)) {
        return Promise.reject(new PluginViewError(`Invalid value for "${uri}": ${String(raw)}`));
      }
    }
    if (control.value === value) {
      return Promise.resolve();
    }
    let typed: PatchValue;
    switch (spec.valuetype) {
      case 'b':
        typed = !!Number(value);
        break;
      case 'i':
      case 'l':
        typed = Math.round(Number(value));
        break;
      case 'f':
      case 'g':
        typed = Number(value);
        break;
      case 's':
      case 'p':
      case 'u':
        typed = String(value);
        break;
      default:
        return Promise.reject(new PluginViewError(`Patch parameters of type "${spec.valuetype}" are not supported`));
    }
    const write = this.context.backend.setPatch(uri, typed);
    this.showValue(control, value, source, origin === 'script');
    this.emitter.emit('patch', { uri, value: typed, origin });
    return write.catch((error) => {
      this.reportError(error, 'write');
      throw error;
    });
  }

  /** Bypass lights: class `on` when the plugin is active, `off` when bypassed (the inverse of the footswitch). */
  private updateLights(): void {
    const bypassed = !!this.controls.get(':bypass')!.value;
    for (const root of [this.icon, this.settings]) {
      for (const light of queryAll(root, '[mod-role=bypass-light]')) {
        light.classList.toggle('off', bypassed);
        light.classList.toggle('on', !bypassed);
      }
    }
  }

  private listener(): BackendListener {
    return {
      param: (symbol, value) => {
        const control = this.controls.get(symbol);
        if (control) {
          this.showValue(control, value, null, false);
        } else {
          this.runner.change({ symbol, value });
        }
        this.emitter.emit('change', { symbol, value, origin: 'external' });
      },
      active: (active) => {
        this.showValue(this.controls.get(':bypass')!, active ? 0 : 1, null, false);
        this.emitter.emit('active', { active, origin: 'external' });
      },
      patch: (uri, value) => {
        const control = this.parameters.get(uri);
        const shown = widgetValue(value);
        if (control && shown !== undefined) {
          this.showValue(control, shown, null, false);
        } else {
          this.runner.change({ uri, value: shown });
        }
        this.emitter.emit('patch', { uri, value, origin: 'external' });
      },
      preset: (uri) => {
        this.selectPreset(uri);
        this.emitter.emit('preset', { preset: uri, origin: 'external' });
      },
      presetList: (presets) => this.fillPresets(presets),
      removed: (reason) => this.dispose(reason),
    };
  }

  private outputChanged(symbol: string, value: number): void {
    this.runner.change({ symbol, value });
    this.emitter.emit('output', { symbol, value });
  }

  // ---- presets ---------------------------------------------------------------------------------------------------------------

  private presetPanel(): HTMLElement | null {
    return this.settings.querySelector<HTMLElement>('.mod-presets');
  }

  /** The preset panel of the settings (`.mod-presets`): load on click, save, save as, rename, delete; hidden for a preview. */
  private setupPresets(presets: PluginPresetInfo[]): void {
    const panel = this.presetPanel();
    if (!panel) {
      return;
    }
    const effect = this.context.prepared.effect;
    const backend = this.context.backend.presets;
    if (!backend || !(presets.length > 0 || effect.parameters.length + effect.all_control_in_ports.length > 0)) {
      panel.style.display = 'none';
      return;
    }
    this.presetsEnabled = true;
    const button = (name: string, handler: () => void) => {
      for (const element of queryAll(panel, `.preset-btn-${name}`)) {
        this.on_(element, 'click', () => {
          if (!element.classList.contains('disabled')) handler();
        });
      }
    };
    button('save', () => {
      const item = this.currentPresetItem();
      if (item?.getAttribute('mod-path') && this.currentPreset) {
        this.presetTask(backend.save(this.currentPreset));
      }
    });
    button('save-as', () => {
      const item = this.currentPresetItem();
      void this.context.promptName('Saving Preset', item?.textContent ?? '').then((name) => {
        if (name) this.presetTask(backend.create(name));
      });
    });
    button('rename', () => {
      const item = this.currentPresetItem();
      const uri = this.currentPreset;
      if (!item?.getAttribute('mod-path') || !uri) {
        return;
      }
      void this.context.promptName('Renaming Preset', item.textContent ?? '').then((name) => {
        if (name) this.presetTask(backend.save(uri, name));
      });
    });
    button('delete', () => {
      const item = this.currentPresetItem();
      if (item?.getAttribute('mod-path') && this.currentPreset) {
        this.presetTask(backend.delete(this.currentPreset));
      }
    });
    const lists = (which: 'factory' | 'user') => queryAll(panel, `.mod-preset-${which}`);
    const show = (which: 'factory' | 'user') => {
      for (const list of lists(which)) {
        list.classList.remove('mod-hidden');
        list.style.display = '';
      }
      for (const list of lists(which === 'user' ? 'factory' : 'user')) list.style.display = 'none';
    };
    for (const radio of queryAll(panel, '.radio-preset-factory')) this.on_(radio, 'click', () => show('factory'));
    for (const radio of queryAll(panel, '.radio-preset-user')) this.on_(radio, 'click', () => show('user'));
    // One delegated listener: the items are rebuilt when the list changes.
    this.on_(panel, 'click', (event: MouseEvent) => {
      const item = (event.target as Element | null)?.closest?.('[mod-role=enumeration-option][mod-uri]');
      if (item && panel.contains(item) && this.presetsEnabled) {
        this.loadPreset(item.getAttribute('mod-uri') ?? '');
      }
    });
    const factoryCount = presets.filter((preset) => !preset.path).length;
    if (presets.length !== 1 && factoryCount === 0) {
      for (const span of queryAll(panel, '.mod-enumerated-title span')) span.style.display = 'none';
      show('user');
    }
  }

  /** Rebuilds the items of the preset lists (settings panel and icon selector) from a new list. */
  private fillPresets(presets: PluginPresetInfo[]): void {
    const doc = this.context.document;
    const panel = this.presetPanel();
    if (panel) {
      for (const [which, items] of [
        ['factory', presets.filter((preset) => !preset.path)],
        ['user', presets.filter((preset) => preset.path)],
      ] as const) {
        for (const list of queryAll(panel, `.mod-preset-${which}`)) {
          list.textContent = '';
          for (const preset of items) {
            const item = doc.createElement('div');
            item.setAttribute('mod-role', 'enumeration-option');
            item.setAttribute('mod-uri', preset.uri);
            if (preset.path) item.setAttribute('mod-path', preset.path);
            item.textContent = preset.label;
            list.appendChild(item);
          }
        }
      }
    }
    this.selectPreset(this.currentPreset);
  }

  private currentPresetItem(): HTMLElement | null {
    const panel = this.presetPanel();
    return panel && this.currentPreset ? panel.querySelector<HTMLElement>(`[mod-role=enumeration-option]${attr('mod-uri', this.currentPreset)}`) : null;
  }

  private loadPreset(uri: string): void {
    const backend = this.context.backend.presets;
    if (backend && uri && !this.dead) {
      this.presetTask(backend.load(uri));
    }
  }

  /**
   * Runs a preset operation of the view, then shows the current preset the client now records (the view does not hear its own changes
   * back, and a save makes the saved preset current without any frame).
   */
  private presetTask(task: Promise<unknown>): void {
    task.then(
      () => {
        const current = this.context.backend.preset();
        if (!this.dead && current !== this.currentPreset) {
          this.selectPreset(current);
          this.emitter.emit('preset', { preset: current, origin: 'user' });
        }
      },
      (error) => this.reportError(error, 'preset'),
    );
  }

  /** `selectPreset`: marks the current preset in the lists and enables the buttons that apply to it. */
  private selectPreset(uri: string | null): void {
    this.currentPreset = uri;
    let bundle: string | null = null;
    const roots = [...queryAll(this.icon, '[mod-role=presets]'), ...(this.presetPanel() ? [this.presetPanel()!] : [])];
    for (const root of roots) {
      for (const option of queryAll(root, '[mod-role=enumeration-option]')) option.classList.remove('selected');
      if (uri) {
        const selected = root.querySelector<HTMLElement>(`[mod-role=enumeration-option]${attr('mod-uri', uri)}`);
        selected?.classList.add('selected');
        bundle = selected?.getAttribute('mod-path') || bundle;
        if (root.tagName === 'SELECT') (root as HTMLSelectElement).value = uri;
      }
    }
    const panel = this.presetPanel();
    if (!panel) {
      return;
    }
    const set = (name: string, enabled: boolean) => {
      for (const element of queryAll(panel, `.preset-btn-${name}`)) element.classList.toggle('disabled', !enabled);
    };
    set('save', !!uri && !!bundle);
    set('rename', !!uri && !!bundle && this.presetsEnabled);
    set('delete', !!uri && !!bundle && this.presetsEnabled);
  }

  // ---- file lists ------------------------------------------------------------------------------------------------------------

  /** The "expand" button of long file lists (`.mod-file-list`). */
  private setupFileLists(): void {
    for (const box of queryAll(this.settings, '.mod-file-list')) {
      const lists = queryAll(box, '.mod-enumerated-list');
      const expand = queryAll(box, '.file-list-btn-expand');
      if (lists.length === 1 && lists[0].childElementCount > 5) {
        for (const button of expand) this.on_(button, 'click', () => box.classList.toggle('expanded'));
      } else {
        for (const button of expand) button.style.display = 'none';
      }
      for (const button of queryAll(box, '.file-list-btn-t3k')) button.style.display = 'none';
    }
  }

  // ---- plugin script ---------------------------------------------------------------------------------------------------------

  private scriptFuncs(): ScriptFuncs {
    const effect = this.context.prepared.effect;
    const controlPorts = () => [...effect.all_control_in_ports, ...effect.ports.control.output];
    return {
      set_port_value: (symbol, value) => {
        void this.setPort(symbol, value, null, 'script').catch(() => undefined);
      },
      patch_get: (uri) => {
        this.context.backend.refreshPatch(uri).catch((error) => this.reportError(error, 'script'));
      },
      patch_set: (uri, _valuetype, value) => {
        void this.setPatch(uri, value as number | string, null, 'script').catch(() => undefined);
      },
      get_custom_resource_filename: (filename) => customFileUrl(this.context.baseUrl, filename, this.uri, this.context.version),
      get_port_index_for_symbol: (symbol) => controlPorts().find((port) => port.symbol === symbol)?.index ?? -1,
      get_port_symbol_for_index: (index) => controlPorts().find((port) => port.index === index)?.symbol ?? null,
    };
  }

  /** The `start` event: `:bypass`, every control input (also the hidden ones), every control output, every parameter. */
  private startValues(): { ports: { symbol: string; value: number }[]; parameters: { uri: string; value: unknown }[] } {
    const effect = this.context.prepared.effect;
    const ports = [{ symbol: ':bypass', value: Number(this.controls.get(':bypass')!.value) }];
    for (const port of effect.all_control_in_ports) {
      const control = this.controls.get(port.symbol);
      ports.push({
        symbol: port.symbol,
        value: control ? Number(control.value) : this.context.backend.portValue(port.symbol, port.ranges?.default ?? port.ranges?.minimum ?? 0),
      });
    }
    for (const port of effect.ports.control.output) {
      ports.push({ symbol: port.symbol, value: this.context.output(port.symbol) ?? port.ranges?.default ?? port.ranges?.minimum ?? 0 });
    }
    const parameters = Array.from(this.parameters.values(), (control) => ({ uri: control.spec.key, value: control.value }));
    return { ports, parameters };
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------------------

  private reportError(error: unknown, context: ViewErrorContext): void {
    const event = { error, context, uri: this.uri };
    this.emitter.emit('error', event);
    this.context.reportError(error, context);
  }

  private dispose(reason: 'destroyed' | 'removed' | 'cleared' | 'reloaded'): void {
    if (this.dead) {
      return;
    }
    this.runner.end();
    this.dead = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const control of [...this.controls.values(), ...this.parameters.values()]) {
      for (const widget of control.widgets) widget.destroy();
    }
    this.icon.remove();
    this.settings.remove();
    this.context.onDestroy(this);
    this.emitter.emit('destroyed', { reason });
    this.emitter.clear();
  }
}
