// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Image helpers (internal).
 * @module
 */

import { PluginViewError } from './types';

/** Loads an image and resolves with its natural size. */
export function loadImageSize(document: Document, url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const view = document.defaultView;
    if (!view || typeof view.Image !== 'function') {
      reject(new PluginViewError('No Image constructor'));
      return;
    }
    const image = new view.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new PluginViewError(`Cannot load ${url}`));
    image.src = url;
  });
}
