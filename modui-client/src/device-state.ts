// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the device reports about itself: load, memory, transport, buffer size, true bypass and the current snapshot
 * ({@link DeviceState}, the engine behind `client.device.on(...)`).
 * @module
 */

import { Emitter, type ListenOptions, type Unsubscribe } from './emitter';
import type { EventChannel } from './events';

/** `stats`, about once a second: DSP load and xruns. */
export interface StatsEvent {
  /** DSP load, in percent. */
  cpuLoad: number;
  /** Audio dropouts since the counter was last reset. */
  xruns: number;
}

/** `sysStats`, every few seconds. `null` is "not available on this device". */
export interface SysStatsEvent {
  /** RAM in use, in percent. */
  memLoad: number | null;
  /** CPU frequency, in kHz. */
  cpuFreqKhz: number | null;
  /** CPU temperature, in thousandths of a degree Celsius (m°C). */
  cpuTempMilli: number | null;
}

/** `transport`: the global transport. */
export interface TransportEvent {
  rolling: boolean;
  beatsPerBar: number;
  bpm: number;
  /** `'none'`, `'midi_clock_slave'` or `'link'`. */
  syncMode: string;
}

/** `bufferSize`: the JACK buffer size changed. */
export interface BufferSizeEvent {
  frames: number;
}

/** `trueBypass`: the hardware true-bypass of each channel. */
export interface TrueBypassEvent {
  left: boolean;
  right: boolean;
}

/**
 * `snapshot`: the current *snapshot of the pedalboard* (the saved set of values the user switches between) changed. Not to be
 * confused with `currentPedalboard.getSnapshot()`, the state snapshot for UI frameworks.
 */
export interface SnapshotEvent {
  index: number;
  name: string;
}

/** Events of `client.device.on(...)`. */
export interface DeviceEvents {
  stats: StatsEvent;
  sysStats: SysStatsEvent;
  transport: TransportEvent;
  bufferSize: BufferSizeEvent;
  trueBypass: TrueBypassEvent;
  snapshot: SnapshotEvent;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function float(text: string | undefined): number | undefined {
  return text !== undefined && NUMBER.test(text) ? parseFloat(text) : undefined;
}

function int(text: string | undefined): number | undefined {
  return text !== undefined && /^-?\d+$/.test(text) ? parseInt(text, 10) : undefined;
}

/** A frequency or a temperature: `0` means "not available". */
function reading(text: string | undefined): number | null {
  const value = int(text);
  return value === undefined || value === 0 ? null : value;
}

/**
 * Keeps the last value of what the device reports and tells the application when it changes.
 *
 * It listens to the main WebSocket from the moment it is created, before the socket opens, so the state replay seeds the values: a
 * late subscriber reads them from the getters of `client.device`. `stats` and `sysStats` are periodic and are delivered every time;
 * the others are states and are delivered when they change. Values are kept while the connection is down (they are the last known).
 */
export class DeviceState {
  stats: StatsEvent | null = null;
  sysStats: SysStatsEvent | null = null;
  transport: TransportEvent | null = null;
  bufferSize: BufferSizeEvent | null = null;
  trueBypass: TrueBypassEvent | null = null;
  snapshot: SnapshotEvent | null = null;

  private readonly emitter = new Emitter<DeviceEvents>();

  constructor(events: EventChannel) {
    events.on('stats', (args) => {
      const [load, xruns] = args.split(' ');
      const cpuLoad = float(load);
      const count = int(xruns);
      if (cpuLoad !== undefined && count !== undefined) {
        this.stats = { cpuLoad, xruns: count };
        this.emitter.emit('stats', this.stats);
      }
    });
    events.on('sys_stats', (args) => {
      const [mem, freq, temp] = args.split(' ');
      this.sysStats = { memLoad: float(mem) ?? null, cpuFreqKhz: reading(freq), cpuTempMilli: reading(temp) };
      this.emitter.emit('sysStats', this.sysStats);
    });
    events.on('transport', (args) => {
      const [rolling, bpb, bpm, mode] = args.split(' ');
      const beatsPerBar = float(bpb);
      const tempo = float(bpm);
      if ((rolling === '0' || rolling === '1') && beatsPerBar !== undefined && tempo !== undefined) {
        // Some frames of the backend have no sync mode: it did not change.
        const next: TransportEvent = {
          rolling: rolling === '1',
          beatsPerBar,
          bpm: tempo,
          syncMode: mode || this.transport?.syncMode || 'none',
        };
        const last = this.transport;
        if (!last || last.rolling !== next.rolling || last.beatsPerBar !== next.beatsPerBar || last.bpm !== next.bpm || last.syncMode !== next.syncMode) {
          this.transport = next;
          this.emitter.emit('transport', next);
        }
      }
    });
    events.on('bufsize', (args) => {
      const frames = int(args.split(' ')[0]);
      if (frames !== undefined && frames !== this.bufferSize?.frames) {
        this.bufferSize = { frames };
        this.emitter.emit('bufferSize', this.bufferSize);
      }
    });
    events.on('truebypass', (args) => {
      const [left, right] = args.split(' ');
      if ((left === '0' || left === '1') && (right === '0' || right === '1')) {
        const next: TrueBypassEvent = { left: left === '1', right: right === '1' };
        if (!this.trueBypass || this.trueBypass.left !== next.left || this.trueBypass.right !== next.right) {
          this.trueBypass = next;
          this.emitter.emit('trueBypass', next);
        }
      }
    });
    events.on('pedal_snapshot', (args) => {
      const space = args.indexOf(' ');
      const index = int(space < 0 ? args : args.slice(0, space));
      if (index !== undefined) {
        const name = space < 0 ? '' : args.slice(space + 1); // the rest of the frame: it may hold spaces
        if (!this.snapshot || this.snapshot.index !== index || this.snapshot.name !== name) {
          this.snapshot = { index, name };
          this.emitter.emit('snapshot', this.snapshot);
        }
      }
    });
  }

  /** The buffer size that the backend answered to a write: applied like the `bufsize` frame (a repeated value emits nothing). */
  applyBufferSize(frames: number): void {
    if (frames !== this.bufferSize?.frames) {
      this.bufferSize = { frames };
      this.emitter.emit('bufferSize', this.bufferSize);
    }
  }

  /**
   * The true bypass that the backend accepted. Applied on top of the last known value; when none is known yet the frame that the
   * backend sends (the replay of a connection) will give the other channel, so nothing is invented.
   */
  applyTrueBypass(change: Partial<TrueBypassEvent>): void {
    const last = this.trueBypass;
    if (!last) {
      return;
    }
    const next: TrueBypassEvent = { left: change.left ?? last.left, right: change.right ?? last.right };
    if (next.left !== last.left || next.right !== last.right) {
      this.trueBypass = next;
      this.emitter.emit('trueBypass', next);
    }
  }

  on<K extends keyof DeviceEvents>(event: K, handler: (event: DeviceEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.emitter.on(event, handler, options);
  }

  once<K extends keyof DeviceEvents>(event: K, handler: (event: DeviceEvents[K]) => void, options?: ListenOptions): Unsubscribe {
    return this.emitter.once(event, handler, options);
  }
}
