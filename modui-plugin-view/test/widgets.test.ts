// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { StepModel, type ControlSpec } from '../src';
import { BypassWidget, CustomSelectPathWidget, CustomSelectWidget, FilmWidget, SwitchWidget, createWidget, nearestOption } from '../src/widgets';
import { mouse, settle } from './helpers';

function spec(extra: Partial<ControlSpec> = {}): ControlSpec {
  return {
    kind: 'port',
    key: 'x',
    name: 'X',
    comment: '',
    designation: '',
    ranges: { minimum: 0, maximum: 1, default: 0 },
    properties: [],
    scalePoints: [],
    units: {},
    format: '%.2f',
    ...extra,
  };
}

function host() {
  const changes: (number | string)[] = [];
  return {
    changes,
    host: { change: (value: number | string) => changes.push(value), imageSize: vi.fn(async () => ({ width: 640, height: 64 })) },
  };
}

function element(html = '<div></div>'): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root.firstElementChild as HTMLElement;
}

describe('StepModel', () => {
  it('maps a linear control onto the filmstrip frames', () => {
    const model = new StepModel(spec({ ranges: { minimum: -10, maximum: 10, default: 0 } }), 64);
    expect(model.portSteps).toBe(64);
    expect(model.linear).toBe(true);
    expect(model.stepsFromValue(0)).toBe(32);
    expect(model.valueFromSteps(64)).toBe(10);
    expect(model.valueFromSteps(99)).toBe(10);
  });

  it('uses one step per integer, halving large ranges', () => {
    expect(new StepModel(spec({ properties: ['integer'], ranges: { minimum: 0, maximum: 10, default: 0 } }), 64).portSteps).toBe(10);
    expect(new StepModel(spec({ properties: ['integer'], ranges: { minimum: 0, maximum: 1000, default: 0 } }), 64).portSteps).toBe(250);
  });

  it('works in log2 space for logarithmic ports with positive bounds only', () => {
    const log = new StepModel(spec({ properties: ['logarithmic'], ranges: { minimum: 20, maximum: 20480, default: 20 } }), 10);
    expect(log.logarithmic).toBe(true);
    expect(log.valueFromSteps(5)).toBeCloseTo(640);
    expect(log.stepsFromValue(640)).toBe(5);
    expect(new StepModel(spec({ properties: ['logarithmic'], ranges: { minimum: 0, maximum: 10, default: 0 } }), 10).logarithmic).toBe(false);
  });

  it('snaps enumerations to the nearest scale point', () => {
    const points = [0, 1, 5].map((value) => ({ value, label: String(value) }));
    const model = new StepModel(spec({ properties: ['enumeration'], scalePoints: points, ranges: { minimum: 0, maximum: 5, default: 0 } }), 64);
    expect(model.portSteps).toBe(2);
    expect(model.valueFromSteps(1.4)).toBe(1);
    expect(model.stepsFromValue(2.9)).toBe(1);
    expect(model.stepsFromValue(3.1)).toBe(2);
  });

  it('honours rangeSteps and toggles', () => {
    expect(new StepModel(spec({ rangeSteps: 5 }), 64).portSteps).toBe(4);
    expect(new StepModel(spec({ properties: ['toggled'] }), 64).portSteps).toBe(1);
  });
});

describe('FilmWidget', () => {
  it('rotates a mod-widget-rotation knob and reports drags, wheel and clicks', () => {
    const { host: h, changes } = host();
    const knob = element('<div mod-widget-rotation="270"></div>');
    const widget = new FilmWidget(knob, spec({ ranges: { minimum: 0, maximum: 1, default: 0.5 } }), h);
    expect(widget.ready).toBe(true);
    widget.setValue(0.5, true);
    expect(knob.style.transform).toBe('rotate(0deg)');
    widget.setValue(1, true);
    expect(knob.style.transform).toBe('rotate(135deg)');
    expect(changes).toEqual([]);

    widget.setValue(0.5, true);
    mouse(knob, 'mousedown', { pageY: 100 });
    mouse(document, 'mousemove', { pageY: 90 });
    mouse(document, 'mouseup', { pageY: 90 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeCloseTo(0.5 + 10 / 270);
    // The click that ends a drag does not step.
    mouse(knob, 'click');
    expect(changes).toHaveLength(1);
    // A plain click steps 4 frames of a linear rotation knob, shift goes down.
    mouse(knob, 'click');
    expect(changes[1]).toBeCloseTo(0.5 + 14 / 270);
    mouse(knob, 'click', { shiftKey: true });
    expect(changes[2]).toBeCloseTo(0.5 + 10 / 270);

    knob.dispatchEvent(Object.assign(new WheelEvent('wheel', { deltaY: -120, cancelable: true })));
    expect(changes[3]).toBeGreaterThan(changes[2] as number);
  });

  it('ignores gestures while disabled and after destroy', () => {
    const { host: h, changes } = host();
    const knob = element('<div mod-widget-rotation="270"></div>');
    const widget = new FilmWidget(knob, spec(), h);
    widget.disable();
    mouse(knob, 'click');
    expect(knob.classList.contains('disabled')).toBe(true);
    widget.enable();
    widget.destroy();
    mouse(knob, 'click');
    expect(changes).toEqual([]);
  });

  it('measures a filmstrip from its background image once it is in the page', async () => {
    const { host: h } = host();
    const knob = element('<div style="width: 64px; height: 64px; background-image: url(http://x/knob.png)"></div>');
    const widget = new FilmWidget(knob, spec({ ranges: { minimum: 0, maximum: 1, default: 0 } }), h);
    widget.setValue(1, true);
    expect(widget.ready).toBe(false);
    await settle();
    expect(h.imageSize).toHaveBeenCalledWith('http://x/knob.png');
    expect(widget.ready).toBe(true);
    // 640 x 64 image, 64 px wide element: 10 frames, so 9 steps; value 1 is the last frame.
    expect(knob.style.backgroundPosition).toBe('-576px 0px');
  });

  it('sends the maximum on press for a trigger and does not step on click', () => {
    const { host: h, changes } = host();
    const knob = element('<div mod-widget-rotation="180"></div>');
    new FilmWidget(knob, spec({ properties: ['trigger', 'toggled'] }), h);
    mouse(knob, 'mousedown');
    mouse(document, 'mouseup');
    mouse(knob, 'click');
    expect(changes).toEqual([1]);
  });

  it('presses and releases in momentary mode', () => {
    const { host: h, changes } = host();
    const knob = element('<div mod-widget-rotation="180"></div>');
    new FilmWidget(knob, spec({ properties: ['toggled', 'preferMomentaryOnByDefault'] }), h);
    mouse(knob, 'mousedown');
    mouse(document, 'mouseup');
    mouse(knob, 'click');
    expect(changes).toEqual([1, 0]);
  });
});

describe('SwitchWidget and BypassWidget', () => {
  it('toggles between minimum and maximum with on / off classes', () => {
    const { host: h, changes } = host();
    const el = element();
    const widget = new SwitchWidget(el, spec(), h);
    expect(el.className).toBe('off');
    mouse(el, 'click');
    expect(el.className).toBe('on');
    mouse(el, 'click');
    expect(changes).toEqual([1, 0]);
    widget.setValue(1, true);
    expect(el.classList.contains('on')).toBe(true);
  });

  it('gives the footswitch class on for the bypassed value and tells the lights', () => {
    const { host: h, changes } = host();
    const el = element();
    const lights = vi.fn();
    const widget = new BypassWidget(el, spec({ kind: 'bypass', ranges: { minimum: 0, maximum: 1, default: 1 }, properties: ['toggled', 'integer'] }), h, lights);
    widget.setValue(0, true);
    expect(el.classList.contains('off')).toBe(true);
    mouse(el, 'click');
    expect(el.classList.contains('on')).toBe(true);
    expect(changes).toEqual([1]);
    expect(lights).toHaveBeenLastCalledWith(1);
  });
});

describe('CustomSelectWidget', () => {
  const html = `<div mod-widget="custom-select"><span mod-role="input-control-value"></span><div class="mod-enumerated-list">
    <div mod-role="enumeration-option" mod-port-value="0">Soft</div><div mod-role="enumeration-option" mod-port-value="1">Hard</div>
    <div mod-role="enumeration-option" mod-port-value="2.5">Fuzz</div></div></div>`;

  it('selects the nearest option, shows its label and reports clicks', () => {
    const { host: h, changes } = host();
    const el = element(html);
    const widget = createWidget(el, spec({ ranges: { minimum: 0, maximum: 2.5, default: 0 } }), h);
    expect(widget).toBeInstanceOf(CustomSelectWidget);
    widget.setValue(2.2, true);
    expect(el.querySelector('.selected')!.textContent).toBe('Fuzz');
    expect(el.querySelector('[mod-role=input-control-value]')!.textContent).toBe('Fuzz');
    (el.querySelectorAll('[mod-role=enumeration-option]')[1] as HTMLElement).click();
    expect(changes).toEqual([1]);
    expect(el.querySelector('.selected')!.textContent).toBe('Hard');
  });

  it('toggles its list when clicked', () => {
    const { host: h } = host();
    const el = element(html);
    createWidget(el, spec(), h);
    const list = el.querySelector<HTMLElement>('.mod-enumerated-list')!;
    el.click();
    expect(list.style.display).toBe('none');
    el.click();
    expect(list.style.display).toBe('block');
  });

  it('nearestOption follows the backend rule', () => {
    const el = element(html);
    const all = Array.from(el.querySelectorAll<HTMLElement>('[mod-role=enumeration-option]'));
    expect(nearestOption(all, 1.00001)!.textContent).toBe('Hard');
    expect(nearestOption(all, 0.4)!.textContent).toBe('Soft');
    expect(nearestOption(all, 9)!.textContent).toBe('Fuzz');
  });
});

describe('CustomSelectPathWidget', () => {
  it('shows the root, enters and leaves folders, and opens the folder of the value', () => {
    const files = [
      { fullname: 'dir:///S/drums', basename: 'drums', dirname: 'drums', filetype: 'dir' },
      { fullname: '/S/kick.wav', basename: 'kick.wav', dirname: '', basepath: '/S' },
      { fullname: '/S/drums/snare.wav', basename: 'snare.wav', dirname: 'drums', basepath: '/S' },
    ];
    const options = files.map((file) => `<div mod-role="enumeration-option" mod-parameter-value="${file.fullname}">${file.basename}</div>`).join('');
    const el = element(`<div mod-widget="custom-select-path"><div class="mod-enumerated-list">${options}</div></div>`);
    const { host: h, changes } = host();
    const widget = new CustomSelectPathWidget(el, spec({ kind: 'parameter', path: true, files, basepaths: ['/S'] }), h);
    const option = (value: string) => el.querySelector<HTMLElement>(`[mod-parameter-value="${value}"]`)!;
    const hidden = (value: string) => option(value).classList.contains('mod-hidden');
    expect([hidden('dir:///S/drums'), hidden('/S/kick.wav'), hidden('/S/drums/snare.wav')]).toEqual([false, false, true]);

    option('dir:///S/drums').click();
    expect(widget.path).toEqual(['/S/drums']);
    expect([hidden('dir:///S/drums'), hidden('/S/kick.wav'), hidden('/S/drums/snare.wav')]).toEqual([false, true, false]);
    expect(option('dir:///S/drums').innerHTML).toContain('icon-folder-up');

    option('/S/drums/snare.wav').click();
    expect(changes).toEqual(['/S/drums/snare.wav']);
    expect(option('/S/drums/snare.wav').classList.contains('selected')).toBe(true);

    option('dir:///S/drums').click();
    expect(widget.path).toEqual([]);
    widget.setValue('/S/drums/snare.wav', true);
    expect(widget.path).toEqual(['/S/drums']);
  });
});
