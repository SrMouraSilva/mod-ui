// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { compileScript } from '../src/script';

describe('compileScript', () => {
  it('compiles a bare function expression', () => {
    expect(typeof compileScript('function (event, funcs) { return 1 }')).toBe('function');
  });

  it('accepts helper declarations after the function, like the classic eval (x42 fil4)', () => {
    const callback = compileScript('/* c */ function (event) { event.out = helper(2); }\n\nfunction helper(x) { return x * 21; }\n/* vim */');
    const event: Record<string, unknown> = {};
    callback(event, {} as never);
    expect(event.out).toBe(42);
  });

  it('refuses text that is not a function', () => {
    expect(() => compileScript('42')).toThrow(TypeError);
    expect(() => compileScript('function (')).toThrow(SyntaxError);
  });
});
