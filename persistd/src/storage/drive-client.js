const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK_BYTES = 8 * 1024 * 1024;
const FILE_FIELDS = 'id,name,size,mimeType,appProperties,modifiedTime';

function escapeQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function parseJson(response) {
  try { return await response.json(); }
  catch { return {}; }
}

function driveError(prefix, response, payload) {
  const error = new Error(prefix + '_' + response.status);
  error.status = response.status;
  error.payload = payload;
  return error;
}

function acceptedOffset(response, fallback = 0) {
  const range = String(response.headers?.get?.('range') || '');
  const match = /bytes=\d+-(\d+)/i.exec(range);
  return match ? Number(match[1]) + 1 : fallback;
}

class DriveClient {
  constructor({ tokenProvider, fetchImpl = globalThis.fetch } = {}) {
    if (typeof tokenProvider !== 'function') throw new Error('DRIVE_TOKEN_PROVIDER_REQUIRED');
    if (typeof fetchImpl !== 'function') throw new Error('DRIVE_FETCH_REQUIRED');
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async access() {
    const value = await this.tokenProvider();
    if (!value?.accessToken || !value?.rootId) throw new Error('DRIVE_ACCESS_INVALID');
    return value;
  }

  async authorizedFetch(url, init = {}) {
    const access = await this.access();
    const headers = { ...(init.headers || {}), authorization: 'Bearer ' + access.accessToken };
    return { response: await this.fetchImpl(url, { ...init, headers }), access };
  }

  async searchByHash(sha256) {
    if (!/^[0-9a-f]{64}$/i.test(String(sha256))) throw new Error('INVALID_SHA256');
    const access = await this.access();
    const query = [
      "'" + escapeQueryValue(access.rootId) + "' in parents",
      'trashed = false',
      "appProperties has { key='gdb_sha256' and value='" + escapeQueryValue(sha256) + "' }",
    ].join(' and ');
    const params = new URLSearchParams({
      q: query,
      fields: 'files(' + FILE_FIELDS + '),nextPageToken',
      pageSize: '1000',
    });
    const response = await this.fetchImpl(DRIVE_API + '/files?' + params, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + access.accessToken },
    });
    const payload = await parseJson(response);
    if (!response.ok) throw driveError('DRIVE_SEARCH_HTTP', response, payload);
    return Array.isArray(payload.files) ? payload.files : [];
  }

  async createFolder(name, parentId) {
    const { response } = await this.authorizedFetch(
      DRIVE_API + '/files?fields=' + encodeURIComponent(FILE_FIELDS),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(name),
          mimeType: 'application/vnd.google-apps.folder',
          parents: [String(parentId)],
        }),
      },
    );
    const payload = await parseJson(response);
    if (!response.ok) throw driveError('DRIVE_FOLDER_HTTP', response, payload);
    return payload;
  }

  async createJsonFile({ name, parentId, appProperties = {}, value } = {}) {
    const access = await this.access();
    const boundary = 'gdb-' + crypto.randomUUID();
    const metadata = JSON.stringify({
      name: String(name),
      parents: [String(parentId)],
      appProperties,
      mimeType: 'application/json',
    });
    const data = JSON.stringify(value);

    const body = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' + data + '\r\n' +
      '--' + boundary + '--\r\n',
      'utf8',
    );
    const params = new URLSearchParams({ uploadType: 'multipart', fields: FILE_FIELDS });
    const response = await this.fetchImpl(DRIVE_UPLOAD + '/files?' + params, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + access.accessToken,
        'content-type': 'multipart/related; boundary=' + boundary,
        'content-length': String(body.length),
      },
      body,
    });
    const payload = await parseJson(response);
    if (!response.ok) throw driveError('DRIVE_JSON_UPLOAD_HTTP', response, payload);
    return payload;
  }

  async updateAppProperties(fileId, patch) {
    const { response } = await this.authorizedFetch(
      DRIVE_API + '/files/' + encodeURIComponent(fileId) + '?fields=' + encodeURIComponent(FILE_FIELDS),
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appProperties: patch || {} }),
      },
    );
    const payload = await parseJson(response);
    if (!response.ok) throw driveError('DRIVE_PROPERTIES_HTTP', response, payload);
    return payload;
  }

  async startResumableUpload({ name, parentId, appProperties = {}, size, mimeType = 'application/octet-stream' } = {}) {
    const access = await this.access();
    const params = new URLSearchParams({ uploadType: 'resumable', fields: FILE_FIELDS });
    const response = await this.fetchImpl(DRIVE_UPLOAD + '/files?' + params, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + access.accessToken,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': String(mimeType),
        'x-upload-content-length': String(size),
      },

      body: JSON.stringify({
        name: String(name),
        parents: [String(parentId)],
        appProperties,
      }),
    });
    if (!response.ok) {
      const payload = await parseJson(response);
      throw driveError('DRIVE_RESUMABLE_START_HTTP', response, payload);
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('DRIVE_RESUMABLE_LOCATION_MISSING');
    return location;
  }

  async uploadFileResumable({ filePath, sessionUrl, startOffset = 0 } = {}) {
    const stat = await fs.promises.stat(filePath);
    const total = Number(stat.size);
    let offset = Number(startOffset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > total) throw new Error('INVALID_UPLOAD_OFFSET');
    const handle = await fs.promises.open(filePath, 'r');
    try {
      while (offset < total) {
        const length = Math.min(CHUNK_BYTES, total - offset);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead <= 0) throw new Error('DRIVE_UPLOAD_READ_EOF');
        const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
        const end = offset + bytesRead - 1;
        try {
          const response = await this.fetchImpl(sessionUrl, {
            method: 'PUT',
            headers: {
              'content-length': String(bytesRead),
              'content-range': 'bytes ' + offset + '-' + end + '/' + total,
            },
            body: chunk,
          });
          if (response.status === 308) {
            offset = acceptedOffset(response, end + 1);
            continue;
          }
          const payload = await parseJson(response);
          if (response.ok && (response.status === 200 || response.status === 201)) return payload;
          throw driveError('DRIVE_RESUMABLE_UPLOAD_HTTP', response, payload);
        } catch (error) {

          if (error?.status) throw error;
          const probe = await this.fetchImpl(sessionUrl, {
            method: 'PUT',
            headers: {
              'content-length': '0',
              'content-range': 'bytes */' + total,
            },
            body: Buffer.alloc(0),
          });
          if (probe.status === 308) {
            offset = acceptedOffset(probe, offset);
            continue;
          }
          const payload = await parseJson(probe);
          if (probe.ok && (probe.status === 200 || probe.status === 201)) return payload;
          throw driveError('DRIVE_RESUMABLE_PROBE_HTTP', probe, payload);
        }
      }
      throw new Error('DRIVE_UPLOAD_COMPLETION_MISSING');
    } finally {
      await handle.close();
    }
  }

  async downloadToFile(fileId, targetPath) {
    const access = await this.access();
    const response = await this.fetchImpl(
      DRIVE_API + '/files/' + encodeURIComponent(fileId) + '?alt=media',
      {
        method: 'GET',
        headers: { authorization: 'Bearer ' + access.accessToken },
      },
    );
    if (!response.ok) {
      const payload = await parseJson(response);
      throw driveError('DRIVE_DOWNLOAD_HTTP', response, payload);
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const partial = targetPath + '.partial-' + crypto.randomUUID();
    try {
      if (response.body) {
        const source = typeof response.body.getReader === 'function'
          ? Readable.fromWeb(response.body)
          : response.body;
        await pipeline(source, fs.createWriteStream(partial, { flags: 'wx' }));
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());

        await fs.promises.writeFile(partial, bytes, { flag: 'wx' });
      }
      return partial;
    } catch (error) {
      await fs.promises.rm(partial, { force: true }).catch(() => {});
      throw error;
    }
  }

  async getStartPageToken() {
    const { response } = await this.authorizedFetch(
      DRIVE_API + '/changes/startPageToken?supportsAllDrives=true',
      { method: 'GET' },
    );
    const payload = await parseJson(response);
    if (!response.ok) throw driveError('DRIVE_START_TOKEN_HTTP', response, payload);
    if (!payload.startPageToken) throw new Error('DRIVE_START_TOKEN_MISSING');
    return String(payload.startPageToken);
  }

  async listChanges(pageToken) {
    const access = await this.access();
    const params = new URLSearchParams({
      pageToken: String(pageToken),
      pageSize: '1000',
      includeRemoved: 'true',
      supportsAllDrives: 'true',
      fields: 'changes(fileId,removed,file(id,name,size,mimeType,appProperties,modifiedTime,parents,trashed)),nextPageToken,newStartPageToken',
    });
    const response = await this.fetchImpl(DRIVE_API + '/changes?' + params, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + access.accessToken },
    });
    const payload = await parseJson(response);
    if (!response.ok) throw driveError('DRIVE_CHANGES_HTTP', response, payload);
    return payload;
  }
}

module.exports = {
  DriveClient,
  CHUNK_BYTES,
  DRIVE_API,
  DRIVE_UPLOAD,
  acceptedOffset,
};
