const { signNodeRequest, verifyNodeRequest } = require('./auth');
const { executionRequest } = require('./executor');

function authorityUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('INVALID_AUTHORITY_URL');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('AUTHORITY_HTTPS_REQUIRED');
  return url.origin;
}

class FleetAuthorityClient {
  constructor({ baseUrl, nodeId, secret, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = authorityUrl(baseUrl);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(nodeId || '') || typeof secret !== 'string' || !secret) throw new Error('NODE_SECRET_REQUIRED');
    this.nodeId = nodeId; this.secret = secret; this.fetchImpl = fetchImpl;
  }

  async request(action, input) {
    const { nodeId, secret } = this, timestamp = new Date().toISOString();
    const route = '/v1/fleet/nodes/' + encodeURIComponent(nodeId) + '/executions/' + action;
    const body = JSON.stringify(input);
    const response = await this.fetchImpl(this.baseUrl + route, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', 'x-persistflow-node-id': nodeId,
        'x-persistflow-node-timestamp': timestamp,
        'x-persistflow-node-signature': signNodeRequest({ nodeId, secret, timestamp, method: 'POST', path: route, body }) }, body,
    });
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 16 * 1024) throw new Error('AUTHORITY_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    if (!verifyNodeRequest({ nodeId, timestamp: response.headers.get('x-persistflow-node-timestamp'),
      signature: response.headers.get('x-persistflow-node-signature'), method: 'RESPONSE-' + response.status,
      path: route, rawBody, secrets: { [nodeId]: secret }, maxSkewMs: 60_000 })) throw new Error('AUTHORITY_RESPONSE_UNAUTHENTICATED');
    const value = JSON.parse(rawBody);
    if (!response.ok) throw new Error(value.error || 'AUTHORITY_HTTP_ERROR');
    return value;
  }

  async poll() {
    const value = await this.request('poll', {});
    if (value.job === null) return null;
    const job = value.job;
    if (!job || Object.keys(job).some(key => !['runId', 'operationId', 'generation', 'requestId', 'commandId'].includes(key))
      || typeof job.runId !== 'string' || !job.runId || typeof job.operationId !== 'string'
      || !Number.isInteger(job.generation) || job.generation < 1) throw new Error('AUTHORITY_RESPONSE_INVALID');
    executionRequest({ requestId: job.requestId, commandId: job.commandId });
    return job;
  }

  async report(job, receipt) {
    const value = await this.request('report', { ...job, status: receipt.status,
      exitCode: receipt.exitCode ?? null, outputTruncated: receipt.outputTruncated === true });
    if (value.acknowledged !== true || value.requestId !== job.requestId) throw new Error('AUTHORITY_RESPONSE_INVALID');
    return value;
  }
}

async function pollAndExecute({ executor, client }) {
  const job = await client.poll();
  if (!job) return null;
  let receipt;
  try { receipt = await executor.execute({ requestId: job.requestId, commandId: job.commandId }); }
  catch (error) {
    const rejected = ['COMMAND_NOT_ALLOWED', 'EXECUTOR_BUSY', 'INSUFFICIENT_LOCAL_CAPACITY', 'INVALID_EXECUTION_REQUEST'];
    receipt = { status: rejected.includes(error.message) ? 'REJECTED' : 'RUNNING' };
  }
  await client.report(job, receipt);
  return { requestId: job.requestId, commandId: job.commandId, status: receipt.status, exitCode: receipt.exitCode ?? null };
}

module.exports = { FleetAuthorityClient, authorityUrl, pollAndExecute };
