// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Test doubles and fixtures: the real `ModUiClient` over a fake socket and a fake `fetch`. */

import { beforeEach, vi } from 'vitest';
import { ModUiClient, type PluginInstance, type WebSocketLike } from 'modui-client';
import { PluginViews, type PluginViewsOptions } from '../src';
import defaultIcon from '../../html/resources/templates/pedal-default.html?raw';
import defaultSettings from '../../html/resources/settings.html?raw';

type Listener = (event: any) => void;

/** In-memory WebSocket: records sent frames and lets tests push server messages. */
export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly url = 'ws://fake/websocket') {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.dispatch('close', {});
  }
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  open(): void {
    this.readyState = 1;
    this.dispatch('open', {});
  }
  emit(message: string): void {
    this.dispatch('message', { data: message });
  }
  private dispatch(type: string, event: unknown): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
  }
}

export interface Call {
  method: string;
  url: string;
}

/**
 * Routes `"METHOD /path"` to answers and records every call. A string answer is sent as text (modgui files), anything else as JSON; a
 * function receives the call; a `Response` is sent as it is. Unknown routes answer 404.
 */
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', url };
    calls.push(call);
    const route = routes[`${call.method} ${new URL(url).pathname}`];
    if (route === undefined) {
      return new Response('<html>404: Not Found</html>', { status: 404 });
    }
    const value = await (typeof route === 'function' ? (route as (c: Call) => unknown)(call) : route);
    if (value instanceof Response) return value;
    return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: 200 });
  });
  return { fetchFn, calls };
}

export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Lets the timers of the widgets and views run (filmstrip measuring, icon size). */
export const settle = async () => {
  for (let i = 0; i < 3; i++) await flush();
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------

/** The real default templates of mod-ui. */
export { defaultIcon, defaultSettings };

export const fuzzUri = 'http://example.org/plugins/fuzz';
export const labelUri = fuzzUri + '#label';
export const sampleUri = fuzzUri + '#sample';
export const loopUri = fuzzUri + '#loop';
export const stepsUri = fuzzUri + '#steps';

const ATOM = 'http://lv2plug.in/ns/ext/atom#';

function port(symbol: string, index: number, extra: Record<string, unknown> = {}) {
  return { valid: true, index, symbol, name: symbol[0].toUpperCase() + symbol.slice(1), shortName: symbol, comment: `${symbol} comment`, properties: [], ...extra };
}

/** A plugin with a modgui that uses every kind of widget. */
export function fuzzInfo(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    uri: fuzzUri,
    name: 'Fuzz',
    brand: 'Example',
    label: 'Fuzz',
    comment: '',
    buildEnvironment: 'prod',
    category: ['Distortion'],
    microVersion: 2,
    minorVersion: 1,
    release: 0,
    builder: 7,
    licensed: 0,
    iotype: 1,
    binary: '',
    hasExternalUI: false,
    version: '1.2',
    stability: 'stable',
    ports: {
      audio: { input: [port('in', 0)], output: [port('out', 1)] },
      control: {
        input: [
          port('gain', 2, { ranges: { minimum: 0, maximum: 1, default: 0.5 }, units: { render: '%f dB', symbol: 'dB' } }),
          port('mode', 3, {
            ranges: { minimum: 0, maximum: 2, default: 0 },
            properties: ['enumeration', 'integer'],
            scalePoints: [
              { valid: true, value: 0, label: 'Soft' },
              { valid: true, value: 1, label: 'Hard' },
              { valid: true, value: 2, label: 'Fuzz' },
            ],
          }),
          port('boost', 4, { ranges: { minimum: 0, maximum: 1, default: 0 }, properties: ['toggled', 'integer'] }),
          port('tap', 5, { ranges: { minimum: 0, maximum: 1, default: 0 }, properties: ['trigger', 'toggled'] }),
          port('enabled', 6, {
            ranges: { minimum: 0, maximum: 1, default: 1 },
            designation: 'http://lv2plug.in/ns/lv2core#enabled',
            properties: ['toggled'],
          }),
        ],
        output: [port('level', 7, { ranges: { minimum: 0, maximum: 1, default: 0 } })],
      },
    },
    parameters: [
      { valid: true, readable: true, writable: true, uri: labelUri, label: 'Label', type: ATOM + 'String', ranges: { default: 'Hi' } },
      {
        valid: true,
        readable: true,
        writable: true,
        uri: sampleUri,
        label: 'Sample',
        type: ATOM + 'Path',
        ranges: { default: '' },
        fileTypes: ['audiosample'],
      },
      { valid: true, readable: true, writable: true, uri: loopUri, label: 'Loop', type: ATOM + 'Bool', ranges: { minimum: 0, maximum: 1, default: 0 } },
      { valid: true, readable: true, writable: true, uri: stepsUri, label: 'Steps', type: ATOM + 'Int', ranges: { minimum: 1, maximum: 16, default: 4 } },
    ],
    presets: [{ valid: true, uri: fuzzUri + '#preset-soft', label: 'Soft', path: '' }],
    gui: {
      resourcesDirectory: '/plugins/fuzz.lv2/modgui',
      iconTemplate: '/plugins/fuzz.lv2/modgui/icon.html',
      settingsTemplate: '',
      stylesheet: '/plugins/fuzz.lv2/modgui/style.css',
      javascript: '/plugins/fuzz.lv2/modgui/script.js',
      screenshot: '',
      thumbnail: '',
      brand: 'Example',
      label: 'FUZZ',
      model: 'boxy',
      panel: '3-knobs',
      color: 'red',
      knob: 'black',
      ports: [
        { valid: true, index: 2, name: 'Gain', symbol: 'gain' },
        { valid: true, index: 3, name: 'Mode', symbol: 'mode' },
      ],
      monitoredOutputs: ['level'],
    },
    ...overrides,
  };
}

/** The icon: a rotation knob (no filmstrip to measure), an enumeration, a switch, a trigger, the footswitch, parameters. */
export const iconTemplate = `<div class="fuzz{{{cns}}} mod-{{color}}">
  <h1 class="brand">{{brand}} {{label}}</h1>
  <div class="mod-light on" mod-role="bypass-light"></div>
  <div class="mod-footswitch" mod-role="bypass"></div>
  {{#controls}}<span class="title" data-symbol="{{symbol}}" title="{{comment}}">{{name}}</span>{{/controls}}
  <div class="knob" mod-role="input-control-port" mod-port-symbol="gain" mod-widget-rotation="270"></div>
  <span class="gain-value" mod-role="input-control-value" mod-port-symbol="gain"></span>
  <span mod-role="input-control-minimum" mod-port-symbol="gain"></span>
  <span mod-role="input-control-maximum" mod-port-symbol="gain"></span>
  <div class="mode" mod-role="input-control-port" mod-port-symbol="mode" mod-widget="custom-select">
    <span mod-role="input-control-value" mod-port-symbol="mode"></span>
    <div class="mod-enumerated-list">{{#effect.ports.control.input}}{{#enumeration}}{{#scalePoints}}<div mod-role="enumeration-option" mod-port-value="{{value}}">{{label}}</div>{{/scalePoints}}{{/enumeration}}{{/effect.ports.control.input}}</div>
  </div>
  <div class="boost" mod-role="input-control-port" mod-port-symbol="boost" mod-widget="switch"></div>
  <div class="tap" mod-role="input-control-port" mod-port-symbol="tap" mod-widget="switch"></div>
  <div class="loop" mod-role="input-parameter" mod-parameter-uri="${loopUri}" mod-widget="switch"></div>
  <div class="steps" mod-role="input-parameter" mod-parameter-uri="${stepsUri}" mod-widget-rotation="300"></div>
  <span class="steps-value" mod-role="input-parameter-value" mod-parameter-uri="${stepsUri}"></span>
  <img class="logo" src="/resources/logo.png{{{ns}}}">
  <span class="level" mod-role="level"></span>
  {{#effect.ports.audio.input}}<div class="jack" mod-role="input-audio-port" mod-port-symbol="{{symbol}}"></div>{{/effect.ports.audio.input}}
</div>`;

export const stylesheet = `.fuzz{{{cns}}} { background: url(/resources/fuzz.png{{{ns}}}); width: 200px; }`;

/**
 * The plugin script: records every event in `window.fuzzEvents`, shows the output level in `[mod-role=level]`, and asks for a boost when
 * the gain goes to the top. Uses the fake jQuery below (`event.icon.element`).
 */
export const script = `function (event, funcs) {
  window.fuzzEvents = window.fuzzEvents || [];
  window.fuzzEvents.push({ type: event.type, symbol: event.symbol, uri: event.uri, value: event.value, api: event.api_version });
  if (event.type === 'start') {
    event.data.started = true;
    window.fuzzStart = { ports: event.ports, parameters: event.parameters, url: funcs.get_custom_resource_filename('a.png'),
      index: funcs.get_port_index_for_symbol('level'), symbol: funcs.get_port_symbol_for_index(3) };
  }
  if (event.type === 'change' && event.symbol === 'level') {
    event.icon.element.querySelector('[mod-role=level]').textContent = 'L' + event.value.toFixed(2);
  }
  if (event.type === 'change' && event.symbol === 'gain' && event.value === 1) {
    funcs.set_port_value('boost', 1);
  }
  if (event.type === 'change' && event.symbol === 'mode' && event.value === 2) {
    throw new Error('broken on purpose');
  }
}`;

/** A jQuery stand-in: the script reaches the element through `.element`. */
export const fakeJQuery = (element: Element) => ({ element });

export const fuzzFrame = (bypassed = 0) => `add /graph/fuzz ${fuzzUri} 10.0 20.0 ${bypassed} 1.0.0.0 0`;

export function routes(info = fuzzInfo(), extra: Record<string, unknown> = {}) {
  return {
    'GET /effect/list': [],
    'POST /effect/bulk/': { [info.uri]: info },
    'GET /effect/get': info,
    'GET /effect/get_non_cached': { licensed: 0, presets: info.presets },
    'GET /effect/file/iconTemplate': iconTemplate,
    'GET /effect/file/stylesheet': stylesheet,
    'GET /effect/file/javascript': script,
    'GET /resources/templates/pedal-default.html': defaultIcon,
    'GET /resources/settings.html': defaultSettings,
    'GET /css/main.css': "@font-face { font-family: 'Nexa'; src: url('../fonts/nexa/Nexa.woff') format('woff'); } body { color: red }",
    'GET /files/list': {
      ok: true,
      files: [
        { fullname: '/data/user-files/Audio Samples/kick.wav', basename: 'kick.wav', dirname: '', basepath: '/data/user-files/Audio Samples', filetype: 'audiosample' },
        { fullname: '/data/user-files/Audio Samples/drums/snare.wav', basename: 'snare.wav', dirname: 'drums', basepath: '/data/user-files/Audio Samples', filetype: 'audiosample' },
      ],
    },
    ...extra,
  };
}

/** A client in sync with a pedalboard holding the Fuzz plugin, and a `PluginViews` created before the replay. */
export async function liveSetup(options: { frames?: string[]; info?: ReturnType<typeof fuzzInfo>; routes?: Record<string, unknown>; views?: PluginViewsOptions } = {}) {
  const info = options.info ?? fuzzInfo();
  const { fetchFn, calls } = fakeFetch(routes(info, options.routes));
  const client = new ModUiClient({ baseUrl: 'http://modduo.local', fetch: fetchFn as unknown as typeof fetch, WebSocket: FakeWebSocket });
  const views = new PluginViews(client, { fetch: fetchFn as unknown as typeof fetch, jQuery: fakeJQuery, ...options.views });
  const connecting = client.connect();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.open();
  socket.emit('loading_start 0 0');
  for (const frame of options.frames ?? [fuzzFrame()]) socket.emit(frame);
  socket.emit('loading_end 0');
  await connecting;
  const instance = (await client.device.currentPedalboard.plugins.list())[0] as PluginInstance;
  return { client, views, socket, instance, calls, fetchFn, info };
}

/** Dispatches a mouse event with page coordinates. */
export function mouse(target: EventTarget, type: string, init: { pageY?: number; pageX?: number; button?: number; shiftKey?: boolean } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, shiftKey: init.shiftKey });
  Object.defineProperty(event, 'pageX', { value: init.pageX ?? 0 });
  Object.defineProperty(event, 'pageY', { value: init.pageY ?? 0 });
  target.dispatchEvent(event);
}

/** The frames the client sent that start with `prefix`. */
export const sentWith = (socket: FakeWebSocket, prefix: string) => socket.sent.filter((frame) => frame.startsWith(prefix));
