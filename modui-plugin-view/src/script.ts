// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The plugin's own JavaScript (modgui `javascript`), `api_version` 3, as `html/js/modgui.js` runs it (internal).
 * @module
 */

/** Values a plugin script receives in `start`. */
export interface ScriptStart {
  ports: { symbol: string; value: number }[];
  parameters: { uri: string; value: unknown }[];
}

/** The functions handed to the script (`funcs`, second argument). */
export interface ScriptFuncs {
  /** v1: sets a control port, as if the user moved it (`:bypass` too). */
  set_port_value(symbol: string, value: number): void;
  /** v2: asks the plugin for a patch parameter (the answer arrives as a `change` event). */
  patch_get(uri: string): void;
  /** v2: sets a patch parameter; `valuetype` is the atom type character (`b i l f g s p u`). */
  patch_set(uri: string, valuetype: string, value: unknown): void;
  /** v3: absolute URL of a file below the modgui resources directory. */
  get_custom_resource_filename(filename: string): string;
  /** v3: index of a control port, `-1` when unknown. */
  get_port_index_for_symbol(symbol: string): number;
  /** v3: symbol of a control port, `null` when unknown. */
  get_port_symbol_for_index(index: number): string | null;
}

/** The compiled script: `function (event, funcs) { … }`. */
export type ScriptCallback = (event: Record<string, unknown>, funcs: ScriptFuncs) => void;

/**
 * Compiles the text of a modgui `javascript` file, which is a bare function expression. Like the classic UI (`eval('method = ' + code)`),
 * the code runs with the page's privileges: only render plugins you trust. Throws when the text is not a function.
 */
export function compileScript(code: string): ScriptCallback {
  // The same form as the classic UI's `eval('method = ' + code)`: some scripts follow the function with helper declarations
  // (`function (event) {…}\nfunction helper() {…}`), which end up in the same scope and are captured by the closure. `new Function`
  // runs in the global scope, not in this module's.
  const method = new Function(`var method = ${code}\n;return method;`)() as unknown;
  if (typeof method !== 'function') {
    throw new TypeError('The plugin javascript is not a function expression');
  }
  return method as ScriptCallback;
}

/** Runs the events of one view through a plugin script; disables it for good after it throws (like `triggerJS`). */
export class ScriptRunner {
  private readonly data: Record<string, unknown> = {};
  private started = false;

  constructor(
    private callback: ScriptCallback | null,
    private readonly funcs: ScriptFuncs,
    /** The jQuery-wrapped icon and settings elements. */
    private readonly icon: unknown,
    private readonly settings: unknown,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** True while the script runs (it was given, has not thrown, `end` was not sent). */
  get active(): boolean {
    return this.callback !== null;
  }

  start(values: ScriptStart): void {
    this.started = true;
    this.trigger({ type: 'start', parameters: values.parameters, ports: values.ports });
  }

  /** `change { symbol, value }` for a control port (inputs and outputs), `change { uri, value }` for a patch parameter. */
  change(change: { symbol: string; value: number } | { uri: string; value: unknown }): void {
    this.trigger({ type: 'change', ...change });
  }

  end(): void {
    this.trigger({ type: 'end' });
    this.callback = null;
  }

  private trigger(event: Record<string, unknown>): void {
    const callback = this.callback;
    if (!callback || !this.started) {
      return;
    }
    event.api_version = 3;
    event.data = this.data;
    event.icon = this.icon;
    event.settings = this.settings;
    try {
      callback(event, this.funcs);
    } catch (error) {
      this.callback = null;
      this.onError(error);
    }
  }
}
