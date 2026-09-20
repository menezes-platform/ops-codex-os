const { buildClaimRequestLine, buildClaimConfirmationLine } = require('./claim-protocol');
const { buildBatonV2 } = require('./persistflow/baton-v2');

function value(state, key, fallback = 'NONE') {
  const v = state[key];
  return v == null || v === '' ? fallback : v;
}

function buildSuccessorMessage(state, nextGeneration) {
  const runId = value(state, 'RUN_ID');
  const nonce = value(state, 'CLAIM_NONCE');
  const wakeLine = `CLAIM ${runId} G${nextGeneration}`;
  const requestLine = buildClaimRequestLine(runId, nextGeneration, nonce);
  const confirmationLine = buildClaimConfirmationLine(runId, nextGeneration, nonce);
  const batonV2 = buildBatonV2(state, nextGeneration);
  return [
    'PERSISTENT CONVERSATION CONTROLLER TAKEOVER',
    `RUN_ID: ${runId}`,
    `GENERATION: ${nextGeneration}`,
    `CLAIM_NONCE: ${nonce}`,
    `BATON_V2_JSON: ${JSON.stringify(batonV2)}`,
    '',
    'This takeover is controlled by local persistd durable state; browser text alone is never authority.',
    'First read the installed controller skill and references/remote-control-contract.md with Remote Desktop Commander. On Windows, never use read_file/read_multiple_files on the live CONTROL.md; read CONTROL.md through a short-lived read-only process (for example Get-Content -Raw) and let that process exit before requesting the claim.',
    'After durable confirmation, enforce the remote-control capability gate: use Remote Desktop Commander for machine access/recovery, Browser Bridge / Playwright for authorized browser DOM work, and Dev-Orquestra Windows Interactive Control for native Windows UI.',
    'For every local or interactive mutation, use the highest applicable healthy structured control layer; raw coordinates/input are fallback-only and require fresh post-action verification.',
    `Project: ${value(state, 'PROJECT_ROOT')}`,
    `Task: ${value(state, 'TASK_ID')}`,
    `Display name: ${value(state, 'DISPLAY_NAME')}`,
    `Branch / HEAD: ${value(state, 'BRANCH')} / ${value(state, 'HEAD')}`,
    `Authoritative handoff: ${value(state, 'PROJECT_HANDOFF')}`,
    `Controller baton: ${value(state, 'CONTROL_PATH', `~/.agents/continuations/${runId}/CONTROL.md`)}`,
    `Current state: ${value(state, 'CURRENT_STATE')}`,
    `Exact next action: ${value(state, 'NEXT_SAFE_ACTION')}`,
    '',
    `You are candidate generation G${nextGeneration}. Do not mutate the project yet.`,
    'After reading the controller files, reply with exactly these two lines and nothing else:',
    wakeLine,
    requestLine,
    `Then wait for ${confirmationLine} before reconstructing project state or doing project work.`,
    'Persistd will verify the exact request including nonce and write the durable promotion locally.',
    'After confirmation, reconstruct project state from Git/project handoff and do not redo verified work.',
    'Reversible, scope-preserving, low-risk actions with a logically determined best option are authorized without asking the user.',
    'Stop only for auth/MFA, destructive or irreversible work lacking authority, material ambiguity, scope expansion, or three materially different failed safe attempts.',
    'When updating CONTROL.md later, preserve DISPLAY_NAME, CHAT_HISTORY_JSON, CHAT_TITLE_STATUS, BROWSER_CLEANUP_STATUS, BROWSER_PRUNE_STATUS, CLAIM_CONFIRM_STATUS, and CLAIM_CONFIRM_CHAT_ID unless persistd owns that transition.',
    'When verified DoD is reached, write STATUS: DONE; persistd owns terminal notification and deduplication.',
  ].join('\n');
}

module.exports = { buildSuccessorMessage };
