// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A small `sprintf` for the value formats of LV2 units (`%.1f dB`, `%d %%`, `%s`), as the classic UI uses `sprintf-0.6.js`.
 * @module
 */

const SPEC = /%([-+ 0#]*)(\d+)?(?:\.(\d+))?([diufFeEgGxXosc%])/g;

/**
 * Formats `values` with a printf-like `format`: `%d %i %u %f %e %g %x %X %o %s %c %%`, with the flags `- + space 0 #`, a width and a
 * precision. A missing value prints as an empty string; a non-numeric value given to a numeric conversion prints as `NaN`.
 *
 * @example
 * sprintf('%.1f dB', -3.04);   // "-3.0 dB"
 * sprintf('%d %%', 42.6);      // "43 %"  (rounded like the classic UI's port values, see below)
 * sprintf('%5.2f|%-4d|', 1, 2); // " 1.00|2   |"
 */
export function sprintf(format: string, ...values: unknown[]): string {
  let next = 0;
  return format.replace(SPEC, (_match, flags: string, width: string | undefined, precision: string | undefined, kind: string) => {
    if (kind === '%') {
      return '%';
    }
    const value = values[next++];
    let text: string;
    let numeric = true;
    const number = Number(value);
    switch (kind) {
      case 'd':
      case 'i':
      case 'u':
        // sprintf-0.6.js does parseInt(); the classic UI only passes numbers already rounded for integer ports, and rounding is what
        // a reader of a value field expects for the others.
        text = isNaN(number) ? 'NaN' : String(Math.abs(Math.round(number)));
        break;
      case 'f':
      case 'F':
        text = isNaN(number) ? 'NaN' : Math.abs(number).toFixed(precision === undefined ? 6 : parseInt(precision, 10));
        break;
      case 'e':
      case 'E':
        text = isNaN(number) ? 'NaN' : Math.abs(number).toExponential(precision === undefined ? 6 : parseInt(precision, 10));
        text = kind === 'E' ? text.toUpperCase() : text;
        break;
      case 'g':
      case 'G':
        text = isNaN(number) ? 'NaN' : String(Number(Math.abs(number).toPrecision(precision === undefined ? 6 : Math.max(1, parseInt(precision, 10)))));
        text = kind === 'G' ? text.toUpperCase() : text;
        break;
      case 'x':
      case 'X':
      case 'o':
        text = isNaN(number) ? 'NaN' : Math.abs(Math.trunc(number)).toString(kind === 'o' ? 8 : 16);
        text = kind === 'X' ? text.toUpperCase() : text;
        if (flags.includes('#') && number !== 0) {
          text = (kind === 'o' ? '0' : kind === 'x' ? '0x' : '0X') + text;
        }
        break;
      case 'c':
        numeric = false;
        text = typeof value === 'number' ? String.fromCharCode(value) : String(value ?? '').charAt(0);
        break;
      default: // 's'
        numeric = false;
        text = value === undefined || value === null ? '' : String(value);
        if (precision !== undefined) {
          text = text.slice(0, parseInt(precision, 10));
        }
    }

    let sign = '';
    if (numeric && !isNaN(number)) {
      // Like C, -0.001 with %.1f prints "-0.0"; an integer conversion that rounds to 0 prints "0".
      if (number < 0 && !(text === '0' && 'diu'.includes(kind))) {
        sign = '-';
      } else if (flags.includes('+')) {
        sign = '+';
      } else if (flags.includes(' ')) {
        sign = ' ';
      }
    }

    const size = width === undefined ? 0 : parseInt(width, 10);
    const length = sign.length + text.length;
    if (length >= size) {
      return sign + text;
    }
    if (flags.includes('-')) {
      return sign + text + ' '.repeat(size - length);
    }
    if (numeric && flags.includes('0')) {
      return sign + '0'.repeat(size - length) + text;
    }
    return ' '.repeat(size - length) + sign + text;
  });
}
