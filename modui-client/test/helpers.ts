// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Test doubles and fixtures shared by the unit tests. */

import { afterEach, beforeEach, vi } from 'vitest';
import { ModUiClient, type PedalboardSummary, type WebSocketLike } from '../src';

// ---------------------------------------------------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------------------------------------------------

type Listener = (event: any) => void;

/** In-memory WebSocket: records sent frames and lets tests push server messages. */
export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string = 'ws://fake/websocket') {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
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

  /** Server side: open the connection. */
  open(): void {
    this.readyState = 1;
    this.dispatch('open', {});
  }
  /** Server side: push a text frame. */
  emit(message: string): void {
    this.dispatch('message', { data: message });
  }
  /** Server side: the initial state replay (shortened). */
  replay(): void {
    this.open();
    this.emit('stats 3.0 0');
    this.emit('loading_start 0 0');
    this.emit('loading_end 0');
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
  }
}

export interface Call {
  method: string;
  url: string;
  body?: string;
}

/** Routes "METHOD /path" to canned answers and records every call. */
export function fakeFetch(routes: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url, body: init?.body as string | undefined };
    calls.push(call);
    const path = new URL(url).pathname;
    const route = routes[`${call.method} ${path}`];
    if (route === undefined) {
      return new Response('<html>404: Not Found</html>', { status: 404 });
    }
    const value = await (typeof route === 'function' ? (route as (c: Call) => unknown)(call) : route);
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: 200 });
  });
  return { fetchFn, calls };
}

export const summaries: PedalboardSummary[] = [
  {
    broken: false,
    factory: false,
    hasTrialPlugins: false,
    uri: 'file:///root/.pedalboards/default.pedalboard/default.ttl',
    bundle: '/root/.pedalboards/default.pedalboard',
    title: 'Default',
    version: 0,
  },
  {
    broken: false,
    factory: false,
    hasTrialPlugins: false,
    uri: 'file:///root/.pedalboards/My_Board.pedalboard/My_Board.ttl',
    bundle: '/root/.pedalboards/My Board&Co.pedalboard',
    title: 'My Board',
    version: 3,
  },
];

export const infoBody = {
  title: 'My Board',
  width: 1200,
  height: 600,
  factory: false,
  midi_separated_mode: true,
  midi_loopback: false,
  plugins: [],
  connections: [],
  hardware: {
    audio_ins: 2,
    audio_outs: 2,
    cv_ins: 0,
    cv_outs: 0,
    midi_ins: [],
    midi_outs: [],
    serial_midi_in: false,
    serial_midi_out: false,
    midi_merger_out: false,
    midi_broadcaster_in: false,
  },
  timeInfo: { available: 0, bpb: 4, bpm: 120, rolling: false },
  version: 3,
  formatVersion: 2,
};

export function makeClient(routes: Record<string, unknown>, extra: Partial<ConstructorParameters<typeof ModUiClient>[0]> = {}) {
  const { fetchFn, calls } = fakeFetch(routes);
  const client = new ModUiClient({
    baseUrl: 'http://modduo.local/',
    fetch: fetchFn as unknown as typeof fetch,
    WebSocket: FakeWebSocket,
    ...extra,
  });
  return { client, calls, fetchFn };
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Opens the client's own socket and plays the initial replay. */
export async function connected(client: ModUiClient): Promise<FakeWebSocket> {
  const connecting = client.connect();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.replay();
  await connecting;
  return socket;
}

/** Registers the per-test reset of fakes and timers. Call once at the top of each test file. */
export function setupFakes(): void {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Plugins and graph
// ---------------------------------------------------------------------------------------------------------------------

export const gainUri = 'http://moddevices.com/plugins/mod-devel/Gain';
export const midiUri = 'http://moddevices.com/plugins/mod-devel/MidiThru';

function port(symbol: string, name: string, index: number, extra: Record<string, unknown> = {}) {
  return { valid: true, index, symbol, name, shortName: name, ...extra };
}

export const gainInfo = {
  valid: true,
  uri: gainUri,
  name: 'Gain',
  brand: 'MOD',
  label: 'Gain',
  comment: '',
  buildEnvironment: '',
  category: ['Utility'],
  microVersion: 0,
  minorVersion: 1,
  release: 0,
  builder: 0,
  licensed: 0,
  iotype: 1,
  binary: '',
  hasExternalUI: false,
  bypassable: true,
  version: '1.0',
  stability: 'stable',
  ports: {
    audio: { input: [port('in', 'In', 0)], output: [port('out', 'Out', 0)] },
    control: {
      input: [
        port('gain', 'Gain', 1, { ranges: { minimum: -90, maximum: 24, default: 0 }, properties: [] }),
        port('enabled', 'Enabled', 2, {
          ranges: { minimum: 0, maximum: 1, default: 1 },
          designation: 'http://lv2plug.in/ns/lv2core#enabled',
          properties: ['toggled'],
        }),
      ],
      output: [],
    },
  },
};

export const midiInfo = {
  ...gainInfo,
  uri: midiUri,
  name: 'MIDI Thru',
  label: 'MidiThru',
  ports: {
    midi: { input: [port('midi_in', 'MIDI In', 0)], output: [port('midi_out', 'MIDI Out', 0)] },
  },
};

export const patchUri = 'http://example.org/plugins/Patcher';
export const labelUri = patchUri + '#label';
export const sampleUri = patchUri + '#sample';
export const loopUri = patchUri + '#loop';
export const stepsUri = patchUri + '#steps';
export const chunkUri = patchUri + '#chunk';

const atom = (name: string) => 'http://lv2plug.in/ns/ext/atom#' + name;
function parameter(uri: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    valid: true,
    readable: true,
    writable: true,
    uri,
    label: uri.slice(uri.indexOf('#') + 1),
    type,
    ranges: { minimum: '', maximum: '', default: '' },
    comment: '',
    shortName: '',
    fileTypes: [],
    supportedExtensions: [],
    ...extra,
  };
}

/** A plugin with patch parameters: a string, a path, a bool, an int and a vector (not handled by the client). */
export const patchInfo = {
  ...gainInfo,
  uri: patchUri,
  name: 'Patcher',
  label: 'Patcher',
  ports: { audio: gainInfo.ports.audio },
  parameters: [
    parameter(labelUri, atom('String'), { ranges: { minimum: '', maximum: '', default: 'Hello' } }),
    parameter(sampleUri, atom('Path'), {
      readable: false,
      fileTypes: ['audio'],
      supportedExtensions: ['wav', '.FLAC'],
    }),
    parameter(loopUri, atom('Bool'), { ranges: { minimum: 0, maximum: 1, default: 0 } }),
    parameter(stepsUri, atom('Int'), { ranges: { minimum: 1, maximum: 16, default: 8 }, writable: false }),
    parameter(chunkUri, atom('Chunk')),
  ],
};

export const pluginSummaries = [gainInfo, midiInfo].map(({ ports: _ports, binary: _b, ...summary }) => summary);

/** Frames of a device with 2 audio inputs/outputs, one MIDI in and one MIDI out. */
export const hardwareFrames = [
  'add_hw_port /graph/capture_1 audio 0 Capture_1 1',
  'add_hw_port /graph/capture_2 audio 0 Capture_2 2',
  'add_hw_port /graph/playback_1 audio 1 Playback_1 1',
  'add_hw_port /graph/playback_2 audio 1 Playback_2 2',
  'add_hw_port /graph/midi_merger_out midi 0 All_MIDI_In 1',
  'add_hw_port /graph/midi_broadcaster_in midi 1 All_MIDI_Out 1',
];

/**
 * Opens the client's own socket and plays a state replay made of `frames` (between `loading_start` and
 * `loading_end`, like the real one).
 */
export async function connectedWith(client: ModUiClient, frames: string[]): Promise<FakeWebSocket> {
  const connecting = client.connect();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.open();
  socket.emit('loading_start 0 0');
  for (const frame of frames) socket.emit(frame);
  socket.emit('loading_end 0');
  await connecting;
  return socket;
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapshots and banks
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Opens the client's own socket and plays a replay of a pedalboard whose current snapshot is `snapshotId`, with a plugin so that
 * snapshot loads have something to change.
 */
export async function connectedAt(client: ModUiClient, snapshotId: number, frames: string[] = []): Promise<FakeWebSocket> {
  const connecting = client.connect();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.open();
  socket.emit('loading_start 0 0');
  for (const frame of frames) socket.emit(frame);
  socket.emit(`loading_end ${snapshotId}`);
  await connecting;
  return socket;
}

/**
 * The snapshot endpoints with the rules of `mod/host.py`: unique names (`Solo (2)`), `remove` renumbers and refuses the last one,
 * the current index follows `saveas` / `remove` like the backend does (and is not corrected after an earlier removal).
 */
export function fakeSnapshotBackend(names: string[], current = 0) {
  const state = { names: [...names], current, loads: [] as number[], saved: 0, onLoad: undefined as undefined | ((id: number) => void) };
  const unique = (name: string): string => {
    if (!state.names.includes(name)) return name;
    let n = 2;
    const base = name.replace(/ \(\d+\)$/, '');
    while (state.names.includes(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  };
  const idOf = (call: Call) => parseInt(new URL(call.url).searchParams.get('id') ?? '', 10);
  const arg = (call: Call, key: string) => new URL(call.url).searchParams.get(key) ?? '';
  const routes = {
    'GET /snapshot/list': () => Object.assign({}, ...state.names.map((name, i) => ({ [String(i)]: name }))),
    'POST /snapshot/save': () => {
      if (state.current < 0 || state.current >= state.names.length) return false;
      state.saved++;
      return true;
    },
    'GET /snapshot/saveas': (call: Call) => {
      state.names.push(unique(arg(call, 'title')));
      state.current = state.names.length - 1;
      return { ok: true, id: state.current, title: state.names[state.current] };
    },
    'GET /snapshot/rename': (call: Call) => {
      const id = idOf(call);
      if (!(id >= 0 && id < state.names.length)) return { ok: false, title: arg(call, 'title') };
      if (state.names[id] !== arg(call, 'title')) state.names[id] = unique(arg(call, 'title'));
      return { ok: true, title: state.names[id] };
    },
    'GET /snapshot/remove': (call: Call) => {
      const id = idOf(call);
      if (!(id >= 0 && id < state.names.length) || state.names.length === 1) return false;
      state.names.splice(id, 1);
      if (state.current === id) state.current = -1;
      return true;
    },
    'GET /snapshot/load': (call: Call) => {
      const id = idOf(call);
      if (!(id >= 0 && id < state.names.length)) return false;
      state.current = id;
      state.loads.push(id);
      state.onLoad?.(id);
      return true;
    },
  };
  return { state, routes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Plugin presets
// ---------------------------------------------------------------------------------------------------------------------

export interface FakePreset {
  valid: true;
  uri: string;
  label: string;
  path: string;
}

/**
 * The preset endpoints of one plugin instance with the rules of `mod/host.py`: `load` sends `preset` and `param_set` frames, saves send
 * nothing, replace and delete only work on the instance's current preset, delete sends `preset <instance> null`.
 */
export function fakePresetBackend(instance: string, initial: FakePreset[], holder: { socket?: FakeWebSocket }) {
  const state = {
    presets: initial.map((preset) => ({ ...preset })),
    current: null as string | null,
    calls: [] as string[],
    failReplace: false,
    holdLoad: undefined as undefined | (() => void),
    loadAnswer: undefined as undefined | boolean,
  };
  const arg = (call: Call, key: string) => new URL(call.url).searchParams.get(key) ?? '';
  const symbol = (name: string) => name.replace(/[^A-Za-z0-9]/g, '_').slice(0, 32);
  const note = (call: Call) => state.calls.push(`${new URL(call.url).pathname}${new URL(call.url).search}`);
  const routes: Record<string, unknown> = {
    'GET /effect/get_non_cached': (call: Call) => {
      note(call);
      return { presets: state.presets };
    },
    [`GET /effect/preset/load/${instance}`]: (call: Call) => {
      note(call);
      const uri = arg(call, 'uri');
      if (state.loadAnswer !== undefined) return state.loadAnswer;
      if (!state.presets.some((preset) => preset.uri === uri)) return false;
      state.current = uri;
      holder.socket!.emit(`preset ${instance} ${uri}`);
      holder.socket!.emit(`param_set ${instance} gain 6.5`);
      state.holdLoad?.();
      return true;
    },
    [`GET /effect/preset/save_new/${instance}`]: (call: Call) => {
      note(call);
      const name = arg(call, 'name');
      const bundle = `/root/.lv2/${symbol(instance)}-${symbol(name)}.lv2`;
      const uri = `file://${bundle}/${symbol(name)}.ttl`;
      state.presets.push({ valid: true, uri, label: name, path: bundle });
      state.current = uri;
      return { ok: true, bundle, uri };
    },
    [`GET /effect/preset/save_replace/${instance}`]: (call: Call) => {
      note(call);
      const found = state.presets.find((preset) => preset.uri === arg(call, 'uri') && preset.path === arg(call, 'bundle'));
      if (!found || state.current !== found.uri) return { ok: false };
      if (state.failReplace) {
        state.presets = state.presets.filter((preset) => preset !== found); // the backend removes the bundle on failure
        state.current = null;
        return { ok: false };
      }
      const name = arg(call, 'name');
      found.label = name;
      found.uri = `file://${found.path}/${symbol(name)}.ttl`;
      state.current = found.uri;
      return { ok: true, bundle: found.path, uri: found.uri };
    },
    [`GET /effect/preset/delete/${instance}`]: (call: Call) => {
      note(call);
      const found = state.presets.find((preset) => preset.uri === arg(call, 'uri') && preset.path === arg(call, 'bundle'));
      if (!found || state.current !== found.uri) return false;
      state.presets = state.presets.filter((preset) => preset !== found);
      state.current = null;
      holder.socket!.emit(`preset ${instance} null`);
      return true;
    },
  };
  return { state, routes };
}
