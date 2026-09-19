const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { evaluateQuotaPressure, LEVELS } = require('./quota-guard');

const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;
const STATE_VERSION = 1;
const POLL_TOOLS = new Set(['wait_agent']);

function safeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
}

function stateRoot(home = os.homedir()) {
  return path.join(home, '.codex', 'thin-controller');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function readTail(file, maxBytes = DEFAULT_TAIL_BYTES) {
  if (!file || !fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, maxBytes);
  if (size <= 0) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    let text = buffer.toString('utf8');
    if (stat.size > size) {
      const newline = text.indexOf('\n');
      if (newline >= 0) text = text.slice(newline + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function parseRecords(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object') records.push(record);
    } catch {}
  }
  return records;
}

function recentRecords(file, initialBytes = DEFAULT_TAIL_BYTES, maxBytes = 32 * 1024 * 1024) {
  if (!file || !fs.existsSync(file)) return [];
  const fileSize = fs.statSync(file).size;
  let bytes = Math.min(initialBytes, fileSize);
  for (;;) {
    const records = parseRecords(readTail(file, bytes));
    const hasUsage = Boolean(latestTokenCount(records));
    const hasRateLimit = Boolean(latestRateLimitCount(records));
    if ((hasUsage && hasRateLimit) || bytes >= fileSize || bytes >= maxBytes) return records;
    bytes = Math.min(fileSize, maxBytes, Math.max(bytes * 2, initialBytes));
  }
}

function latestTokenCount(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (record?.type === 'event_msg' && record?.payload?.type === 'token_count') return record;
  }
  return null;
}

function latestRateLimitCount(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (record?.type !== 'event_msg' || record?.payload?.type !== 'token_count') continue;
    const used = Number(record?.payload?.rate_limits?.primary?.used_percent);
    if (Number.isFinite(used)) return record;
  }
  return null;
}

function extractPersistflowRunId(records) {
  const patterns = [
    /["']runId["']\s*:\s*["']([^"']+)["']/,
    /RUN_ID[:=]\s*([a-zA-Z0-9._-]+)/,
  ];
  const seen = new Set();
  const scan = (value) => {
    if (value == null) return null;
    if (typeof value === 'string') {
      const normalized = value.replace(/\\\"/g, '"');
      for (const pattern of patterns) {
        const match = pattern.exec(normalized);
        if (match) return match[1];
      }
      return null;
    }
    if (typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    const values = Array.isArray(value) ? value : Object.values(value);
    for (const child of values) {
      const match = scan(child);
      if (match) return match;
    }
    return null;
  };
  for (let index = records.length - 1; index >= 0; index--) {
    const match = scan(records[index]?.payload || {});
    if (match) return match;
  }
  return null;
}

function isoFromEpoch(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

function telemetryFromRecords(records, previous = {}) {
  const token = latestTokenCount(records);
  if (!token) return null;
  const rateToken = latestRateLimitCount(records) || token;
  const payload = token.payload || {};
  const ratePayload = rateToken.payload || {};
  const info = payload.info || {};
  const usage = info.last_token_usage || {};
  const primary = ratePayload.rate_limits?.primary || {};
  const secondary = ratePayload.rate_limits?.secondary || {};
  const sampledAt = rateToken.timestamp || token.timestamp || new Date().toISOString();
  const previousAt = Date.parse(previous.telemetry?.sampledAt || '');
  const currentAt = Date.parse(sampledAt);
  const sampleMinutes = Number.isFinite(previousAt) && Number.isFinite(currentAt) && currentAt > previousAt
    ? (currentAt - previousAt) / 60000
    : null;
  const quotaUsedPercent = Number(primary.used_percent);
  const contextTokens = Number(usage.input_tokens);
  const contextWindow = Number(info.model_context_window);
  const evaluation = evaluateQuotaPressure({
    quotaUsedPercent,
    previousQuotaUsedPercent: previous.telemetry?.quotaUsedPercent,
    sampleMinutes,
    contextTokens,
    contextWindow,
  });

  return {
    sampledAt,
    quotaUsedPercent: Number.isFinite(quotaUsedPercent) ? quotaUsedPercent : null,
    weeklyUsedPercent: Number.isFinite(Number(secondary.used_percent)) ? Number(secondary.used_percent) : null,
    contextTokens: Number.isFinite(contextTokens) ? contextTokens : null,
    contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
    cachedInputTokens: Number(usage.cached_input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    primaryResetAt: isoFromEpoch(primary.resets_at),
    secondaryResetAt: isoFromEpoch(secondary.resets_at),
    level: evaluation.level,
    reasons: evaluation.reasons,
    burnRatePpPerMinute: evaluation.burnRatePpPerMinute,
  };
}

function statePathFor(sessionId, home) {
  return path.join(stateRoot(home), 'sessions', `${safeId(sessionId)}.json`);
}
function eventDirFor(sessionId, home) {
  return ensureDir(path.join(stateRoot(home), 'events', safeId(sessionId)));
}

function loadSessionState(sessionId, home) {
  return readJson(statePathFor(sessionId, home), {
    version: STATE_VERSION,
    sessionId,
    managed: false,
    autoRollover: false,
    thinGeneration: 1,
    createdAt: new Date().toISOString(),
  });
}

function refreshSession(input, options = {}) {
  const home = options.home || os.homedir();
  const sessionId = input.session_id || input.sessionId || 'unknown';
  const state = loadSessionState(sessionId, home);
  const transcriptPath = input.transcript_path || state.transcriptPath || null;
  const records = recentRecords(
    transcriptPath,
    options.tailBytes || DEFAULT_TAIL_BYTES,
    options.maxTailBytes || 32 * 1024 * 1024,
  );
  const telemetry = telemetryFromRecords(records, state);
  const runId = extractPersistflowRunId(records) || state.persistflowRunId || null;
  const next = {
    ...state,
    version: STATE_VERSION,
    sessionId,
    cwd: input.cwd || state.cwd || null,
    transcriptPath,
    persistflowRunId: runId,
    autoRollover: Boolean(runId || state.autoRollover),
    telemetry: telemetry || state.telemetry || null,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(statePathFor(sessionId, home), next);
  return { state: next, records, path: statePathFor(sessionId, home) };
}

function markManaged(sessionId, patch = {}, home = os.homedir()) {
  const current = loadSessionState(sessionId, home);
  const next = { ...current, managed: true, ...patch, updatedAt: new Date().toISOString() };
  writeJsonAtomic(statePathFor(sessionId, home), next);
  return next;
}
function isAtLeast(level, threshold) {
  return LEVELS.indexOf(level || 'NORMAL') >= LEVELS.indexOf(threshold);
}

function shouldBlockPolling(input, state) {
  const toolName = String(input.tool_name || input.toolName || '');
  if (!state.managed || !POLL_TOOLS.has(toolName)) return false;
  return true;
}

function preToolDecision(input, state) {
  if (!shouldBlockPolling(input, state)) return null;
  const eventDir = eventDirFor(state.sessionId);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Thin controller: model polling is disabled. End this turn; worker completion will wake the parent. Events: ${eventDir}`,
    },
  };
}

function appendWorkerEvent(input, state, home = os.homedir()) {
  const dir = eventDirFor(state.sessionId, home);
  const now = new Date().toISOString();
  const agentId = safeId(input.agent_id || 'agent');
  const eventId = `${Date.now()}-${agentId}-${crypto.randomBytes(3).toString('hex')}`;
  const file = path.join(dir, `${eventId}.json`);
  const event = {
    version: 1,
    eventId,
    type: 'SUBAGENT_STOP',
    at: now,
    parentSessionId: state.sessionId,
    agentId: input.agent_id || null,
    agentType: input.agent_type || null,
    agentTranscriptPath: input.agent_transcript_path || null,
    lastAssistantMessage: input.last_assistant_message || null,
  };
  writeJsonAtomic(file, event);
  return { file, event };
}
function wakeMessage(eventFile, state) {
  return [
    'THIN_CONTROLLER_WORKER_EVENT',
    `event=${eventFile}`,
    state.persistflowRunId ? `persistflow_run=${state.persistflowRunId}` : null,
    'Read only this event and the latest durable checkpoint needed for the next decision.',
    'Do not call wait_agent; further completions will arrive as events.',
  ].filter(Boolean).join(' ');
}

function queueParentWake(sessionId, message, options = {}) {
  const command = options.codexCommand || 'codex';
  const child = spawn(command, ['queue', '--thread', sessionId, '--message', message], {
    detached: false,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  return child.pid || null;
}

function requestRollover(state, home = os.homedir(), now = new Date()) {
  const telemetry = state.telemetry || {};
  if (!state.managed || !state.autoRollover || !isAtLeast(telemetry.level, 'ROLLOVER')) return state;
  if (state.retiredAt || state.rolloverRequestedAt) return state;
  const next = {
    ...state,
    rolloverRequestedAt: now.toISOString(),
    rolloverReason: `quota_guard:${String(telemetry.level || 'ROLLOVER').toLowerCase()}`,
    updatedAt: now.toISOString(),
  };
  writeJsonAtomic(statePathFor(state.sessionId, home), next);
  return next;
}

function compactSuccessorPrompt(state, eventRoot) {
  const lines = [
    'THIN CONTROLLER SUCCESSOR',
    state.persistflowRunId ? `Persistflow run: ${state.persistflowRunId}` : null,
    state.cwd ? `Project: ${state.cwd}` : null,
    `Thin generation: ${Number(state.thinGeneration || 1) + 1}`,
    `Worker events: ${eventRoot}`,
    'Reconstruct from Git plus the latest durable Persistflow checkpoint; do not read the predecessor transcript.',
    'Continue only from verified state and the latest next-safe-action. Do not redo completed work.',
    'Never poll workers with wait_agent. Dispatch bounded workers, end the turn, and let SubagentStop hooks wake you on real completion.',
    'Keep worker briefs and returned context narrow. Preserve all quality, security, review, and release gates.',
    'Before heavy fan-out, honor the quota/context circuit breaker. If rollover is requested again, checkpoint durable state and end cleanly.',
  ].filter(Boolean);
  return lines.join('\n');
}

function effectiveQuotaAfterReset(state, now = new Date()) {
  const telemetry = state.telemetry || {};
  const reset = Date.parse(telemetry.primaryResetAt || '');
  if (Number.isFinite(reset) && now.getTime() >= reset + 30_000) return 0;
  return Number(telemetry.quotaUsedPercent) || 0;
}

function eligibleForSuccessor(state, now = new Date()) {
  if (!state.rolloverRequestedAt || state.retiredAt || state.successorLaunchedAt) return false;
  if (!state.autoRollover || !state.cwd) return false;
  const quota = effectiveQuotaAfterReset(state, now);
  if (quota >= 85) return false;
  return true;
}

function markSuccessorLaunched(state, pid, home = os.homedir(), now = new Date()) {
  const next = {
    ...state,
    successorLaunchedAt: now.toISOString(),
    successorPid: pid || null,
    retiredAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  writeJsonAtomic(statePathFor(state.sessionId, home), next);
  return next;
}

module.exports = {
  STATE_VERSION,
  appendWorkerEvent,
  compactSuccessorPrompt,
  effectiveQuotaAfterReset,
  eligibleForSuccessor,
  eventDirFor,
  extractPersistflowRunId,
  isAtLeast,
  latestTokenCount,
  loadSessionState,
  markManaged,
  markSuccessorLaunched,
  parseRecords,
  preToolDecision,
  queueParentWake,
  readTail,
  recentRecords,
  refreshSession,
  requestRollover,
  safeId,
  shouldBlockPolling,
  statePathFor,
  stateRoot,
  telemetryFromRecords,
  wakeMessage,
  writeJsonAtomic,
};
