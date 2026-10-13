// Anonymous probes are read-only. Signed probes are allowed only while dispatch is disabled.
// Usage: node scripts/check-fleet-executor-http.cjs https://<authority> legacy|published [--signed-disabled]
const assert = require('node:assert/strict');
const { authorityUrl } = require('../persistd/src/fleet/executor-client');
const { signNodeRequest, verifyNodeRequest } = require('../persistd/src/fleet/auth');

async function main() {
  const baseUrl = authorityUrl(process.argv[2]), expected = process.argv[3];
  assert.ok(['legacy', 'published'].includes(expected), 'Specify legacy or published');
  const nodeId = process.env.PERSISTFLOW_FLEET_NODE_ID || 'desktop-primary';
  assert.equal(nodeId, 'desktop-primary', 'Initial rollout is limited to desktop-primary');
  const worker = '/v1/fleet/nodes/' + nodeId;
  const cases = [['/healthz', 'GET', 200], [worker + '/heartbeat', 'POST', 401],
    [worker + '/executions/poll', 'POST', expected === 'published' ? 401 : 404],
    [worker + '/executions/report', 'POST', expected === 'published' ? 401 : 404],
    ['/v1/runs/fleet-probe-not-created/fleet/execute', 'POST', expected === 'published' ? 401 : 404]];
  const evidence = [];
  for (const [pathname, method, status] of cases) {
    const response = await fetch(baseUrl + pathname, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(response.status, status, pathname);
    if (pathname === '/healthz') {
      const health = await response.json();
      assert.equal(health.ok, true); assert.equal(health.service, 'persistflow');
      assert.equal(health.authority, 'file'); assert.equal(health.durable, true);
    } else await response.arrayBuffer();
    evidence.push({ pathname, method, status: response.status });
  }
  if (process.argv.includes('--signed-disabled')) {
    assert.equal(expected, 'published');
    const secret = process.env.PERSISTFLOW_FLEET_NODE_SECRET;
    assert.ok(secret, 'Load the existing node secret through the approved private wrapper');
    const pathname = worker + '/executions/poll', body = '{}';
    for (const stale of [true, false]) {
      const timestamp = new Date(stale ? 0 : Date.now()).toISOString();
      const response = await fetch(baseUrl + pathname, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/json', 'x-persistflow-node-id': nodeId, 'x-persistflow-node-timestamp': timestamp,
          'x-persistflow-node-signature': signNodeRequest({ nodeId, secret, timestamp, method: 'POST', path: pathname, body }) } });
      const rawBody = await response.text();
      assert.equal(response.status, stale ? 401 : 503, 'Dispatch must remain disabled during signed smoke; stop if it is enabled');
      if (!stale) {
        assert.equal(JSON.parse(rawBody).error, 'FLEET_EXECUTION_DISABLED');
        assert.equal(verifyNodeRequest({ nodeId, timestamp: response.headers.get('x-persistflow-node-timestamp'),
          signature: response.headers.get('x-persistflow-node-signature'), method: 'RESPONSE-503', path: pathname,
          rawBody, secrets: { [nodeId]: secret }, maxSkewMs: 60_000 }), true);
      }
      evidence.push({ pathname, method: 'POST', signed: true, stale, status: response.status });
    }
  }
  process.stdout.write(JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl, expected, evidence }, null, 2) + '\n');
}
main().catch(() => { process.stderr.write('HTTP_SMOKE_FAILED: inspect expected deployment stage; no credentials are printed.\n'); process.exitCode = 1; });
