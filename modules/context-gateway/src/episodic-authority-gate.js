'use strict';
// A source-level gate is NOT proof that a production backup exists.
function decideEpisodicAuthority({ ownerApproval, rollbackReceipt } = {}) {
  const approved = ownerApproval && typeof ownerApproval === 'object' &&
    !Array.isArray(ownerApproval) && ownerApproval.approved === true &&
    ownerApproval.scope === 'personal/current' &&
    typeof ownerApproval.approval_id === 'string' &&
    ownerApproval.approval_id.trim().length > 0;
  const rollback = rollbackReceipt && typeof rollbackReceipt === 'object' &&
    !Array.isArray(rollbackReceipt) && rollbackReceipt.verified === true &&
    rollbackReceipt.restore_test_passed === true &&
    typeof rollbackReceipt.backup_ref === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(rollbackReceipt.backup_ref);
  return approved && rollback ? 'ready' : 'blocked';
}
module.exports = { decideEpisodicAuthority };