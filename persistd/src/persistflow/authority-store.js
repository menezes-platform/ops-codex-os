const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function digestClaimSecret(secret) {
  const value = String(secret || '');
  if (!value) throw new Error('CLAIM_SECRET_REQUIRED');
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameDigest(actual, expected) {
  if (!/^[0-9a-f]{64}$/i.test(String(expected || ''))) return false;
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function promoteSuccessor(state, { expectedGeneration, generation, claimSecret }) {
  if (Number(state.generation) !== Number(expectedGeneration)) throw new Error('STALE_GENERATION');
  if (!state.successor) throw new Error('CLAIM_NOT_PENDING');
  if (Number(state.successor.generation) !== Number(generation)
    || Number(generation) !== Number(expectedGeneration) + 1) {
    throw new Error('CLAIM_TARGET_MISMATCH');
  }
  const actual = digestClaimSecret(claimSecret);
  if (!sameDigest(actual, state.successor.claimNonceDigest)) throw new Error('CLAIM_NONCE_MISMATCH');
  return {
    ...state,
    generation: Number(generation),
    status: 'ACTIVE',
    successor: null,
    lastClaim: {
      generation: Number(generation),
      chatId: state.successor.chatId || null,
      consumed: true,
    },
  };
}

class MemoryAuthorityStore {
  constructor(states = []) {
    this.runs = new Map();
    this.kind = 'memory';
    for (const state of states) this.create(state);
  }

  create(state) {
    if (this.runs.has(state.runId)) throw new Error('RUN_ALREADY_EXISTS');
    this.runs.set(state.runId, clone(state));
    return this.get(state.runId);
  }

  get(runId) {
    return clone(this.runs.get(runId) || null);
  }

  update(runId, updater) {
    const current = this.runs.get(runId);
    if (!current) throw new Error('RUN_NOT_FOUND');
    const next = updater(clone(current));
    if (!next || next.runId !== runId) throw new Error('INVALID_RUN_UPDATE');
    this.runs.set(runId, clone(next));
    return clone(next);
  }

  claimSuccessor({ runId, expectedGeneration, generation, claimSecret }) {
    const state = this.runs.get(runId);
    if (!state) throw new Error('RUN_NOT_FOUND');
    const promoted = promoteSuccessor(state, { expectedGeneration, generation, claimSecret });
    this.runs.set(runId, clone(promoted));
    return clone(promoted);
  }
}

class FileAuthorityStore {
  constructor(directory) {
    this.directory = String(directory || '').trim();
    if (!this.directory) throw new Error('AUTHORITY_STORE_DIR_REQUIRED');
    this.kind = 'file';
  }

  filePath(runId) {
    const name = crypto.createHash('sha256').update(String(runId), 'utf8').digest('hex') + '.json';
    return path.join(this.directory, name);
  }

  read(runId) {
    const target = this.filePath(runId);
    try {
      const state = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (state.runId !== runId) throw new Error('RUN_ID_MISMATCH');
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  write(state) {
    fs.mkdirSync(this.directory, { recursive: true });
    const target = this.filePath(state.runId);
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, target);
  }

  create(state) {
    if (this.read(state.runId)) throw new Error('RUN_ALREADY_EXISTS');
    this.write(clone(state));
    return this.get(state.runId);
  }

  get(runId) {
    return clone(this.read(runId));
  }

  update(runId, updater) {
    const current = this.read(runId);
    if (!current) throw new Error('RUN_NOT_FOUND');
    const next = updater(clone(current));
    if (!next || next.runId !== runId) throw new Error('INVALID_RUN_UPDATE');
    this.write(clone(next));
    return clone(next);
  }

  claimSuccessor({ runId, expectedGeneration, generation, claimSecret }) {
    const state = this.read(runId);
    if (!state) throw new Error('RUN_NOT_FOUND');
    const promoted = promoteSuccessor(state, { expectedGeneration, generation, claimSecret });
    this.write(clone(promoted));
    return clone(promoted);
  }
}

module.exports = { MemoryAuthorityStore, FileAuthorityStore, digestClaimSecret };
