// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HTTP transport (internal): every request of the client goes through {@link HttpTransport}.
 * @module
 */

import { ModUiHttpError } from './errors';
import type { FetchLike } from './runtime';

/** Query string or form values. */
export type Query = Record<string, string | number | boolean>;

/** Thin `fetch` wrapper: builds URLs, decodes JSON and turns non-2xx answers into {@link ModUiHttpError}. */
export class HttpTransport {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: FetchLike) {}

  /** `GET path?query`, decoded as JSON. */
  getJson<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>(this.url(path, query), { method: 'GET' });
  }

  /**
   * `GET path?query`, decoded as text. Unlike {@link HttpTransport.getJson} it leaves the cache to the browser: it is meant for files whose
   * URL carries a version (modgui files, shared resources), which the server marks as cacheable.
   */
  async getText(path: string, query?: Query): Promise<string> {
    const url = this.url(path, query);
    const response = await this.fetchImpl(url, { method: 'GET' });
    const text = await response.text();
    if (!response.ok) {
      throw new ModUiHttpError(response.status, url, text);
    }
    return text;
  }

  /** `POST path` with an `application/x-www-form-urlencoded` body, decoded as JSON. */
  postForm<T>(path: string, form: Query): Promise<T> {
    return this.request<T>(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: toSearchParams(form).toString(),
    });
  }

  /** `POST path` with the bytes of `body` as an `application/octet-stream` body, decoded as JSON. */
  postBinary<T>(path: string, body: Blob | ArrayBuffer | Uint8Array): Promise<T> {
    return this.request<T>(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: body as BodyInit,
    });
  }

  /** `POST path` with a JSON body, decoded as JSON. */
  postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Absolute URL of `path` (with the optional query string), e.g. to put in an `<img src>`. */
  url(path: string, query?: Query): string {
    const search = query ? toSearchParams(query).toString() : '';
    return this.baseUrl + path + (search ? '?' + search : '');
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    // The backend sends no cache headers for these endpoints; never let the browser reuse an answer.
    const response = await this.fetchImpl(url, { ...init, cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) {
      throw new ModUiHttpError(response.status, url, text);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function toSearchParams(values: Query): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(values)) {
    params.append(key, String(values[key]));
  }
  return params;
}
