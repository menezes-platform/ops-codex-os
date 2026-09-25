const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[0-9a-f]{64}$/i;

class CatalogSync {
  constructor({ client, cacheRoot, rootId } = {}) {
    if (!client) throw new Error('DRIVE_CLIENT_REQUIRED');
    if (!cacheRoot) throw new Error('CACHE_ROOT_REQUIRED');
    if (!rootId) throw new Error('DRIVE_ROOT_ID_REQUIRED');
    this.client = client;
    this.cacheRoot = String(cacheRoot);
    this.rootId = String(rootId);
  }

  get statePath() {
    return path.join(this.cacheRoot, 'catalog-state.json');
  }

  readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return {
        pageToken: parsed.pageToken ? String(parsed.pageToken) : null,
        catalog: parsed.catalog && typeof parsed.catalog === 'object' ? parsed.catalog : {},
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return { pageToken: null, catalog: {} };
      throw error;
    }
  }

  writeState(state) {
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    const temp = this.statePath + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(state) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.statePath);
  }

  applyChange(state, change) {
    const fileId = String(change?.fileId || change?.file?.id || '');
    if (change?.removed === true || change?.file?.trashed === true) {
      let removed = 0;
      for (const [sha256, row] of Object.entries(state.catalog)) {
        if (String(row.fileId) === fileId) {
          delete state.catalog[sha256];
          removed += 1;
        }
      }
      return removed;
    }
    const file = change?.file;
    if (!file || !Array.isArray(file.parents) || !file.parents.includes(this.rootId)) return 0;
    const sha256 = String(file.appProperties?.gdb_sha256 || '').toLowerCase();
    if (!SHA256.test(sha256)) return 0;
    if (file.appProperties?.gdb_record && file.appProperties.gdb_record !== 'object') return 0;
    state.catalog[sha256] = {
      fileId: String(file.id || fileId),
      size: file.size == null ? null : Number(file.size),
      modifiedTime: file.modifiedTime || null,
    };
    return 1;
  }

  async syncOnce() {
    const state = this.readState();
    if (!state.pageToken) {
      state.pageToken = await this.client.getStartPageToken();
      this.writeState(state);
      return { initialized: true, pageToken: state.pageToken, applied: 0 };
    }

    let token = state.pageToken;
    let applied = 0;
    for (;;) {
      const page = await this.client.listChanges(token);
      for (const change of page.changes || []) {
        applied += this.applyChange(state, change);
      }
      if (page.nextPageToken) {
        token = String(page.nextPageToken);
        continue;
      }
      state.pageToken = String(page.newStartPageToken || token);
      break;
    }
    this.writeState(state);
    return { initialized: false, pageToken: state.pageToken, applied };
  }
}

module.exports = { CatalogSync };
