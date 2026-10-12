// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The widgets of a modgui (`mod-widget="film" | "switch" | "bypass" | "select" | "custom-select" | "custom-select-path" | "string"`),
 * rewritten without jQuery from the `JqueryClass` widgets of `html/js/modgui.js`, with the same step arithmetic and gestures.
 * @module
 */

import type { ControlSpec, FileEntry } from './template-data';

/** What a widget needs from its view. */
export interface WidgetHost {
  /** The user moved the widget: write the value (the widget already shows it). */
  change(value: number | string): void;
  /** Loads an image and resolves with its natural size (for filmstrips). Injected so tests need no network. */
  imageSize(url: string): Promise<{ width: number; height: number }>;
  /** Clicked a special entry (`t3k://…`) of a file list. */
  specialUri?(value: string): void;
}

/** A widget bound to one element. */
export interface Widget {
  readonly element: HTMLElement;
  /** Shows `value`. `onlyGui`: do not report it as a change (it came from elsewhere). */
  setValue(value: number | string, onlyGui?: boolean): void;
  enable(): void;
  disable(): void;
  destroy(): void;
}

/** Names of `mod-widget`; `film` when missing. */
export type WidgetName = 'film' | 'switch' | 'bypass' | 'select' | 'string' | 'custom-select' | 'custom-select-path';

/** Pointer coordinates of a mouse event or a touch. */
interface Point {
  pageX: number;
  pageY: number;
  shiftKey?: boolean;
}

function touch(event: TouchEvent): Point {
  const first = event.changedTouches[0];
  return { pageX: first?.pageX ?? 0, pageY: first?.pageY ?? 0 };
}

/** Preferred momentary mode of a port: `1` on while pressed, `2` off while pressed, `0` none. */
function momentaryOf(spec: ControlSpec): number {
  if (spec.properties.includes('preferMomentaryOffByDefault')) return 2;
  if (spec.properties.includes('preferMomentaryOnByDefault')) return 1;
  return 0;
}

/**
 * The step arithmetic of `baseWidget.config` / `valueFromSteps` / `stepsFromValue`: a control is a number of steps between
 * `scaleMinimum` and `scaleMaximum` (log2 of the range for a logarithmic port).
 */
export class StepModel {
  readonly minimum: number;
  readonly maximum: number;
  readonly enumeration: boolean;
  readonly integer: boolean;
  readonly logarithmic: boolean;
  readonly toggled: boolean;
  readonly trigger: boolean;
  readonly linear: boolean;
  readonly scalePoints: { value: number; label: string }[];
  readonly scaleMinimum: number;
  readonly scaleMaximum: number;
  readonly portSteps: number;
  readonly wheelStep = 30;
  readonly stepDivider: number;
  readonly dragPrecisionVertical: number;
  readonly dragPrecisionHorizontal: number;

  /** @param filmSteps Number of frames of the filmstrip minus one (or the rotation in degrees): used by linear controls. */
  constructor(spec: ControlSpec, filmSteps: number) {
    const props = spec.properties;
    let portSteps: number;
    let dragPrecision: number;
    let linear: boolean;
    if (props.includes('toggled')) {
      portSteps = dragPrecision = 1;
      linear = false;
    } else if (props.includes('enumeration') && spec.scalePoints.length >= 2) {
      portSteps = spec.scalePoints.length - 1;
      dragPrecision = portSteps * 8;
      linear = false;
    } else if (props.includes('integer') && !props.includes('logarithmic')) {
      portSteps = spec.ranges.maximum - spec.ranges.minimum;
      while (portSteps > 300) {
        portSteps = Math.round(portSteps / 2);
      }
      dragPrecision = portSteps + 50 * Math.log10(1 + Math.pow(2, 1 / portSteps));
      linear = false;
    } else {
      portSteps = filmSteps;
      dragPrecision = portSteps / 2;
      linear = true;
    }
    if (spec.rangeSteps && spec.rangeSteps >= 2) {
      portSteps = dragPrecision = Math.min(spec.rangeSteps - 1, portSteps);
    }
    this.minimum = spec.ranges.minimum;
    this.maximum = spec.ranges.maximum;
    this.enumeration = props.includes('enumeration');
    this.integer = props.includes('integer');
    // log2 of a non-positive bound is undefined: such a port is treated as linear (as the classic UI does).
    this.logarithmic = props.includes('logarithmic') && this.minimum > 0 && this.maximum > 0;
    this.toggled = props.includes('toggled');
    this.trigger = props.includes('trigger');
    this.linear = linear;
    this.scalePoints = spec.scalePoints;
    this.scaleMinimum = this.logarithmic ? Math.log(this.minimum) / Math.log(2) : this.minimum;
    this.scaleMaximum = this.logarithmic ? Math.log(this.maximum) / Math.log(2) : this.maximum;
    this.portSteps = portSteps;
    this.stepDivider = portSteps / Math.max(portSteps, this.wheelStep);
    this.dragPrecisionVertical = Math.ceil(100 / dragPrecision);
    this.dragPrecisionHorizontal = Math.ceil(200 / dragPrecision);
  }

  valueFromSteps(steps: number): number {
    steps = Math.min(this.portSteps, Math.max(0, steps));
    let value = this.scaleMinimum + (steps * (this.scaleMaximum - this.scaleMinimum)) / this.portSteps;
    if (this.logarithmic) {
      value = Math.pow(2, value);
    }
    if (this.integer) {
      value = Math.round(value);
    }
    if (this.enumeration && this.scalePoints.length > 0) {
      value = this.scalePoints[Math.round(steps)]?.value ?? value;
    }
    return Math.min(this.maximum, Math.max(this.minimum, value));
  }

  stepsFromValue(value: number): number {
    if (this.enumeration && this.scalePoints.length > 0) {
      const points = this.scalePoints;
      if (value <= points[0].value) {
        return 0;
      }
      for (let step = 0; step < points.length; step++) {
        if (points[step + 1] === undefined) {
          return step;
        }
        if (value < points[step].value + (points[step + 1].value - points[step].value) / 2) {
          return step;
        }
      }
    }
    if (this.logarithmic) {
      value = Math.log(value) / Math.log(2);
    }
    if (this.integer) {
      value = Math.round(value);
    }
    return Math.round(((value - this.scaleMinimum) * this.portSteps) / (this.scaleMaximum - this.scaleMinimum));
  }
}

/** Shared parts of every widget: enabled state, listeners that are removed on `destroy()`. */
abstract class BaseWidget implements Widget {
  protected enabled = true;
  protected momentary: number;
  private readonly cleanups: (() => void)[] = [];

  constructor(readonly element: HTMLElement, protected readonly spec: ControlSpec, protected readonly host: WidgetHost) {
    this.momentary = momentaryOf(spec);
  }

  abstract setValue(value: number | string, onlyGui?: boolean): void;

  enable(): void {
    this.enabled = true;
    this.element.classList.remove('disabled');
  }

  disable(): void {
    this.enabled = false;
    this.element.classList.add('disabled');
  }

  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
  }

  protected listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): () => void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    const off = () => target.removeEventListener(type, listener, options);
    this.cleanups.push(off);
    return off;
  }

  protected onCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  /** mousedown + document mouseup, touchstart / touchend, with the momentary press logic of switches and knobs. */
  protected bindPress(down: (point: Point) => void, up: (point: Point) => void, move?: (point: Point) => void, tap?: () => void): void {
    const doc = this.element.ownerDocument;
    this.listen(this.element, 'mousedown', (event: MouseEvent) => {
      event.preventDefault();
      if (!this.enabled || event.button !== 0) {
        return;
      }
      down(event);
      const offMove = move ? this.listen(doc, 'mousemove', (e: MouseEvent) => this.enabled && move(e)) : () => undefined;
      const offUp = this.listen(doc, 'mouseup', (e: MouseEvent) => {
        offMove();
        offUp();
        up(e);
      });
    });
    this.listen(this.element, 'touchstart', (event: TouchEvent) => {
      event.preventDefault();
      if (this.enabled) {
        down(touch(event));
      }
    }, { passive: false });
    if (move) {
      this.listen(this.element, 'touchmove', (event: TouchEvent) => {
        event.preventDefault();
        if (this.enabled) {
          move(touch(event));
        }
      }, { passive: false });
    }
    this.listen(this.element, 'touchend', (event: TouchEvent) => {
      up(touch(event));
      // The classic UI turns the end of a touch into a click (`self.click()`): a tap toggles a switch, steps a knob.
      tap?.();
    });
  }
}

const URL_IN_CSS = /^url\(\s*['"]?([^'")]*)['"]?\s*\)/i;

/** A knob or a switch drawn with a filmstrip (`background-position`) or a rotated image (`mod-widget-rotation`). */
export class FilmWidget extends BaseWidget {
  private model: StepModel | null = null;
  private filmSteps = 1;
  private size = 0;
  private widgetRotation = false;
  private position = 0;
  private initValue: number;
  private dragged = false;
  private lastX = 0;
  private lastY = 0;
  private wheelBuffer = 0;
  private sizing: { stop(): void } | null = null;

  constructor(element: HTMLElement, spec: ControlSpec, host: WidgetHost) {
    super(element, spec, host);
    this.initValue = spec.ranges.default;
    this.listen(element, 'dragstart', (event: Event) => event.preventDefault());
    this.bindPress(
      (point) => this.mouseDown(point),
      () => this.mouseUp(),
      (point) => this.mouseMove(point),
      () => this.click({ pageX: 0, pageY: 0 }),
    );
    if (!spec.properties.includes('trigger')) {
      this.listen(element, 'wheel', (event: WheelEvent) => {
        if (!this.enabled) {
          return;
        }
        event.preventDefault();
        this.mouseWheel(event);
      }, { passive: false });
      this.listen(element, 'click', (event: MouseEvent) => this.click(event));
    }
    this.measure();
  }

  /** True once the filmstrip size is known and the widget shows values. */
  get ready(): boolean {
    return this.model !== null;
  }

  /** The step the widget shows (for tests and custom drawing). */
  get steps(): number {
    return this.position;
  }

  setValue(value: number | string, onlyGui = false): void {
    const number = Number(value);
    if (this.model) {
      this.position = this.model.stepsFromValue(number);
      this.setRotation(this.position);
    } else {
      this.initValue = number;
    }
    if (!onlyGui) {
      this.host.change(number);
    }
  }

  destroy(): void {
    this.sizing?.stop();
    super.destroy();
  }

  /** `getAndSetSize`: waits until the element has a background image (the stylesheet applied, the element in the page), then measures it. */
  private measure(): void {
    const rotation = parseInt(this.element.getAttribute('mod-widget-rotation') || '0', 10);
    if (rotation) {
      this.filmSteps = rotation;
      this.widgetRotation = true;
      this.configure();
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let observer: ResizeObserver | null = null;
    const stop = () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      observer?.disconnect();
    };
    this.sizing = { stop };
    const attempt = () => {
      timer = null;
      if (stopped) {
        return;
      }
      const url = this.backgroundUrl();
      if (!url) {
        timer = setTimeout(attempt, 200);
        return;
      }
      stop();
      const view = this.element.ownerDocument.defaultView;
      const style = view ? view.getComputedStyle(this.element) : null;
      const backgroundHeight = parseInt((style?.backgroundSize || '').split(' ')[1] || '0', 10) || 0;
      this.host.imageSize(url).then(
        ({ width, height }) => {
          if (this.sizing?.stop !== stop) {
            return;
          }
          const widthText = style?.width;
          const elementWidth = widthText && widthText !== 'auto' ? Math.round(parseFloat(widthText)) : this.element.offsetWidth;
          const frameHeight = backgroundHeight || height;
          this.filmSteps = elementWidth > 0 && height > 0 ? Math.max(1, Math.round((frameHeight * width) / (elementWidth * height)) - 1) : 1;
          this.size = elementWidth;
          this.configure();
        },
        () => undefined,
      );
    };
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (timer !== null) {
          clearTimeout(timer);
          attempt();
        }
      });
      observer.observe(this.element);
    }
    timer = setTimeout(attempt, 0);
  }

  private backgroundUrl(): string | null {
    if (!this.element.isConnected) {
      return null;
    }
    const view = this.element.ownerDocument.defaultView;
    const image = (view ? view.getComputedStyle(this.element).backgroundImage : '') || this.element.style.backgroundImage || '';
    const match = image.match(URL_IN_CSS);
    return match ? match[1] : null;
  }

  private configure(): void {
    this.model = new StepModel(this.spec, this.filmSteps);
    this.setValue(this.initValue, true);
  }

  private mouseDown(point: Point): void {
    this.dragged = false;
    this.lastX = point.pageX;
    this.lastY = point.pageY;
    if (this.spec.properties.includes('trigger')) {
      this.setValue(this.spec.ranges.maximum);
      return;
    }
    if (this.momentary === 1) this.setValue(this.spec.ranges.maximum);
    else if (this.momentary === 2) this.setValue(this.spec.ranges.minimum);
  }

  private mouseUp(): void {
    if (this.momentary === 1) this.setValue(this.spec.ranges.minimum);
    else if (this.momentary === 2) this.setValue(this.spec.ranges.maximum);
  }

  private mouseMove(point: Point): void {
    const model = this.model;
    if (!model) {
      return;
    }
    this.dragged = true;
    const hdiff = (this.lastX - point.pageX) / model.dragPrecisionHorizontal;
    const vdiff = (this.lastY - point.pageY) / model.dragPrecisionVertical;
    if (Math.abs(hdiff) > 0) this.lastX = point.pageX;
    if (Math.abs(vdiff) > 0) this.lastY = point.pageY;
    const position = Math.min(model.portSteps, Math.max(0, this.position + (vdiff - hdiff) * model.stepDivider));
    this.moveTo(position);
  }

  private click(event: Point): void {
    const model = this.model;
    if (!this.enabled || !model || this.spec.properties.includes('trigger')) {
      return;
    }
    // A click that ends a drag, or a click in momentary mode (handled by press / release), does not step.
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    if (this.momentary) {
      return;
    }
    const step = this.widgetRotation && model.linear ? 4 : 1;
    let position = this.position;
    if (event.shiftKey) {
      position -= step;
      if (position < 0) position = model.enumeration || model.toggled ? model.portSteps : 0;
    } else {
      position += step;
      if (position > model.portSteps) position = model.enumeration || model.toggled ? 0 : model.portSteps;
    }
    this.moveTo(position);
  }

  private mouseWheel(event: WheelEvent): void {
    const model = this.model;
    if (!model) {
      return;
    }
    // `wheelDelta` is 120 per notch, upwards positive; `deltaY` has the opposite sign and depends on `deltaMode`.
    const legacy = (event as unknown as { wheelDelta?: number }).wheelDelta;
    let delta = typeof legacy === 'number' && legacy !== 0 ? legacy : -event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1);
    const mult = this.widgetRotation && model.linear ? 4 : 1;
    delta += this.wheelBuffer;
    this.wheelBuffer = delta % model.wheelStep;
    let diff = (delta / model.wheelStep) * model.stepDivider * mult;
    if (diff === 0) {
      return;
    }
    diff = diff >= -1 && diff <= 1 ? (diff > 0 ? 1 : -1) : Math.round(diff);
    this.moveTo(Math.min(model.portSteps, Math.max(0, this.position + diff)));
  }

  private moveTo(position: number): void {
    this.position = position;
    this.setRotation(position);
    this.host.change(this.model!.valueFromSteps(position));
  }

  private setRotation(steps: number): void {
    const model = this.model!;
    if (model.integer) {
      steps = Math.round(steps);
    }
    let rotation = Math.min(this.filmSteps, Math.max(0, Math.round((steps / model.portSteps) * this.filmSteps)));
    if (this.widgetRotation) {
      rotation -= this.filmSteps / 2;
      this.element.style.transform = `rotate(${rotation}deg)`;
      return;
    }
    this.element.style.backgroundPosition = `${rotation * -this.size}px 0px`;
  }
}

/** A two-state switch: class `on` / `off`; click toggles between minimum and maximum. */
export class SwitchWidget extends BaseWidget {
  protected value: number;

  constructor(element: HTMLElement, spec: ControlSpec, host: WidgetHost) {
    super(element, spec, host);
    this.value = spec.ranges.default;
    this.setValue(spec.ranges.default, true);
    this.bindPress((point) => this.mouseDown(point), () => this.mouseUp(), undefined, () => this.element.click());
    if (!spec.properties.includes('trigger')) {
      this.listen(element, 'click', () => {
        if (!this.enabled || this.momentary) {
          return;
        }
        this.setValue(this.value === this.spec.ranges.minimum ? this.spec.ranges.maximum : this.spec.ranges.minimum);
      });
    }
  }

  setValue(value: number | string, onlyGui = false): void {
    this.value = Number(value);
    const on = this.value !== this.spec.ranges.minimum;
    this.element.classList.toggle('on', on);
    this.element.classList.toggle('off', !on);
    if (!onlyGui) {
      this.host.change(this.value);
    }
  }

  protected mouseDown(_point: Point): void {
    if (this.spec.properties.includes('trigger')) {
      this.setValue(this.spec.ranges.maximum);
      return;
    }
    if (this.momentary === 1) this.setValue(this.spec.ranges.maximum);
    else if (this.momentary === 2) this.setValue(this.spec.ranges.minimum);
  }

  protected mouseUp(): void {
    if (this.momentary === 1) this.setValue(this.spec.ranges.minimum);
    else if (this.momentary === 2) this.setValue(this.spec.ranges.maximum);
  }
}

/**
 * The footswitch: the value is the `:bypass` port (`1` = bypassed). Like the classic UI, the element gets class `on` when the value is
 * `1` and the bypass lights get the inverse (`off`). Momentary values are inverted.
 */
export class BypassWidget extends SwitchWidget {
  constructor(element: HTMLElement, spec: ControlSpec, host: WidgetHost, private readonly lights: (value: number) => void) {
    super(element, spec, host);
  }

  setValue(value: number | string, onlyGui = false): void {
    this.value = Number(value) ? 1 : 0;
    // `lights` is undefined while the base constructor runs; the view sets the lights itself right after.
    this.lights?.(this.value);
    this.element.classList.toggle('on', this.value === 1);
    this.element.classList.toggle('off', this.value !== 1);
    if (!onlyGui) {
      this.host.change(this.value);
    }
  }

  protected mouseDown(): void {
    if (this.momentary === 1) this.setValue(this.spec.ranges.minimum);
    else if (this.momentary === 2) this.setValue(this.spec.ranges.maximum);
  }

  protected mouseUp(): void {
    if (this.momentary === 1) this.setValue(this.spec.ranges.maximum);
    else if (this.momentary === 2) this.setValue(this.spec.ranges.minimum);
  }
}

/** A native `<select>` whose option values are the port values. */
export class SelectWidget extends BaseWidget {
  constructor(element: HTMLElement, spec: ControlSpec, host: WidgetHost) {
    super(element, spec, host);
    this.setValue(spec.ranges.default, true);
    this.listen(element, 'change', () => this.host.change(parseFloat((element as HTMLSelectElement).value)));
  }

  setValue(value: number | string, onlyGui = false): void {
    (this.element as HTMLSelectElement).value = String(value);
    if (!onlyGui) {
      this.host.change(Number(value));
    }
  }

  enable(): void {
    super.enable();
    (this.element as HTMLSelectElement).disabled = false;
  }

  disable(): void {
    super.disable();
    (this.element as HTMLSelectElement).disabled = true;
  }
}

function options(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>('[mod-role=enumeration-option]'));
}

/** jQuery's `.toggle()` of the lists inside the widget: a hidden list is shown (`block`), a visible one hidden. */
function toggleLists(element: HTMLElement): void {
  for (const list of Array.from(element.querySelectorAll<HTMLElement>('.mod-enumerated-list'))) {
    const view = list.ownerDocument.defaultView;
    const hidden = (view ? view.getComputedStyle(list).display : list.style.display) === 'none';
    list.style.display = hidden ? 'block' : 'none';
  }
}

/** A list of `mod-role=enumeration-option` entries with `mod-port-value`; the nearest one to the value is `selected`. */
export class CustomSelectWidget extends BaseWidget {
  constructor(element: HTMLElement, spec: ControlSpec, host: WidgetHost) {
    super(element, spec, host);
    this.setValue(spec.ranges.default, true);
    for (const option of options(element)) {
      this.listen(option, 'click', (event: MouseEvent) => {
        if (!this.enabled) {
          event.stopPropagation();
          return;
        }
        this.setValue(option.getAttribute('mod-port-value') ?? '');
      });
    }
    this.listen(element, 'click', () => toggleLists(element));
  }

  setValue(value: number | string, onlyGui = false): void {
    const number = parseFloat(String(value));
    const all = options(this.element);
    for (const option of all) option.classList.remove('selected');
    const selected = nearestOption(all, number);
    selected?.classList.add('selected');
    const field = this.element.querySelector<HTMLElement>('[mod-role=input-control-value]');
    if (field && selected) {
      field.textContent = selected.textContent;
    }
    if (!onlyGui) {
      this.host.change(number);
    }
  }
}

/** `getSelectedByValue`: the exact option, else one within 0.0001, else the nearest (same rule as the backend's scale point lookup). */
export function nearestOption(all: HTMLElement[], value: number): HTMLElement | undefined {
  const valueOf = (option: HTMLElement) => parseFloat(option.getAttribute('mod-port-value') ?? '');
  const exact = all.find((option) => option.getAttribute('mod-port-value') === String(value));
  if (exact) return exact;
  const close = all.find((option) => Math.abs(valueOf(option) - value) < 0.0001);
  if (close) return close;
  for (let i = 0; i < all.length - 1; i++) {
    if (Math.abs(valueOf(all[i]) - value) < Math.abs(valueOf(all[i + 1]) - value)) {
      return all[i];
    }
  }
  return all[all.length - 1];
}

const ICONS = {
  backArrow: '<i class="icon-folder-up mod-select-path-icon"></i>',
  folder: '<i class="icon-folder mod-select-path-icon"></i>',
  userFile: '<i class="icon-user-file mod-select-path-icon"></i>',
};

/** Parent folder of a path (`a/b/c` → `a/b`), the path itself when it has no slash. */
function parentOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash !== -1 ? path.slice(0, slash) : path;
}

/**
 * The file list of a path parameter: options with `mod-parameter-value` (a file, or `dir://<folder>`). Clicking a folder enters it,
 * clicking the open folder goes back up; only the entries of the current folder are shown (`mod-hidden` on the others).
 */
export class CustomSelectPathWidget extends BaseWidget {
  private readonly current: string[] = [];
  private value = '';

  constructor(element: HTMLElement, spec: ControlSpec, host: WidgetHost) {
    super(element, spec, host);
    for (const option of options(element)) {
      const value = option.getAttribute('mod-parameter-value') ?? '';
      const file = (spec.files ?? []).find((item) => item.fullname === value);
      const icon = file?.icon || (value.startsWith('dir://') ? ICONS.folder : ICONS.userFile);
      option.title = option.textContent ?? '';
      option.innerHTML = icon + option.innerHTML;
      this.listen(option, 'click', (event: MouseEvent) => {
        if (!this.enabled) {
          event.stopPropagation();
          return;
        }
        if (value.startsWith('dir://')) {
          event.stopPropagation();
          const last = this.current[this.current.length - 1];
          if (last !== undefined && 'dir://' + last === value) {
            this.current.pop();
          } else {
            this.current.push(value.slice('dir://'.length));
          }
          this.refresh();
        } else if (value.includes('://')) {
          this.host.specialUri?.(value);
        } else {
          this.setValue(value);
        }
      });
    }
    this.listen(element, 'click', () => toggleLists(element));
    this.refresh();
  }

  /** The folders entered, outermost first (each one absolute for the first level, as the classic UI keeps them). */
  get path(): readonly string[] {
    return this.current;
  }

  setValue(value: number | string, onlyGui = false): void {
    const text = String(value ?? '');
    const all = options(this.element);
    const selected = all.find((option) => option.getAttribute('mod-parameter-value') === text);
    if (!selected) {
      return;
    }
    this.value = text;
    for (const option of all) option.classList.remove('selected');
    selected.classList.add('selected');
    const field = this.element.querySelector<HTMLElement>('[mod-role=input-parameter-value]');
    if (field) {
      field.textContent = selected.textContent;
    }
    this.syncFolder(text);
    if (!onlyGui) {
      this.host.change(text);
    }
  }

  /** Opens the folders that hold `value`, so the selected file is visible. */
  private syncFolder(value: string): void {
    const folders = new Set(options(this.element).map((option) => option.getAttribute('mod-parameter-value')));
    const parts = value.split('/');
    const next: string[] = [];
    let path = '';
    for (let i = 0; i < parts.length - 1; i++) {
      path += (i > 0 ? '/' : '') + parts[i];
      if (folders.has('dir://' + path)) {
        next.push(path);
      }
    }
    if (next.length !== this.current.length || next.some((item, index) => item !== this.current[index])) {
      this.current.splice(0, this.current.length, ...next);
      this.refresh();
    }
  }

  private refresh(): void {
    const files: FileEntry[] = this.spec.files ?? [];
    const here = this.current[this.current.length - 1];
    const visible = new Set<string>();
    for (const file of files) {
      if (file.fullname.startsWith('t3k://')) {
        if (here === undefined) visible.add(file.fullname);
        continue;
      }
      const isDir = file.fullname.startsWith('dir://');
      const name = isDir ? file.fullname.slice('dir://'.length) : file.fullname;
      if (here === undefined) {
        // Root: the direct children of the type folders, and the default value.
        if ((this.spec.basepaths ?? []).includes(parentOf(name)) || file.dirname === '') {
          visible.add(file.fullname);
        }
      } else if (parentOf(name) === here || (isDir && name === here)) {
        // A folder: its direct children, and itself (clicking it goes back up).
        visible.add(file.fullname);
      }
    }
    for (const option of options(this.element)) {
      const value = option.getAttribute('mod-parameter-value') ?? '';
      option.classList.toggle('mod-hidden', !visible.has(value));
      if (value.startsWith('dir://')) {
        const open = this.current.includes(value.slice('dir://'.length));
        const hasArrow = option.innerHTML.startsWith(ICONS.backArrow);
        if (open && !hasArrow) option.innerHTML = ICONS.backArrow + option.innerHTML;
        if (!open && hasArrow) option.innerHTML = option.innerHTML.slice(ICONS.backArrow.length);
      }
    }
  }

  /** The value shown (the last one set). */
  get selected(): string {
    return this.value;
  }
}

/** A string parameter: the value lives in its value field (`mod-role=input-parameter-value`); the widget itself draws nothing. */
export class StringWidget extends BaseWidget {
  setValue(value: number | string, onlyGui = false): void {
    if (!onlyGui) {
      this.host.change(String(value));
    }
  }
}

/** Builds the widget named by the element's `mod-widget` attribute (`film` when missing). */
export function createWidget(element: HTMLElement, spec: ControlSpec, host: WidgetHost): Widget {
  const name = (element.getAttribute('mod-widget') || 'film') as WidgetName;
  switch (name) {
    case 'switch':
      return new SwitchWidget(element, spec, host);
    case 'select':
      return new SelectWidget(element, spec, host);
    case 'custom-select':
      return new CustomSelectWidget(element, spec, host);
    case 'custom-select-path':
      return new CustomSelectPathWidget(element, spec, host);
    case 'string':
      return new StringWidget(element, spec, host);
    case 'bypass':
      return new BypassWidget(element, spec, host, () => undefined);
    default:
      return new FilmWidget(element, spec, host);
  }
}
