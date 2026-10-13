'use strict';

/**
 * A source-only preflight for P05 migration checkpoints. This function does
 * not authenticate evidence references or satisfy an architecture gate.
 */
function evaluateP05EntryEvidence(input) {
  const record = (value) => value !== null && typeof value === 'object'
    && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const validPhase = (value) => record(value)
    && ['PASSED', 'NOT_PASSED', 'OFFLINE_SOURCE_ONLY', 'BLOCKED'].includes(value.status)
    && typeof value.evidence_ref === 'string'
    && value.evidence_ref.trim() === value.evidence_ref
    && value.evidence_ref.length > 0
    && (value.status !== 'PASSED' || value.evidence_kind === 'runtime_verified');

  if (!record(input) || input.phase_id !== 'P05'
      || !validPhase(input.p03) || !validPhase(input.p04)) {
    throw new Error('P05_ENTRY_EVIDENCE_INVALID');
  }

  const blockers = [];
  if (input.p03.status !== 'PASSED') blockers.push('P03_EXIT_UNVERIFIED');
  if (input.p04.status !== 'PASSED') blockers.push('P04_EXIT_UNVERIFIED');
  if (!blockers.length) blockers.push('P05_RUNTIME_GATES_PENDING');

  return Object.freeze({
    phase_id: 'P05',
    formal_entry: blockers.includes('P03_EXIT_UNVERIFIED') || blockers.includes('P04_EXIT_UNVERIFIED')
      ? 'NOT_SATISFIED' : 'REQUIRES_RUNTIME_VERIFICATION',
    p05_release_allowed: false,
    blockers: Object.freeze(blockers),
  });
}

module.exports = { evaluateP05EntryEvidence };
