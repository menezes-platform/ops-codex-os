const path = require('node:path');
const crypto = require('node:crypto');
const { resolveRun } = require('./resolver');
const { readControl, writeControlAtomic } = require('./control-state');
const { acquireLock, claimLease } = require('./lease');
const { buildSuccessorMessage } = require('./handoff');
const { claimGeneration } = require('./claim-generation');
const { buildClaimRequestLine } = require('./claim-protocol');
const { buildTerminalMessage, buildAttentionMessage } = require('./notifier');
const { evaluateWatchdog } = require('./persistflow/watchdog');
const { reconcileRemoteRun } = require('./persistflow/remote-bridge');
const { applyQuotaGuardToState } = require('./quota-guard');

function buildChatTitle(displayName, generation, totalGenerations) {
  const base = String(displayName || 'Persist').trim() || 'Persist';
  return totalGenerations
    ? `${base} ${generation} de ${totalGenerations}`
    : `${base} ${generation}`;
}

function resolveDisplayName(state = {}) {
  const explicit = String(state.DISPLAY_NAME || '').trim();
  if (explicit && explicit !== 'NONE') return explicit;

  const taskFirst = String(state.TASK_ID || '').trim().split(/[\s_-]+/)[0];
  if (taskFirst && /[a-z][A-Z]/.test(taskFirst)) return taskFirst;

  const runFirst = String(state.RUN_ID || '').trim().split(/[\s_-]+/)[0];
  const token = runFirst || taskFirst;
  if (!token) return 'Persist';
  if (/^[A-Z0-9]+$/.test(token) || /^[a-z0-9]+$/.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  }
  return token;
}

function appendChatHistory(state, chatId) {
  if (!chatId) return state;
  let history = [];
  try { history = JSON.parse(state.CHAT_HISTORY_JSON || '[]'); } catch {}
  if (history.some((item) => item.chatId === chatId)) return state;
  return {
    ...state,
    CHAT_HISTORY_JSON: JSON.stringify([...history, { index: history.length + 1, chatId }]),
  };
}

async function notifyBlockedOnce({ controlPath, state, notifier, now }) {
  if (state.BLOCKED_NOTIFICATION_STATUS === 'SENT' || !notifier?.attention) return state;
  const attention = await notifier.attention({
    state, kind: 'BLOCKED_FATAL', message: buildAttentionMessage(state, 'BLOCKED_FATAL'),
  });
  const updated = attention?.sent ? {
    ...state, BLOCKED_NOTIFICATION_STATUS: 'SENT', BLOCKED_NOTIFIED_AT: now.toISOString(),
    BLOCKED_NOTIFICATION_CHANNEL: attention.channel || 'unknown',
  } : { ...state, BLOCKED_NOTIFICATION_STATUS: 'FAILED' };
  writeControlAtomic(controlPath, updated);
  return updated;
}

function isRolloverDue(state, now, rolloverMinutes) {
  if (['CONTEXT_RISK', 'ROLLOVER_INCOMPLETE', 'PREPARING_TAKEOVER', 'RECOVERY_REQUIRED'].includes(state.STATUS)) return true;
  const anchorText = state.CLAIM_RESUMED_AT && state.CLAIM_RESUMED_AT !== 'NONE'
    ? state.CLAIM_RESUMED_AT
    : (state.CLAIMED_AT && state.CLAIMED_AT !== 'NONE' ? state.CLAIMED_AT : state.STARTED_AT);
  if (!anchorText) return false;
  const anchor = Date.parse(anchorText);
  return Number.isFinite(anchor) && now.getTime() - anchor >= rolloverMinutes * 60_000;
}

async function recordRolloverFailure({ controlPath, generation, now, notifier, reason, orphanTargetId = null }) {
  const current = readControl(controlPath);
  if (Number.parseInt(current.GENERATION || '0', 10) !== generation) {
    return { action: 'ROLLOVER_INCOMPLETE', generation };
  }
  const attempts = Number.parseInt(current.ROLLOVER_ATTEMPTS || '0', 10) + 1;
  const orphanFields = orphanTargetId ? { BROWSER_ORPHAN_TARGET_ID: orphanTargetId, BROWSER_ORPHAN_STATUS: 'RETRY_SCHEDULED', BROWSER_ORPHAN_ATTEMPTS: '0', BROWSER_ORPHAN_NEXT_AT: now.toISOString(), BROWSER_ORPHAN_DEBT_SINCE: now.toISOString() } : {};
  if (attempts >= 3) {
    const blocked = {
      ...current, ...orphanFields, STATUS: 'BLOCKED', LEASE_OWNER: `G${generation}`,
      ROLLOVER_ATTEMPTS: String(attempts), BLOCKED_REASON: reason,
      BLOCKED_AT: now.toISOString(),
    };
    writeControlAtomic(controlPath, blocked);
    await notifyBlockedOnce({ controlPath, state: blocked, notifier, now });
    return { action: 'BLOCKED', generation };
  }
  writeControlAtomic(controlPath, {
    ...current, ...orphanFields, STATUS: 'ROLLOVER_INCOMPLETE', LEASE_OWNER: `G${generation}`,
    ROLLOVER_ATTEMPTS: String(attempts), BLOCKED_REASON: reason,
  });
  return { action: 'ROLLOVER_INCOMPLETE', generation };
}

function parseChatHistory(state) {
  try {
    const value = JSON.parse(state.CHAT_HISTORY_JSON || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function mergeDiscoveredChatHistory(state, discoveredChats = []) {
  const byId = new Map();
  for (const item of [...parseChatHistory(state), ...discoveredChats]) {
    if (!item?.chatId || byId.has(item.chatId)) continue;
    byId.set(item.chatId, { chatId: item.chatId });
  }
  return [...byId.values()]
    .sort((a, b) => a.chatId.localeCompare(b.chatId))
    .map((item, index) => ({ index: index + 1, chatId: item.chatId }));
}

async function reconcileChatPresentation({ controlPath, state, browser }) {
  if (!browser?.discoverRunChats) return state;
  let discovery;
  try { discovery = await browser.discoverRunChats({ state }); } catch { return state; }
  const fresh = readControl(controlPath);
  if (fresh.GENERATION !== state.GENERATION || fresh.STATUS !== state.STATUS) return fresh;
  const taskSpaceId = discovery?.taskSpaceId || fresh.BROWSER_TASKSPACE_ID || 'NONE';
  if (taskSpaceId === fresh.BROWSER_TASKSPACE_ID) return fresh;
  const updated = { ...fresh, BROWSER_TASKSPACE_ID: taskSpaceId };
  writeControlAtomic(controlPath, updated);
  return updated;
}

async function retryActivePrune({ controlPath, state, browser, now }) {
  const pending = ['PENDING', 'FAILED'].includes(state.BROWSER_PRUNE_STATUS);
  const keepChatId = state.BROWSER_PRUNE_CHAT_ID;
  if (!pending || !keepChatId || keepChatId === 'NONE' || !browser?.pruneRunTabs) return state;
  let updated;
  try {
    const result = await browser.pruneRunTabs({ state, keepChatId });
    updated = { ...state, BROWSER_PRUNE_STATUS: result?.ok ? 'SENT' : 'FAILED',
      BROWSER_PRUNED_AT: result?.ok ? now.toISOString() : (state.BROWSER_PRUNED_AT || 'NONE') };
  } catch {
    updated = { ...state, BROWSER_PRUNE_STATUS: 'FAILED' };
  }
  writeControlAtomic(controlPath, updated);
  return updated;
}


function applyPreservationMode(state, now = new Date()) {
  const quotaLevel = String(state.QUOTA_GUARD_LEVEL || 'NORMAL');
  const status = String(state.STATUS || '');
  const statusPreservation = ['WAITING_TOOL', 'WAITING_BROWSER', 'AUTH_REQUIRED', 'CONTEXT_RISK', 'ROLLOVER_INCOMPLETE', 'RECOVERY_REQUIRED'].includes(status);
  const quotaPreservation = ['PRESSURE', 'ROLLOVER', 'EMERGENCY'].includes(quotaLevel);
  const active = statusPreservation || quotaPreservation;
  const mode = active ? 'ACTIVE' : 'NORMAL';
  const reason = statusPreservation ? `status:${status}` : (quotaPreservation ? `quota:${quotaLevel}` : 'NONE');
  if (state.PRESERVATION_MODE === mode && state.PRESERVATION_REASON === reason) return state;
  return {
    ...state,
    PRESERVATION_MODE: mode,
    PRESERVATION_REASON: reason,
    PRESERVATION_AT: active
      ? ((state.PRESERVATION_MODE === 'ACTIVE' && state.PRESERVATION_AT && state.PRESERVATION_AT !== 'NONE') ? state.PRESERVATION_AT : now.toISOString())
      : 'NONE',
  };
}

async function retryPreservationSweep({ controlPath, state, browser, now }) {
  if (!browser?.pruneManagedTargets) return state;
  const retryAt = Date.parse(state.PRESERVATION_SWEEP_NEXT_AT || '');
  if (Number.isFinite(retryAt) && retryAt > now.getTime()) return state;
  const staleChatIds = [...new Set([
    ...parseChatHistory(state).map((item) => item?.chatId),
    state.BROWSER_ARCHIVE_CHAT_ID,
  ].filter((chatId) => chatId && chatId !== 'NONE' && chatId !== state.CHAT_ID))];
  let result;
  try { result = await browser.pruneManagedTargets({ state, keepChatId: state.CHAT_ID, staleChatIds }); }
  catch (error) { result = { ok: false, closed: 0, considered: 0, error: error?.message || String(error) }; }
  const ok = result?.ok === true;
  const intervalMs = state.PRESERVATION_MODE === 'ACTIVE' ? 2 * 60_000 : 10 * 60_000;
  const updated = {
    ...state,
    PRESERVATION_SWEEP_STATUS: ok ? 'SENT' : 'RETRY_SCHEDULED',
    PRESERVATION_SWEEP_AT: now.toISOString(),
    PRESERVATION_SWEEP_CLOSED: String(Number(result?.closed || 0)),
    PRESERVATION_SWEEP_CONSIDERED: String(Number(result?.considered || 0)),
    PRESERVATION_SWEEP_LAST_ERROR: ok ? 'NONE' : String(result?.error || (result?.errors || []).join('|') || 'SWEEP_FAILED'),
    PRESERVATION_SWEEP_NEXT_AT: new Date(now.getTime() + (ok ? intervalMs : 2 * 60_000)).toISOString(),
  };
  writeControlAtomic(controlPath, updated);
  return updated;
}
async function retryPredecessorArchive({ controlPath, state, browser, now }) {
  const pending = ['PENDING', 'FAILED', 'RETRY_SCHEDULED'].includes(state.BROWSER_ARCHIVE_STATUS);
  const chatId = state.BROWSER_ARCHIVE_CHAT_ID;
  if (!pending || !chatId || chatId === 'NONE' || !browser?.archiveRunChat) return state;
  const retryAt = Date.parse(state.BROWSER_ARCHIVE_NEXT_AT || '');
  if (state.BROWSER_ARCHIVE_STATUS === 'RETRY_SCHEDULED' && Number.isFinite(retryAt) && now.getTime() < retryAt) return state;
  let updated;
  try {
    const result = await browser.archiveRunChat({ state, chatId });
    if (result?.ok) {
      updated = { ...state, BROWSER_ARCHIVE_STATUS: 'SENT', BROWSER_ARCHIVED_AT: now.toISOString(),
        BROWSER_ARCHIVE_DEBT_SINCE: 'NONE', BROWSER_ARCHIVE_ATTEMPTS: '0', BROWSER_ARCHIVE_NEXT_AT: 'NONE', BROWSER_ARCHIVE_LAST_ERROR: 'NONE' };
    } else {
      const attempts = Number.parseInt(state.BROWSER_ARCHIVE_ATTEMPTS || '0', 10) + 1;
      const reason = String(result?.status || result?.error || 'ARCHIVE_UNVERIFIED');
      const baseDelayMs = reason === 'AUTH_REQUIRED' ? 5 * 60_000 : 2 * 60_000;
      updated = { ...state, BROWSER_ARCHIVE_STATUS: 'RETRY_SCHEDULED', BROWSER_ARCHIVE_ATTEMPTS: String(attempts),
        BROWSER_ARCHIVE_NEXT_AT: new Date(now.getTime() + Math.min(30 * 60_000, baseDelayMs * (2 ** Math.min(attempts - 1, 3)))).toISOString(),
        BROWSER_ARCHIVE_LAST_ERROR: reason,
        BROWSER_ARCHIVE_DEBT_SINCE: (state.BROWSER_ARCHIVE_DEBT_SINCE && state.BROWSER_ARCHIVE_DEBT_SINCE !== 'NONE') ? state.BROWSER_ARCHIVE_DEBT_SINCE : now.toISOString() };
    }
  } catch (error) {
    const attempts = Number.parseInt(state.BROWSER_ARCHIVE_ATTEMPTS || '0', 10) + 1;
    const reason = error?.message ? String(error.message) : String(error);
    updated = { ...state, BROWSER_ARCHIVE_STATUS: 'RETRY_SCHEDULED', BROWSER_ARCHIVE_ATTEMPTS: String(attempts),
      BROWSER_ARCHIVE_NEXT_AT: new Date(now.getTime() + Math.min(30 * 60_000, 2 * 60_000 * (2 ** Math.min(attempts - 1, 3)))).toISOString(),
      BROWSER_ARCHIVE_LAST_ERROR: reason,
      BROWSER_ARCHIVE_DEBT_SINCE: (state.BROWSER_ARCHIVE_DEBT_SINCE && state.BROWSER_ARCHIVE_DEBT_SINCE !== 'NONE') ? state.BROWSER_ARCHIVE_DEBT_SINCE : now.toISOString() };
  }
  writeControlAtomic(controlPath, updated);
  return updated;
}

async function cleanupRunScratchQuietly({ browser, state }) {
  if (!browser?.cleanupRunScratchTabs) return;
  try { await browser.cleanupRunScratchTabs({ state }); } catch {}
}

async function closeFailedSuccessor({ browser, state, outcome }) {
  let closed = false;
  if (browser?.closeRunChat && outcome?.chatId) {
    try {
      const result = await browser.closeRunChat({ state, chatId: outcome.chatId });
      closed = Boolean(result?.ok === true && Number(result?.closed ?? 1) > 0);
    } catch {}
  }
  if (!closed && browser?.closeRunTarget && outcome?.targetId) {
    try {
      const result = await browser.closeRunTarget({ state, targetId: outcome.targetId });
      closed = result?.ok === true;
    } catch {}
  }
  await cleanupRunScratchQuietly({ browser, state });
  return { ok: closed, targetId: outcome?.targetId || null };
}

async function retryOrphanTargetCleanup({ controlPath, state, browser, now }) {
  const targetId = state.BROWSER_ORPHAN_TARGET_ID;
  if (state.BROWSER_ORPHAN_STATUS !== 'RETRY_SCHEDULED' || !targetId || targetId === 'NONE') return { state, blocked: false };
  const retryAt = Date.parse(state.BROWSER_ORPHAN_NEXT_AT || '');
  if (Number.isFinite(retryAt) && now.getTime() < retryAt) return { state, blocked: true, action: 'ORPHAN_CLEANUP_BACKOFF' };
  let result = null;
  if (browser?.closeRunTarget) { try { result = await browser.closeRunTarget({ state, targetId }); } catch {} }
  if (result?.ok === true) {
    const updated = { ...state, BROWSER_ORPHAN_TARGET_ID: 'NONE', BROWSER_ORPHAN_STATUS: 'SENT', BROWSER_ORPHAN_ATTEMPTS: '0', BROWSER_ORPHAN_NEXT_AT: 'NONE', BROWSER_ORPHAN_DEBT_SINCE: 'NONE' };
    writeControlAtomic(controlPath, updated);
    return { state: updated, blocked: false };
  }
  const attempts = Number.parseInt(state.BROWSER_ORPHAN_ATTEMPTS || '0', 10) + 1;
  const delayMs = Math.min(30 * 60_000, 60_000 * (2 ** Math.min(attempts - 1, 5)));
  const updated = { ...state, BROWSER_ORPHAN_STATUS: 'RETRY_SCHEDULED', BROWSER_ORPHAN_ATTEMPTS: String(attempts), BROWSER_ORPHAN_NEXT_AT: new Date(now.getTime() + delayMs).toISOString(), BROWSER_ORPHAN_DEBT_SINCE: (state.BROWSER_ORPHAN_DEBT_SINCE && state.BROWSER_ORPHAN_DEBT_SINCE !== 'NONE') ? state.BROWSER_ORPHAN_DEBT_SINCE : now.toISOString() };
  writeControlAtomic(controlPath, updated);
  return { state: updated, blocked: true, action: 'ORPHAN_CLEANUP_RETRY' };
}

async function retryClaimConfirmation({ controlPath, state, browser, now }) {
  if (!['PENDING', 'FAILED'].includes(state.CLAIM_CONFIRM_STATUS)) return state;
  if (state.CLAIM_RESUMED_AT && state.CLAIM_RESUMED_AT !== 'NONE') {
    if (state.CLAIM_CONFIRM_STATUS === 'SENT') return state;
    const resumed = { ...state, CLAIM_CONFIRM_STATUS: 'SENT' };
    writeControlAtomic(controlPath, resumed);
    return resumed;
  }
  const chatId = state.CLAIM_CONFIRM_CHAT_ID;
  if (!chatId || chatId === 'NONE' || !browser?.sendClaimConfirmation) return state;
  let updated;
  try {
    const result = await browser.sendClaimConfirmation({
      state, chatId, generation: Number.parseInt(state.GENERATION || '0', 10), nonce: state.CLAIM_NONCE,
    });
    const rateLimited = Boolean(result?.rateLimited || result?.status === 'RATE_LIMITED');
    if (rateLimited) {
      const count = Number.parseInt(state.RATE_LIMIT_COUNT || '0', 10) + 1;
      const delayMs = Math.min(30 * 60_000, 2 * 60_000 * (2 ** Math.min(count - 1, 4)));
      updated = { ...state, CLAIM_CONFIRM_STATUS: 'RATE_LIMITED', RATE_LIMIT_COUNT: String(count),
        RATE_LIMIT_UNTIL: new Date(now.getTime() + delayMs).toISOString(), RATE_LIMIT_REASON: 'TOO_MANY_REQUESTS' };
    } else {
      const ok = Boolean(result?.ok);
      updated = { ...state, CLAIM_CONFIRM_STATUS: ok ? 'SENT' : 'FAILED',
        CLAIM_CONFIRMED_AT: ok ? ((state.CLAIM_CONFIRMED_AT && state.CLAIM_CONFIRMED_AT !== 'NONE') ? state.CLAIM_CONFIRMED_AT : now.toISOString()) : (state.CLAIM_CONFIRMED_AT || 'NONE'),
        CLAIM_RESUMED_AT: ok ? now.toISOString() : (state.CLAIM_RESUMED_AT || 'NONE'),
        RATE_LIMIT_COUNT: ok ? '0' : (state.RATE_LIMIT_COUNT || '0'), RATE_LIMIT_UNTIL: ok ? 'NONE' : (state.RATE_LIMIT_UNTIL || 'NONE'),
        RATE_LIMIT_REASON: ok ? 'NONE' : (state.RATE_LIMIT_REASON || 'NONE') };
    }
  } catch {
    updated = { ...state, CLAIM_CONFIRM_STATUS: 'FAILED' };
  }
  writeControlAtomic(controlPath, updated);
  return updated;
}

async function finalizeDoneLifecycle({ controlPath, state, browser, now, generation }) {
  let current = state;
  if (['PENDING', 'FAILED'].includes(current.CHAT_TITLE_STATUS)) {
    current = { ...current, CHAT_TITLE_STATUS: 'SKIPPED_SAFE', CHAT_TITLE_ATTEMPTS: '0' };
    writeControlAtomic(controlPath, current);
  }

  if (['PENDING', 'FAILED', 'RETRY_SCHEDULED'].includes(current.BROWSER_CLEANUP_STATUS)) {
    const retryAt = Date.parse(current.BROWSER_CLEANUP_NEXT_AT || '');
    if (current.BROWSER_CLEANUP_STATUS === 'RETRY_SCHEDULED' && Number.isFinite(retryAt) && now.getTime() < retryAt) {
      return { action: 'BROWSER_CLEANUP_BACKOFF', generation, retryAt: current.BROWSER_CLEANUP_NEXT_AT };
    }
    if (!browser?.cleanupRun) return { action: 'BROWSER_CLEANUP_PENDING', generation };
    try {
      const result = await browser.cleanupRun({ state: current });
      if (!(result?.closed || result?.done)) throw new Error('BROWSER_CLEANUP_INCOMPLETE');
      current = { ...current, BROWSER_CLEANUP_STATUS: 'SENT', BROWSER_CLEANED_AT: now.toISOString(), BROWSER_CLEANUP_ATTEMPTS: '0', BROWSER_CLEANUP_NEXT_AT: 'NONE', CLEANUP_DEBT_SINCE: 'NONE' };
    } catch {
      const attempts = Number.parseInt(current.BROWSER_CLEANUP_ATTEMPTS || '0', 10) + 1;
      const delayMs = Math.min(30 * 60_000, 2 * 60_000 * (2 ** Math.min(attempts - 1, 4)));
      current = { ...current, BROWSER_CLEANUP_STATUS: 'RETRY_SCHEDULED', BROWSER_CLEANUP_ATTEMPTS: String(attempts), BROWSER_CLEANUP_NEXT_AT: new Date(now.getTime() + delayMs).toISOString(), CLEANUP_DEBT_SINCE: (current.CLEANUP_DEBT_SINCE && current.CLEANUP_DEBT_SINCE !== 'NONE') ? current.CLEANUP_DEBT_SINCE : now.toISOString() };
    }
    writeControlAtomic(controlPath, current);
    if (current.BROWSER_CLEANUP_STATUS === 'RETRY_SCHEDULED') return { action: 'BROWSER_CLEANUP_RETRY', generation, retryAt: current.BROWSER_CLEANUP_NEXT_AT };
  }
  return { action: 'FINALIZED', generation };
}

async function tick({ root, browser, notifier, remoteHealth = null, remoteAuthority = null, clock = () => new Date(), rolloverMinutes = 20, watchdogStallMs = 2 * 60_000, watchdogRecoveryMs = 4 * 60_000, includeSynthetic = false, runId = null }) {
  const resolved = resolveRun(root, { includeSynthetic, includePendingDone: true, runId });
  if (!resolved) return { action: 'NO_INCOMPLETE_RUN' };
  const controlPath = resolved.CONTROL_PATH;
  const release = acquireLock(path.join(path.dirname(controlPath), '.persistd.lock'));
  try {
    const now = clock();
    let state = readControl(controlPath);
    const guarded = applyQuotaGuardToState(state, now);
    if (guarded.changed) {
      state = guarded.state;
      writeControlAtomic(controlPath, state);
    }
    const preservationState = applyPreservationMode(state, now);
    if (preservationState !== state) {
      state = preservationState;
      writeControlAtomic(controlPath, state);
    }
    let generation = Number.parseInt(state.GENERATION || '1', 10);
    const remoteRunId = state.REMOTE_RUN_ID && state.REMOTE_RUN_ID !== 'NONE' ? state.REMOTE_RUN_ID : null;
    if (remoteAuthority && remoteRunId) {
      let remoteRun;
      try { remoteRun = await remoteAuthority.inspectRun(remoteRunId); }
      catch { return { action: 'REMOTE_AUTHORITY_RETRY', generation }; }
      const reconciled = reconcileRemoteRun(state, remoteRun);
      state = reconciled.state;
      writeControlAtomic(controlPath, state);
      if (reconciled.relation === 'AHEAD') return { action: 'REMOTE_GENERATION_AHEAD', generation, remoteGeneration: remoteRun.generation };
      if (reconciled.relation === 'BEHIND') {
        const remoteGeneration = Number(remoteRun.generation);
        const retryable = ['PENDING', 'FAILED'].includes(state.REMOTE_SYNC_STATUS) && remoteGeneration === generation - 1;
        if (!retryable) return { action: 'REMOTE_GENERATION_BEHIND', generation, remoteGeneration };
        try {
          remoteRun = await remoteAuthority.syncGeneration(remoteRunId, {
            expectedGeneration: remoteGeneration, generation,
            controllerHeartbeatAt: state.CLAIM_RESUMED_AT && state.CLAIM_RESUMED_AT !== 'NONE' ? state.CLAIM_RESUMED_AT : now.toISOString(),
            progress: state.CURRENT_STATE, nextSafeAction: state.NEXT_SAFE_ACTION,
          });
          state = { ...state, REMOTE_SYNC_STATUS: 'SENT', REMOTE_GENERATION: String(remoteRun.generation), REMOTE_UPDATED_AT: remoteRun.updatedAt || state.REMOTE_UPDATED_AT || 'NONE' };
          writeControlAtomic(controlPath, state);
        } catch {
          state = { ...state, REMOTE_SYNC_STATUS: 'FAILED' };
          writeControlAtomic(controlPath, state);
          return { action: 'REMOTE_SYNC_RETRY', generation, remoteGeneration };
        }
      }
    }
    const orphanCleanup = await retryOrphanTargetCleanup({ controlPath, state, browser, now });
    state = orphanCleanup.state;
    if (orphanCleanup.blocked) return { action: orphanCleanup.action, generation, retryAt: state.BROWSER_ORPHAN_NEXT_AT };
    generation = Number.parseInt(state.GENERATION || '1', 10);
    if (state.STATUS === 'BLOCKED') {
      await notifyBlockedOnce({ controlPath, state, notifier, now });
      return { action: 'BLOCKED', generation };
    }
    if (state.STATUS !== 'DONE') await cleanupRunScratchQuietly({ browser, state });
    if (state.STATUS !== 'DONE') state = await retryPreservationSweep({ controlPath, state, browser, now });
    if (state.CLAIM_CONFIRM_STATUS === 'RATE_LIMITED') {
      const until = Date.parse(state.RATE_LIMIT_UNTIL || '');
      if (Number.isFinite(until) && now.getTime() < until) {
        return { action: 'RATE_LIMIT_BACKOFF', generation, retryAt: state.RATE_LIMIT_UNTIL };
      }
      state = { ...state, CLAIM_CONFIRM_STATUS: 'FAILED', RATE_LIMIT_UNTIL: 'NONE' };
      writeControlAtomic(controlPath, state);
    }
    if (state.STATUS !== 'DONE' && ['PENDING', 'FAILED'].includes(state.CLAIM_CONFIRM_STATUS)) {
      state = await retryClaimConfirmation({ controlPath, state, browser, now });
      generation = Number.parseInt(state.GENERATION || '1', 10);
      if (state.CLAIM_CONFIRM_STATUS === 'RATE_LIMITED') return { action: 'RATE_LIMIT_BACKOFF', generation, retryAt: state.RATE_LIMIT_UNTIL };
      if (state.CLAIM_CONFIRM_STATUS !== 'SENT') return { action: 'CLAIM_CONFIRM_RETRY', generation };
    }
    if (state.STATUS !== 'DONE') state = await retryPredecessorArchive({ controlPath, state, browser, now });
    if (state.STATUS !== 'DONE') state = await retryActivePrune({ controlPath, state, browser, now });
    state = await reconcileChatPresentation({
      controlPath, state, browser, activeTitles: state.STATUS !== 'DONE',
    });
    generation = Number.parseInt(state.GENERATION || '1', 10);
    if (state.STATUS === 'DONE') {
      if (state.NOTIFICATION_STATUS !== 'SENT') {
        if (!notifier?.terminal) return { action: 'NOTIFICATION_PENDING', generation };
        const notice = await notifier.terminal({ state, message: buildTerminalMessage(state) });
        if (!notice?.sent) {
          writeControlAtomic(controlPath, { ...state, FINAL_GENERATION: String(generation), NOTIFICATION_STATUS: 'FAILED' });
          return { action: 'NOTIFICATION_FAILED', generation };
        }
        state = {
          ...state, FINAL_GENERATION: String(generation), DONE_AT: state.DONE_AT || now.toISOString(),
          NOTIFICATION_STATUS: 'SENT', NOTIFIED_AT: now.toISOString(), NOTIFICATION_CHANNEL: notice.channel || 'unknown',
        };
        writeControlAtomic(controlPath, state);
      }
      const pendingLifecycle = ['PENDING', 'FAILED'].includes(state.CHAT_TITLE_STATUS)
        || ['PENDING', 'FAILED', 'RETRY_SCHEDULED'].includes(state.BROWSER_CLEANUP_STATUS);
      if (!pendingLifecycle) return { action: 'DONE', generation };
      return finalizeDoneLifecycle({ controlPath, state, browser, now, generation });
    }

    state = claimLease(state, `G${generation}`, now, 90_000);
    writeControlAtomic(controlPath, state);

    let watchdogHealth = null;
    const initialWatchdog = evaluateWatchdog(state, { now, stallMs: watchdogStallMs, recoveryMs: watchdogRecoveryMs });
    if (initialWatchdog.status !== 'ACTIVE' && initialWatchdog.reason !== 'no_heartbeat') {
      if (browser?.isRunChatBusy && state.CHAT_ID && state.CHAT_ID !== 'NONE') {
        try {
          const activity = await browser.isRunChatBusy({ state, chatId: state.CHAT_ID });
          if (activity?.busy) {
            state = { ...state, STATUS: 'ACTIVE', CONTROLLER_HEARTBEAT_AT: now.toISOString(), BLOCKED_REASON: 'NONE' };
            writeControlAtomic(controlPath, state);
            return { action: 'WORKER_BUSY', generation };
          }
          if (activity?.ok === false) return { action: 'WORKER_ACTIVITY_RETRY', generation };
        } catch { return { action: 'WORKER_ACTIVITY_RETRY', generation }; }
      }

      if (remoteHealth?.preflight) {
        try { watchdogHealth = await remoteHealth.preflight(state); }
        catch { watchdogHealth = { ok: false, browser: 'UNHEALTHY', desktop: 'UNHEALTHY', repaired: false }; }
        if (watchdogHealth?.browser !== 'HEALTHY') {
          state = applyPreservationMode({ ...state, STATUS: 'WAITING_BROWSER', BLOCKED_REASON: 'BROWSER_UNHEALTHY' }, now);
          writeControlAtomic(controlPath, state);
          return { action: 'WAITING_BROWSER', generation };
        }
        if (!watchdogHealth?.ok) {
          state = applyPreservationMode({ ...state, STATUS: 'WAITING_TOOL', BLOCKED_REASON: 'REMOTE_CONTROL_UNHEALTHY' }, now);
          writeControlAtomic(controlPath, state);
          return { action: 'REMOTE_CONTROL_RETRY', generation };
        }
      }

      state = applyPreservationMode({ ...state, STATUS: initialWatchdog.status, BLOCKED_REASON: 'NONE' }, now);
      writeControlAtomic(controlPath, state);
      if (initialWatchdog.status === 'SUSPECTED_STALL') return { action: 'SUSPECTED_STALL', generation };
    }

    if (!isRolloverDue(state, now, rolloverMinutes)) return { action: 'WATCHING', generation };

    if (remoteHealth?.preflight) {
      let health = watchdogHealth;
      if (!health) {
        try { health = await remoteHealth.preflight(state); }
        catch { health = { ok: false, browser: 'UNHEALTHY', desktop: 'UNHEALTHY', repaired: false }; }
      }
      state = { ...state, REMOTE_HEALTH_AT: now.toISOString(), REMOTE_BROWSER_HEALTH: health?.browser || 'UNKNOWN',
        REMOTE_DESKTOP_HEALTH: health?.desktop || 'UNKNOWN', REMOTE_HEALTH_REPAIRED: String(Boolean(health?.repaired)) };
      if (!health?.ok) {
        state = applyPreservationMode({ ...state, STATUS: 'WAITING_TOOL', BLOCKED_REASON: 'REMOTE_CONTROL_UNHEALTHY' }, now);
        writeControlAtomic(controlPath, state);
        return { action: 'REMOTE_CONTROL_RETRY', generation };
      }
      if (state.BLOCKED_REASON === 'REMOTE_CONTROL_UNHEALTHY') state = { ...state, BLOCKED_REASON: 'NONE', STATUS: state.STATUS === 'WAITING_TOOL' ? 'ACTIVE' : state.STATUS };
      state = applyPreservationMode(state, now);
      writeControlAtomic(controlPath, state);
    }

    if (browser?.isRunChatBusy && state.CHAT_ID && state.CHAT_ID !== 'NONE') {
      try {
        const activity = await browser.isRunChatBusy({ state, chatId: state.CHAT_ID });
        if (activity?.busy) return { action: 'WORKER_BUSY', generation };
        if (activity?.ok === false) return { action: 'WORKER_ACTIVITY_RETRY', generation };
      } catch {
        return { action: 'WORKER_ACTIVITY_RETRY', generation };
      }
    }

    const nonce = crypto.randomUUID();
    const nextGeneration = generation + 1;
    state = {
      ...state,
      STATUS: 'PREPARING_TAKEOVER',
      CLAIM_NONCE: nonce,
      NEXT_GENERATION: String(nextGeneration),
      LAST_HEARTBEAT: now.toISOString(),
    };
    writeControlAtomic(controlPath, state);
    const message = buildSuccessorMessage({ ...state, CONTROL_PATH: controlPath }, nextGeneration);
    let outcome;
    try {
      outcome = await browser.createSuccessor({ state, message, nextGeneration, controlPath });
    } catch (error) {
      await cleanupRunScratchQuietly({ browser, state });
      return recordRolloverFailure({
        controlPath, generation, now, notifier, reason: 'BROWSER_ERROR',
      });
    }

    if (outcome?.status === 'AUTH_REQUIRED') {
      const current = readControl(controlPath);
      if (Number.parseInt(current.GENERATION || '0', 10) === generation) {
        writeControlAtomic(controlPath, applyPreservationMode({ ...current, STATUS: 'AUTH_REQUIRED', LEASE_OWNER: `G${generation}` }, now));
      }
      if (notifier?.attention) {
        let authState = readControl(controlPath);
        if (authState.AUTH_NOTIFICATION_STATUS !== 'SENT') {
          const attention = await notifier.attention({ state: authState, kind: 'AUTH_REQUIRED', message: buildAttentionMessage(authState, 'AUTH_REQUIRED') });
          if (attention?.sent) {
            authState = {
              ...authState, AUTH_NOTIFICATION_STATUS: 'SENT', AUTH_NOTIFIED_AT: now.toISOString(),
              AUTH_NOTIFICATION_CHANNEL: attention.channel || 'unknown',
            };
            writeControlAtomic(controlPath, authState);
          }
        }
      }
      return { action: 'AUTH_REQUIRED', generation };
    }

    let claimed = readControl(controlPath);
    let twoPhaseClaim = false;
    const legacyValidClaim = Number.parseInt(claimed.GENERATION || '0', 10) === nextGeneration
      && claimed.STATUS === 'ACTIVE'
      && claimed.CLAIM_NONCE === nonce
      && Boolean(claimed.CLAIMED_AT);

    if (!legacyValidClaim) {
      if (outcome?.status === 'BROWSER_ERROR' || !outcome?.chatId) {
        const cleanup = await closeFailedSuccessor({ browser, state, outcome });
        return recordRolloverFailure({ controlPath, generation, now, notifier, reason: 'BROWSER_ERROR', orphanTargetId: cleanup.ok ? null : cleanup.targetId });
      }
      const expectedRequest = buildClaimRequestLine(state.RUN_ID, nextGeneration, nonce);
      let requestVerified = outcome?.requestLine === expectedRequest;
      if (!requestVerified && browser?.verifyAssistantLine) {
        try {
          const verification = await browser.verifyAssistantLine({ state, chatId: outcome.chatId, line: expectedRequest });
          requestVerified = Boolean(verification?.ok);
        } catch { requestVerified = false; }
      }
      if (!requestVerified) {
        const cleanup = await closeFailedSuccessor({ browser, state, outcome });
        return recordRolloverFailure({ controlPath, generation, now, notifier, reason: 'CLAIM_REQUEST_NOT_VERIFIED', orphanTargetId: cleanup.ok ? null : cleanup.targetId });
      }
      try {
        claimed = claimGeneration({ controlPath, generation: nextGeneration, nonce, now });
        twoPhaseClaim = true;
      } catch {
        const cleanup = await closeFailedSuccessor({ browser, state, outcome });
        return recordRolloverFailure({ controlPath, generation, now, notifier, reason: 'CLAIM_REQUEST_REJECTED', orphanTargetId: cleanup.ok ? null : cleanup.targetId });
      }
    }

    const predecessorChatId = claimed.CHAT_ID && claimed.CHAT_ID !== 'NONE' && claimed.CHAT_ID !== outcome?.chatId ? claimed.CHAT_ID : null;
    let finalState = claimLease({
      ...claimed,
      CHAT_ID: outcome?.chatId || claimed.CHAT_ID || 'NONE',
      BROWSER_TASKSPACE_ID: outcome?.taskSpaceId || claimed.BROWSER_TASKSPACE_ID || 'NONE',
      TAKEOVER_EVIDENCE: outcome?.evidence || 'durable-claim-observed',
      ROLLOVER_ATTEMPTS: '0', BLOCKED_REASON: 'NONE', BLOCKED_AT: 'NONE',
      BLOCKED_NOTIFICATION_STATUS: 'NONE',
      DISPLAY_NAME: resolveDisplayName(claimed),
      CHAT_TITLE_STATUS: 'PENDING', BROWSER_CLEANUP_STATUS: 'PENDING',
      BROWSER_ARCHIVE_STATUS: predecessorChatId ? 'PENDING' : 'SKIPPED',
      BROWSER_ARCHIVE_CHAT_ID: predecessorChatId || 'NONE',
      BROWSER_ARCHIVE_DEBT_SINCE: 'NONE', BROWSER_ARCHIVE_ATTEMPTS: '0',
      BROWSER_ARCHIVE_NEXT_AT: 'NONE', BROWSER_ARCHIVE_LAST_ERROR: 'NONE',
      BROWSER_PRUNE_STATUS: outcome?.chatId ? 'PENDING' : 'SKIPPED',
      BROWSER_PRUNE_CHAT_ID: outcome?.chatId || 'NONE',
      CLAIM_CONFIRM_STATUS: twoPhaseClaim ? 'PENDING' : 'SKIPPED',
      CLAIM_CONFIRM_CHAT_ID: twoPhaseClaim ? (outcome?.chatId || 'NONE') : 'NONE',
      CLAIM_CONFIRMED_AT: 'NONE',
      CLAIM_RESUMED_AT: 'NONE',
    }, `G${nextGeneration}`, now, 90_000);
    finalState = appendChatHistory(finalState, outcome?.chatId);
    writeControlAtomic(controlPath, finalState);

    if (browser?.renameChat && outcome?.chatId) {
      const history = JSON.parse(finalState.CHAT_HISTORY_JSON || '[]');
      const title = buildChatTitle(finalState.DISPLAY_NAME, history.length);
      try { await browser.renameChat({ state: finalState, chatId: outcome.chatId, title }); } catch {}
    }
    if (predecessorChatId) finalState = await retryPredecessorArchive({ controlPath, state: finalState, browser, now });
    if (outcome?.chatId) finalState = await retryActivePrune({ controlPath, state: finalState, browser, now });

    if (twoPhaseClaim) {
      finalState = await retryClaimConfirmation({ controlPath, state: finalState, browser, now });
    }
    if (twoPhaseClaim && finalState.CLAIM_CONFIRM_STATUS !== 'SENT') {
      return { action: 'CLAIM_CONFIRM_RETRY', generation: nextGeneration };
    }
    if (remoteAuthority && remoteRunId) {
      finalState = { ...finalState, REMOTE_SYNC_STATUS: 'PENDING' };
      writeControlAtomic(controlPath, finalState);
      try {
        const remoteSynced = await remoteAuthority.syncGeneration(remoteRunId, {
          expectedGeneration: generation,
          generation: nextGeneration,
          controllerHeartbeatAt: finalState.CLAIM_RESUMED_AT && finalState.CLAIM_RESUMED_AT !== 'NONE' ? finalState.CLAIM_RESUMED_AT : now.toISOString(),
          progress: finalState.CURRENT_STATE,
          nextSafeAction: finalState.NEXT_SAFE_ACTION,
        });
        finalState = { ...finalState, REMOTE_SYNC_STATUS: 'SENT', REMOTE_GENERATION: String(remoteSynced.generation), REMOTE_UPDATED_AT: remoteSynced.updatedAt || 'NONE' };
        writeControlAtomic(controlPath, finalState);
      } catch {
        finalState = { ...finalState, REMOTE_SYNC_STATUS: 'FAILED' };
        writeControlAtomic(controlPath, finalState);
        return { action: 'ROLLED_OVER_REMOTE_SYNC_RETRY', generation: nextGeneration };
      }
    }
    return { action: 'ROLLED_OVER', generation: nextGeneration };
  } finally {
    release();
  }
}

module.exports = { tick, isRolloverDue, buildChatTitle, resolveDisplayName, appendChatHistory };
