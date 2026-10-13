// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The data a modgui template is rendered with, and the description of every control, built like `html/js/modgui.js`
 * (`makePortIndexes`, `makeParameterIndexes`, `getTemplateData`, `loadFileTypesList`) and `html/js/host.js` (port groups).
 * Pure functions: no DOM, no request.
 * @module
 */

import type { PluginInfo, PluginPresetInfo } from 'modui-client';
import { namespace } from './urls';

const ATOM = 'http://lv2plug.in/ns/ext/atom#';

/** Control ports the classic UI never draws (`shouldSkipPort` in `modgui.js`): the host drives them. */
const HOST_DESIGNATIONS = [
  'http://lv2plug.in/ns/lv2core#enabled',
  'http://lv2plug.in/ns/lv2core#freeWheeling',
  'http://lv2plug.in/ns/ext/time#beatsPerBar',
  'http://lv2plug.in/ns/ext/time#beatsPerMinute',
  'http://lv2plug.in/ns/ext/time#speed',
];

/** A scale point of a control port. */
export interface ScalePoint {
  value: number;
  label: string;
  valid?: boolean;
}

/** Units of a control port (`units.render` is a printf format such as `%f dB`). */
export interface PortUnits {
  label?: string;
  render?: string;
  symbol?: string;
}

/** A control port as `GET /effect/get` describes it, with the fields the GUI uses. */
export interface WirePort {
  index: number;
  name: string;
  symbol: string;
  shortName?: string;
  comment?: string;
  designation?: string;
  group?: unknown;
  properties?: string[];
  ranges?: { minimum: number; maximum: number; default?: number };
  units?: PortUnits;
  rangeSteps?: number;
  scalePoints?: ScalePoint[];
  [other: string]: unknown;
}

/** A user file, as `GET /files/list` lists it (schema `UserFile`), or one of the entries the GUI adds (folders, the default). */
export interface FileEntry {
  fullname: string;
  basename: string;
  dirname: string;
  basepath?: string;
  filetype?: string;
  /** HTML of the icon shown before the name. */
  icon?: string;
}

/** The user files a path parameter accepts (`client.files.list()`, wrapped as `GET /files/list` answers). */
export interface FileList {
  ok?: boolean;
  files: FileEntry[];
}

/** How a control is drawn and written. */
export type ControlKind = 'port' | 'parameter' | 'bypass' | 'presets';

/**
 * Everything the widgets need to know about a control: a control input port (key: its symbol), a patch parameter (key: its URI), the
 * bypass (`:bypass`) or the preset selector (`:presets`).
 */
export interface ControlSpec {
  kind: ControlKind;
  /** Symbol of a port, URI of a parameter, `:bypass` or `:presets`. */
  key: string;
  name: string;
  comment: string;
  designation: string;
  ranges: { minimum: number; maximum: number; default: number };
  properties: string[];
  scalePoints: ScalePoint[];
  rangeSteps?: number;
  units: PortUnits;
  /** printf format of the value fields (`%.2f`, `%d dB`, `%s`). */
  format: string;
  /** Patch parameter type character (`b i l f g s p u v`); `undefined` for ports. */
  valuetype?: string;
  /** A numeric patch parameter drawn as a knob or a switch. */
  control?: boolean;
  /** A string patch parameter (text field). */
  string?: boolean;
  /** A path patch parameter (file list). */
  path?: boolean;
  writable?: boolean;
  readable?: boolean;
  /** For a path: the files to choose from, folders first. */
  files?: FileEntry[];
  /** For a path: the type folders the files come from. */
  basepaths?: string[];
}

/** The result of {@link buildTemplateData}. */
export interface PreparedPlugin {
  /** The object the icon and settings templates are rendered with (`effect`, `ns`, `cns`, `brand`, `controls`, `presets`, ...). */
  data: Record<string, unknown>;
  /** The plugin description as the templates see it (a copy: groups resolved, flags added, skipped ports removed from `ports.control.input`). */
  effect: PreparedEffect;
  /** The control input ports by symbol, plus `:bypass` and `:presets`. */
  controls: Map<string, ControlSpec>;
  /** The patch parameters by URI. */
  parameters: Map<string, ControlSpec>;
}

/** The plugin description after {@link buildTemplateData}. */
export interface PreparedEffect {
  uri: string;
  name: string;
  ports: {
    audio: { input: WirePort[]; output: WirePort[] };
    control: { input: WirePort[]; output: WirePort[] };
    cv: { input: WirePort[]; output: WirePort[] };
    midi: { input: WirePort[]; output: WirePort[] };
  };
  /** Every control input, also the ones the GUI does not draw (the classic `all_control_in_ports`). */
  all_control_in_ports: WirePort[];
  parameters: WireParameter[];
  gui: Record<string, unknown>;
  renderedVersion: string;
  presets: PluginPresetInfo[];
  /** The other fields of the description, unchanged. */
  [other: string]: unknown;
}

/** A patch parameter as the templates see it. */
export interface WireParameter {
  uri: string;
  label: string;
  type: string;
  readable?: boolean;
  writable?: boolean;
  ranges?: { minimum?: number | string; maximum?: number | string; default?: number | string } | null;
  units?: PortUnits;
  comment?: string;
  shortName?: string;
  fileTypes?: string[];
  control?: boolean;
  string?: boolean;
  path?: boolean;
  t3k?: boolean;
  files?: FileEntry[];
  basepaths?: string[];
  integer?: boolean;
  toggled?: boolean;
  [other: string]: unknown;
}

/** Inputs of {@link buildTemplateData}. */
export interface TemplateInputs {
  /** The plugin description (not modified). */
  info: PluginInfo;
  /** The version used in `ns` / `cns`: `plugin.gui.version` of `modui-client`, the same as in the URLs of the plugin's files. */
  version: string;
  /** The presets to list (default: `info.presets`). */
  presets?: readonly PluginPresetInfo[];
  /** The `GET /files/list` answer for each path parameter, by parameter URI. A path parameter without one gets only its default. */
  files?: ReadonlyMap<string, FileList | null>;
}

/** True for the control ports the classic UI does not draw (`notOnGUI`, and the ports the host drives). */
export function shouldSkipPort(port: Pick<WirePort, 'properties' | 'designation'>): boolean {
  return (port.properties ?? []).includes('notOnGUI') || HOST_DESIGNATIONS.includes(port.designation ?? '');
}

/** The atom type character of a patch parameter type URI (as `assignParameterControlFunctionality`), or `undefined`. */
export function valueTypeOf(type: string): string | undefined {
  return ({ Bool: 'b', Int: 'i', Long: 'l', Float: 'f', Double: 'g', String: 's', Path: 'p', URI: 'u', Vector: 'v' } as Record<string, string>)[
    type.startsWith(ATOM) ? type.slice(ATOM.length) : ''
  ];
}

/** The format of a value field: `units.render` with `%f` as `%.2f`, `%d` for integers; `%s` for strings. */
export function valueFormat(spec: Pick<ControlSpec, 'units' | 'properties' | 'string'>): string {
  if (spec.string) {
    return '%s';
  }
  const format = spec.units.render ? spec.units.render.replace('%f', '%.2f') : '%.2f';
  return spec.properties.includes('integer') ? format.replace(/%\.\d+f/, '%d') : format;
}

/**
 * Resolves the port groups of the control inputs like `html/js/host.js` does when a plugin is added: `group` becomes the group object of
 * `portGroups` (or `undefined`), with `groupIndex`, `groupCssIndex` (`% 32`), `groupStart` and `groupEnd`; the ports are sorted by group,
 * then by index. Changes `ports` in place.
 */
export function resolvePortGroups(ports: WirePort[], portGroups: { uri: string }[] | undefined): void {
  for (const port of ports) {
    const groupUri = port.group;
    port.group = undefined;
    port.groupIndex = undefined;
    port.groupCssIndex = undefined;
    if (portGroups && typeof groupUri === 'string' && groupUri) {
      const group = portGroups.find((item) => item.uri === groupUri);
      if (group) {
        port.group = group;
        port.groupStart = false;
        port.groupEnd = false;
        port.groupIndex = portGroups.indexOf(group);
        port.groupCssIndex = (port.groupIndex as number) % 32;
      }
    }
  }
  ports.sort((a, b) => {
    const ga = a.groupIndex as number | undefined;
    const gb = b.groupIndex as number | undefined;
    // `undefined < n` and `undefined > n` are both false in the classic code, so ports without a group keep the index order among
    // themselves and against grouped ports; the comparison below reproduces it.
    if (ga !== undefined && gb !== undefined && ga !== gb) {
      return ga - gb;
    }
    return a.index - b.index;
  });
  let previous: WirePort | undefined;
  for (const port of ports) {
    if (port.group) {
      if (previous === undefined || previous.group === undefined) {
        port.groupStart = true;
      } else if (previous.groupIndex !== port.groupIndex) {
        port.groupStart = true;
        previous.groupEnd = true;
      }
    }
    previous = port;
  }
  if (previous?.group) {
    previous.groupEnd = true;
  }
}

/**
 * The entries of a path parameter's file list, like `loadFileTypesList` in `modgui.js`: the folders (every ancestor below the type
 * folder, sorted, as `dir://<path>`), then the files of `GET /files/list`, then the parameter's default value. The T3K entry of the
 * classic UI is not added (not supported).
 */
export function fileEntries(list: FileList | null | undefined, defaultValue: unknown): { files: FileEntry[]; basepaths: string[] } {
  const files: FileEntry[] = [];
  const basepaths: string[] = [];
  if (list && Array.isArray(list.files)) {
    const dirs: string[] = [];
    for (const file of list.files) {
      const basepath = file.basepath ?? '';
      if (file.dirname && file.dirname.length > 0) {
        let dirPath = file.fullname;
        let slash = Math.max(dirPath.lastIndexOf('/'), dirPath.lastIndexOf('\\'));
        while (slash > basepath.length) {
          dirPath = dirPath.slice(0, slash);
          if (!dirs.includes(dirPath)) {
            dirs.push(dirPath);
          }
          slash = Math.max(dirPath.lastIndexOf('/'), dirPath.lastIndexOf('\\'));
        }
      }
      if (!basepaths.includes(basepath)) {
        basepaths.push(basepath);
      }
    }
    dirs.sort();
    for (const dir of dirs) {
      const slash = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'));
      const name = slash !== -1 ? dir.slice(slash + 1) : dir;
      files.push({ basename: name, dirname: name, filetype: 'dir', fullname: 'dir://' + dir });
    }
    files.push(...list.files);
  }
  if (typeof defaultValue === 'string' && defaultValue) {
    files.push({
      fullname: defaultValue,
      dirname: '',
      basename: defaultValue.slice(defaultValue.lastIndexOf('/') + 1),
      icon: '<i class="icon-preset mod-select-path-icon"></i>',
    });
  }
  return { files, basepaths };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function bypassSpec(): ControlSpec {
  return {
    kind: 'bypass',
    key: ':bypass',
    name: 'Bypass',
    comment: '',
    designation: '',
    ranges: { minimum: 0, maximum: 1, default: 1 },
    properties: ['toggled', 'integer'],
    scalePoints: [],
    units: {},
    format: '%d',
  };
}

function presetsSpec(): ControlSpec {
  return {
    kind: 'presets',
    key: ':presets',
    name: 'Presets',
    comment: '',
    designation: '',
    ranges: { minimum: -1, maximum: 0, default: -1 },
    properties: ['enumeration', 'integer'],
    scalePoints: [],
    units: {},
    format: '%d',
  };
}

function portSpec(port: WirePort): ControlSpec {
  const minimum = port.ranges?.minimum ?? 0;
  const spec: ControlSpec = {
    kind: 'port',
    key: port.symbol,
    name: port.name,
    comment: port.comment ?? '',
    designation: port.designation ?? '',
    ranges: { minimum, maximum: port.ranges?.maximum ?? 1, default: port.ranges?.default ?? minimum },
    properties: port.properties ?? [],
    scalePoints: port.scalePoints ?? [],
    rangeSteps: port.rangeSteps,
    units: port.units ?? {},
    format: '',
  };
  spec.format = valueFormat(spec);
  return spec;
}

/** `makeParameterIndexes` for one parameter; also flags the template copy (`control`, `string`). `null` when it cannot be shown. */
function parameterSpec(parameter: WireParameter): ControlSpec | null {
  if (!parameter.ranges) {
    return null;
  }
  const ranges = parameter.ranges;
  let properties: string[] | null;
  let minimum = Number(ranges.minimum);
  let maximum = Number(ranges.maximum);
  let def: number | string | undefined = ranges.default;
  switch (parameter.type) {
    case ATOM + 'Bool':
      properties = ['toggled', 'integer'];
      def = Number(def) | 0;
      minimum |= 0;
      maximum |= 0;
      break;
    case ATOM + 'Int':
    case ATOM + 'Long':
      properties = ['integer'];
      def = Math.round(Number(def));
      minimum = Math.round(minimum);
      maximum = Math.round(maximum);
      break;
    case ATOM + 'Float':
    case ATOM + 'Double':
      properties = [];
      def = Number(def);
      break;
    default:
      properties = null;
  }
  const control = properties !== null && minimum !== maximum;
  parameter.control = control;
  if (!control) {
    parameter.string = parameter.type === ATOM + 'String';
  }
  const spec: ControlSpec = {
    kind: 'parameter',
    key: parameter.uri,
    name: parameter.label,
    comment: parameter.comment ?? '',
    designation: '',
    ranges: control ? { minimum, maximum, default: def as number } : { minimum: 0, maximum: 0, default: def as never },
    properties: control ? properties! : [],
    scalePoints: [],
    units: parameter.units ?? {},
    format: '',
    valuetype: valueTypeOf(parameter.type),
    control,
    string: !!parameter.string,
    path: !!parameter.path,
    writable: parameter.writable,
    readable: parameter.readable,
    files: parameter.files,
    basepaths: parameter.basepaths,
  };
  spec.format = valueFormat(spec);
  return spec;
}

/**
 * Builds the template data and the control descriptions of a plugin, as the classic UI does right before rendering
 * (`GUI.preRender` + `GUI.getTemplateData`):
 *
 * - `effect`: a copy of the description, with the control inputs the GUI skips removed from `effect.ports.control.input` (all of
 *   them stay in `effect.all_control_in_ports`) and the flags `enumeration`, `integer`, `logarithmic`, `toggled`, `trigger` and
 *   `steps` added to each one; patch parameters flagged `control` (with `integer`, `toggled`), `string` or `path` (with `files`).
 * - `ns`, `cns`: see `namespace()`.
 * - `brand`, `label`, `color`, `knob`, `model`, `panel`: from `gui.templateData`, else from `gui`.
 * - `controls`: `gui.templateData.controls` or `gui.ports`, each with `comment` and `scalePoints` added.
 * - `presets`: `{ factory, user }` (user presets are the ones with a `path`).
 *
 * @example
 * const { data, controls } = buildTemplateData({ info, version: plugin.gui.version });
 * const html = renderMustache(iconTemplate, data);
 * controls.get('gain')?.format;   // "%.2f dB"
 */
export function buildTemplateData(inputs: TemplateInputs): PreparedPlugin {
  const raw = clone(inputs.info) as unknown as Record<string, any>;
  const gui: Record<string, unknown> = raw.gui && typeof raw.gui === 'object' ? raw.gui : {};
  raw.gui = gui;
  raw.renderedVersion = inputs.version;
  raw.presets = clone(inputs.presets ?? inputs.info.presets ?? []);
  raw.parameters = Array.isArray(raw.parameters) ? raw.parameters : [];
  const ports = (raw.ports = raw.ports ?? {});
  for (const type of ['audio', 'control', 'cv', 'midi']) {
    ports[type] = ports[type] ?? {};
    ports[type].input = ports[type].input ?? [];
    ports[type].output = ports[type].output ?? [];
  }
  const effect = raw as PreparedEffect;

  resolvePortGroups(effect.ports.control.input, raw.portGroups);

  // makePortIndexes
  const controls = new Map<string, ControlSpec>();
  for (const port of effect.ports.control.input) {
    controls.set(port.symbol, portSpec(port));
  }
  controls.set(':bypass', bypassSpec());
  controls.set(':presets', presetsSpec());

  // loadFileTypesList, then makeParameterIndexes
  const parameters = new Map<string, ControlSpec>();
  for (const parameter of effect.parameters) {
    if (parameter.type === ATOM + 'Path' && (parameter.fileTypes ?? []).length !== 0) {
      const { files, basepaths } = fileEntries(inputs.files?.get(parameter.uri), parameter.ranges?.default);
      parameter.files = files;
      parameter.basepaths = basepaths;
      parameter.path = true;
      parameter.t3k = false;
    }
    const spec = parameterSpec(parameter);
    if (spec) {
      parameters.set(parameter.uri, spec);
    }
  }

  // getTemplateData
  const templateData = gui.templateData && typeof gui.templateData === 'object' ? (gui.templateData as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...templateData };
  data.effect = effect;
  Object.assign(data, namespace(inputs.info.uri, inputs.version));
  data.brand = data.brand || gui.brand || '';
  data.label = data.label || gui.label || '';
  for (const key of ['color', 'knob', 'model', 'panel']) {
    data[key] = data[key] || gui[key];
  }
  const dataControls = (data.controls || gui.ports || []) as { symbol: string; comment?: string; scalePoints?: ScalePoint[] }[];
  data.controls = dataControls;
  for (const control of Array.isArray(dataControls) ? dataControls : []) {
    const spec = controls.get(control.symbol);
    if (spec) {
      control.comment = spec.comment;
      control.scalePoints = spec.scalePoints;
    }
  }

  const inputs_: WirePort[] = [];
  for (const port of effect.ports.control.input) {
    if (shouldSkipPort(port)) {
      continue;
    }
    const properties = port.properties ?? [];
    port.enumeration = properties.includes('enumeration');
    port.integer = properties.includes('integer');
    port.logarithmic = properties.includes('logarithmic');
    port.toggled = properties.includes('toggled');
    port.trigger = properties.includes('trigger');
    port.steps = (port.ranges?.maximum ?? 0) - (port.ranges?.minimum ?? 0) + 1;
    inputs_.push(port);
  }
  effect.all_control_in_ports = effect.ports.control.input;
  effect.ports.control.input = inputs_;

  for (const parameter of effect.parameters) {
    if (parameter.control) {
      const spec = parameters.get(parameter.uri)!;
      parameter.integer = spec.properties.includes('integer');
      parameter.toggled = spec.properties.includes('toggled');
    }
  }

  const presets = { factory: [] as PluginPresetInfo[], user: [] as PluginPresetInfo[] };
  for (const preset of effect.presets) {
    (preset.path ? presets.user : presets.factory).push(preset);
  }
  data.presets = presets;

  return { data, effect, controls, parameters };
}
