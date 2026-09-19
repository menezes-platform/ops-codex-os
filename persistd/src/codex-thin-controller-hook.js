#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const {
  appendWorkerEvent,
  loadSessionState,
  markManaged,
  preToolDecision,
  queueParentWake,
  refreshSession,
  requestRollover,
  wakeMessage,
  writeJsonAtomic,
  statePathFor,
} = require('./codex-thin-controller');

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function emit(value) {
  if (value == null) return;
  process.stdout.write(JSON.stringify(value) + '\n');
}

function additionalContext(event, text) {
  return {
    continue: true,
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  };
}

function patchState(sessionId, patch, home = os.homedir()) {
  const current = loadSessionState(sessionId, home);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeJsonAtomic(statePathFor(sessionId, home), next);
  return next;
}

function handleSessionStart(input) {
  refreshSession(input);
}

function handleUserPrompt(input) {
  const { state } = refreshSession(input);
  const prompt = String(input.prompt || input.user_prompt || input.message || '');
  if (!prompt.includes('THIN_CONTROLLER_WORKER_EVENT')) return;
  emit(additionalContext(
    'UserPromptSubmit',
    [
      'Thin-controller wake event detected.',
      state.persistflowRunId ? 'Persistflow run: ' + state.persistflowRunId + '.' : null,
      'Read only the referenced event file plus the latest durable checkpoint needed for the next decision.',
      'Do not poll with wait_agent. Dispatch bounded work, then end the turn; completion events will wake you.',
    ].filter(Boolean).join(' '),
  ));
}

function handleSubagentStart(input) {
  const sessionId = input.session_id || 'unknown';
  refreshSession(input);
  markManaged(sessionId, {
    lastSubagentStartedAt: new Date().toISOString(),
    lastSubagentId: input.agent_id || null,
  });
  emit(additionalContext(
    'SubagentStart',
    'Return a concise result with evidence locators. The parent is event-driven; do not rely on parent polling.',
  ));
}

function handleSubagentStop(input) {
  const sessionId = input.session_id || 'unknown';
  refreshSession(input);
  const state = markManaged(sessionId, {
    lastSubagentStoppedAt: new Date().toISOString(),
    lastSubagentId: input.agent_id || null,
  });
  const { file } = appendWorkerEvent(input, state);
  patchState(sessionId, { lastWorkerEvent: file });
  queueParentWake(sessionId, wakeMessage(file, state));
}

function handlePreTool(input) {
  const { state } = refreshSession(input);
  const decision = preToolDecision(input, state);
  if (decision) emit(decision);
}

function handleStop(input) {
  const { state } = refreshSession(input);
  const next = requestRollover(state);
  if (next.rolloverRequestedAt && next.rolloverRequestedAt !== state.rolloverRequestedAt) {
    emit({
      continue: true,
      systemMessage:
        'Thin controller checkpointed a preventive rollover request (' + next.rolloverReason + '). ' +
        'The external supervisor owns successor launch; do not poll or keep this turn alive.',
    });
  }
}

function main(argv = process.argv.slice(2)) {
  const mode = String(argv[0] || '').toLowerCase();
  const input = readHookInput();
  if (!input.session_id) return;
  if (mode === 'session-start') return handleSessionStart(input);
  if (mode === 'user-prompt') return handleUserPrompt(input);
  if (mode === 'subagent-start') return handleSubagentStart(input);
  if (mode === 'subagent-stop') return handleSubagentStop(input);
  if (mode === 'pre-tool') return handlePreTool(input);
  if (mode === 'stop') return handleStop(input);
  throw new Error('UNKNOWN_THIN_CONTROLLER_HOOK:' + mode);
}

try {
  main();
} catch (error) {
  process.stderr.write('[thin-controller] ' + (error.stack || error.message) + '\n');
  process.exitCode = 0;
}
