// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Errors thrown by the client. Every error extends {@link ModUiError}.
 * @module
 */

/** Base class of every error thrown by this client. */
export class ModUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModUiError';
  }
}

/** The server answered with a non-2xx HTTP status. */
export class ModUiHttpError extends ModUiError {
  /**
   * @param status HTTP status code.
   * @param url Requested URL.
   * @param body Raw response body (Tornado error pages are HTML).
   */
  constructor(readonly status: number, readonly url: string, readonly body: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'ModUiHttpError';
  }
}

/** An awaited WebSocket message did not arrive in time. */
export class ModUiTimeoutError extends ModUiError {
  constructor(message: string) {
    super(message);
    this.name = 'ModUiTimeoutError';
  }
}

/** A write to `client.config.app` would make its JSON larger than the limit (10 KiB); nothing was sent. */
export class ModUiConfigTooLargeError extends ModUiError {
  /**
   * @param size Size in bytes that the JSON would have.
   * @param limit Largest size allowed, in bytes.
   */
  constructor(readonly size: number, readonly limit: number) {
    super(`The application settings would take ${size} bytes; the limit is ${limit} bytes`);
    this.name = 'ModUiConfigTooLargeError';
  }
}
