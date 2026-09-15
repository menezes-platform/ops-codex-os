const crypto = require('node:crypto');

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

class MemoryAuthorityStore {
  constructor(states = []) {
    this.runs = new Map();
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

  claimSuccessor({ runId, expectedGeneration, generation, claimSecret }) {
    const state = this.runs.get(runId);
    if (!state) throw new Error('RUN_NOT_FOUND');
    if (Number(state.generation) !== Number(expectedGeneration)) {
      throw new Error('STALE_GENERATION');
    }
    if (!state.successor) throw new Error('CLAIM_NOT_PENDING');
    if (Number(state.successor.generation) !== Number(generation)
      || Number(generation) !== Number(expectedGeneration) + 1) {
      throw new Error('CLAIM_TARGET_MISMATCH');
    }
    const actual = digestClaimSecret(claimSecret);
    if (!sameDigest(actual, state.successor.claimNonceDigest)) {
      throw new Error('CLAIM_NONCE_MISMATCH');
    }
    const promoted = {
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
    this.runs.set(runId, clone(promoted));
    return clone(promoted);
  }
}

module.exports = { MemoryAuthorityStore, digestClaimSecret };
