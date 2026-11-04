'use strict';
const CODESPACE = 'ideal-guacamole-p77r9rqq4r7xh7xrr';
const REPOSITORY = 'menezesx2k26-byte/ops-infra-workbench';
const OWNER = 'menezesx2k26-byte';
const API = 'https://api.github.com';
const MAX_BUDGET_PROOF_AGE_MS = 5 * 60 * 1000;

// Fixed owner, repository, Codespace and API origin. No caller-selected target,
// generic shell, user-supplied OAuth credentials or arbitrary URL forwarding.
function createPlandexCodespaceController({
  githubToken = '',
  fetchImpl = globalThis.fetch,
  budgetVerifier = null,
  now = Date.now,
  timeoutMs = 10000,
} = {}) {
  const token = String(githubToken || '').trim();
  function requireToken() {
    if (!token) throw new Error('GITHUB_AUTH_UNAVAILABLE');
  }
  async function github(method, suffix) {
    requireToken();
    if (!['', 'start', 'stop'].includes(suffix)) throw new Error('INVALID_CODESPACE_OPERATION');
    const url = API + '/user/codespaces/' + CODESPACE + (suffix ? '/' + suffix : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2026-03-10',
          'user-agent': 'plandex-orchestrator/0.3',
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!res || !res.ok) throw new Error('GITHUB_API_UNAVAILABLE_' + (Number.isInteger(res?.status) ? res.status : 'UNKNOWN'));
      if (method !== 'GET') return {};
      const data = await res.json();
      if (!data || data.name !== CODESPACE || data.repository?.full_name !== REPOSITORY) {
        throw new Error('CODESPACE_REPOSITORY_MISMATCH');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('GITHUB_API_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  function sanitize(codespace) {
    return {
      codespace: CODESPACE,
      repository: REPOSITORY,
      state: codespace.state,
      pendingOperation: Boolean(codespace.pending_operation),
      machine: codespace.machine?.name || null,
      idleTimeoutMinutes: Number.isInteger(codespace.idle_timeout_minutes) ? codespace.idle_timeout_minutes : null,
      updatedAt: codespace.updated_at || null,
    };
  }
  async function status() {
    return sanitize(await github('GET', ''));
  }
  async function confirmBudgetBlocked() {
    // GitHub netAmount === 0 is not a hard-stop assurance.
    // Only a fresh, server-supplied trusted verifier is acceptable.
    if (typeof budgetVerifier !== 'function') throw new Error('BUDGET_NOT_PROVEN_BLOCKED');
    const proof = await budgetVerifier();
    if (!proof || proof.usageBlocked !== true || proof.account !== OWNER || !proof.source) {
      throw new Error('BUDGET_NOT_PROVEN_BLOCKED');
    }
    const checkedAt = Number(proof.checkedAt);
    const age = now() - checkedAt;
    if (!Number.isFinite(checkedAt) || age < 0 || age > MAX_BUDGET_PROOF_AGE_MS) {
      throw new Error('BUDGET_PROOF_STALE');
    }
  }
  async function start(_callerInput) {
    const current = await status();
    if (current.state === 'Available' || current.state === 'Running') {
      return { ...current, confirmed: true, action: 'already_running' };
    }
    if (current.state !== 'Shutdown') {
      return { ...current, confirmed: false, action: 'not_startable' };
    }
    await confirmBudgetBlocked();
    await github('POST', 'start');
    const after = await status();
    return {
      ...after,
      confirmed: after.state === 'Available' || after.state === 'Running',
      action: 'start_requested',
    };
  }
  async function stop() {
    const current = await status();
    if (current.state === 'Shutdown') return { ...current, confirmed: true, action: 'already_stopped' };
    if (current.state === 'ShuttingDown') return { ...current, confirmed: false, action: 'stop_pending' };
    await github('POST', 'stop');
    const after = await status();
    return { ...after, confirmed: after.state === 'Shutdown', action: 'stop_requested' };
  }
  return Object.freeze({ status, start, stop });
}
module.exports = { createPlandexCodespaceController, CODESPACE, REPOSITORY };
