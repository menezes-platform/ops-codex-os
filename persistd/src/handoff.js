const { buildClaimRequestLine, buildClaimConfirmationLine } = require('./claim-protocol');
const { buildBatonV2 } = require('./persistflow/baton-v2');

function value(state, key, fallback = 'NONE') {
  const v = state[key];
  return v == null || v === '' ? fallback : v;
}

function clip(valueToClip, max = 700) {
  const text = String(valueToClip == null ? '' : valueToClip).trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function buildSuccessorMessage(state, nextGeneration) {
  const runId = value(state, 'RUN_ID');
  const nonce = value(state, 'CLAIM_NONCE');
  const wakeLine = `CLAIM ${runId} G${nextGeneration}`;
  const requestLine = buildClaimRequestLine(runId, nextGeneration, nonce);
  const confirmationLine = buildClaimConfirmationLine(runId, nextGeneration, nonce);
  const batonV2 = buildBatonV2(state, nextGeneration);
  const compactBaton = {
    ...batonV2,
    objective: clip(batonV2.objective, 320) || null,
    state: {
      current: null,
      nextSafeAction: clip(batonV2.state?.nextSafeAction, 700) || null,
      ambiguousOperations: [],
      cleanupDebt: [],
    },
  };
  const controlPath = value(state, 'CONTROL_PATH', `~/.agents/continuations/${runId}/CONTROL.md`);
  return [
    'PERSISTENT CONVERSATION CONTROLLER TAKEOVER',
    `RUN_ID: ${runId}`,
    `GENERATION: ${nextGeneration}`,
    `CLAIM_NONCE: ${nonce}`,
    `BATON_V2_JSON: ${JSON.stringify(compactBaton)}`,
    `CONTROL_PATH: ${controlPath}`,
    `PROJECT_HANDOFF: ${value(state, 'PROJECT_HANDOFF')}`,
    `Display name: ${value(state, 'DISPLAY_NAME')}`,
    '',
    'Durable state is authoritative. Do not read or reconstruct from the predecessor transcript.',
    'Read the installed controller skill, references/remote-control-contract.md, CONTROL.md, Git state, and only the handoff sections needed for the next action.',
    'After claim confirmation enforce the capability gate: Remote Desktop Commander for machine state, Browser Bridge / Playwright for authorized browser DOM work, and Windows Interactive Control for native UI. Always use the highest applicable healthy structured control layer.',
    `You are candidate G${nextGeneration}; do not mutate before durable confirmation.`,
    'Reply with exactly:',
    wakeLine,
    requestLine,
    `Wait for ${confirmationLine}.`,
    'After confirmation, reconstruct project state from Git plus durable controller/project evidence; never replay the predecessor transcript or redo verified work. Never use model polling for worker completion; rely on durable events/checkpoints.',
    'When updating CONTROL.md, preserve DISPLAY_NAME, CHAT_HISTORY_JSON, CHAT_TITLE_STATUS, BROWSER_CLEANUP_STATUS, BROWSER_PRUNE_STATUS, CLAIM_CONFIRM_STATUS, and CLAIM_CONFIRM_CHAT_ID unless persistd owns the transition.',
    'Preserve required review, security, release, and irreversible-action gates. STATUS: DONE only after verified DoD.',
  ].join('\n');
}

module.exports = { buildSuccessorMessage };
