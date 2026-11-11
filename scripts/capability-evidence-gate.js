'use strict';

// Deterministic, offline evidence gate for tool-substitution recommendations.
// This cannot determine whether a provider is genuine: evidence refs must be
// collected and verified by the caller. It prevents missing, stale, or
// contradictory evidence from being silently promoted into full equivalence.

const SOURCE_KINDS = new Set(['live-tool', 'official-doc', 'provider-response']);
const STATUSES = new Set(['supported', 'unsupported']);

function isVerifiedEvidence(source, nowMs, maxAgeMs) {
  if (!source || !SOURCE_KINDS.has(source.kind)) return false;
  if (typeof source.ref !== 'string' || !source.ref.trim()) return false;
  if (source.kind === 'official-doc' && !/^https:\/\//i.test(source.ref)) return false;
  if (source.kind === 'live-tool' && !/^(?:mcp:\/\/|https:\/\/)/i.test(source.ref)) return false;
  const checkedAt = Date.parse(source.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > nowMs) return false;
  return nowMs - checkedAt <= maxAgeMs;
}

function evaluateCandidate({ candidate, required, claims = [], now = new Date().toISOString(), maxAgeDays = 30 }) {
  if (typeof candidate !== 'string' || !candidate.trim()) throw new TypeError('candidate is required');
  if (!Array.isArray(required) || !required.length || required.some((r) => typeof r !== 'string' || !/^[a-z][a-z0-9_]*$/.test(r))) {
    throw new TypeError('required must be non-empty capability keys');
  }
  if (!Array.isArray(claims)) throw new TypeError('claims must be an array');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new TypeError('invalid freshness window');
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const normalized = [...new Set(required)];
  const supported = [], unsupported = [], unknown = [], conflicted = [];

  for (const capability of normalized) {
    const verifiedStates = new Set();
    for (const claim of claims) {
      if (claim?.capability !== capability || !STATUSES.has(claim.status)) continue;
      if (!isVerifiedEvidence(claim.source, nowMs, maxAgeMs)) continue;
      verifiedStates.add(claim.status);
    }
    if (verifiedStates.size > 1) {
      conflicted.push(capability);
      unknown.push(capability);
    } else if (verifiedStates.has('supported')) {
      supported.push(capability);
    } else if (verifiedStates.has('unsupported')) {
      unsupported.push(capability);
    } else {
      unknown.push(capability);
    }
  }

  const canClaimFullReplacement = supported.length === normalized.length && !unsupported.length && !unknown.length;
  return {
    candidate,
    required: normalized,
    supported,
    unsupported,
    unknown,
    conflicted,
    classification: canClaimFullReplacement ? 'full' : supported.length ? 'partial' : 'unverified',
    canClaimFullReplacement,
  };
}

module.exports = { evaluateCandidate, isVerifiedEvidence };
