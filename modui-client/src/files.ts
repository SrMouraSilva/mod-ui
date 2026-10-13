// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The user files on the device: {@link FilesApi} (`client.files`).
 * @module
 */

import type { HttpTransport } from './http';
import type { UserFile, UserFileListResponse } from './types';

/**
 * The files the user put on the device (audio samples, impulse responses, amp models, ...). They are what a plugin's path parameter
 * (`patchParam.fileTypes`) can point at.
 *
 * @example
 * const [param] = (await instance.patchParams.list()).filter((p) => p.type === 'path');
 * const files = await client.files.list(param.fileTypes ?? []);
 * await param.setValue(files[0].fullname);
 */
export class FilesApi {
  /** @internal Use `client.files`. */
  constructor(private readonly http: HttpTransport) {}

  /**
   * Lists the user files of one or more types, sorted by full path. Never cached: the user can add files at any time.
   *
   * Backend: `GET /files/list?types=…` (operationId `listUserFiles`). Types the backend does not know are ignored by it. No request is
   * made for an empty list.
   * @param types File types, e.g. `['nammodel', 'cabsim']` (see the table of `listUserFiles` in `docs/openapi.yml`).
   * @example
   * const models = await client.files.list(['nammodel']);
   * console.log(models.map((file) => file.basename));
   */
  async list(types: readonly string[]): Promise<UserFile[]> {
    if (types.length === 0) {
      return [];
    }
    const response = await this.http.getJson<UserFileListResponse>('/files/list', { types: types.join(',') });
    return response.files;
  }
}
