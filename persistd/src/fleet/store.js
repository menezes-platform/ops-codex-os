const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHeartbeat } = require('./contracts');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function snapshotRows(entries, { nowMs = Date.now(), staleAfterMs = 90_000 } = {}) {
  return [...entries]
    .map(([nodeId, heartbeat]) => {
      const observedMs = Date.parse(heartbeat.observedAt);
      const ageMs = Math.max(0, Number(nowMs) - observedMs);
      return { nodeId, heartbeat: clone(heartbeat), fresh: ageMs <= staleAfterMs, ageMs };
    })
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

class MemoryFleetStore {
  constructor() {
    this.nodes = new Map();
    this.kind = 'memory';
  }

  putHeartbeat(nodeId, heartbeat) {
    const id = String(nodeId || '').trim();
    if (!id) throw new Error('FLEET_NODE_ID_REQUIRED');
    const normalized = normalizeHeartbeat(heartbeat);
    this.nodes.set(id, clone(normalized));
    return { nodeId: id, heartbeat: clone(normalized) };
  }

  snapshot(options = {}) {
    return { nodes: snapshotRows(this.nodes.entries(), options) };
  }
}

class FileFleetStore {
  constructor(directory) {
    this.directory = String(directory || '').trim();
    if (!this.directory) throw new Error('FLEET_STORE_DIR_REQUIRED');
    this.kind = 'file';
  }

  filePath(nodeId) {
    const hash = crypto.createHash('sha256').update(String(nodeId), 'utf8').digest('hex');
    return path.join(this.directory, hash + '.json');
  }

  putHeartbeat(nodeId, heartbeat) {
    const id = String(nodeId || '').trim();
    if (!id) throw new Error('FLEET_NODE_ID_REQUIRED');
    const normalized = normalizeHeartbeat(heartbeat);
    fs.mkdirSync(this.directory, { recursive: true });
    const target = this.filePath(id);
    const temp = target + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ nodeId: id, heartbeat: normalized }) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temp, target);
    return { nodeId: id, heartbeat: clone(normalized) };
  }

  entries() {
    try {
      return fs.readdirSync(this.directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const value = JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8'));
          return [String(value.nodeId), normalizeHeartbeat(value.heartbeat)];
        });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  snapshot(options = {}) {
    return { nodes: snapshotRows(this.entries(), options) };
  }
}

module.exports = { MemoryFleetStore, FileFleetStore };
