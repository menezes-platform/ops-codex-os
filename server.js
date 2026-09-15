const http = require('node:http');
const { MemoryAuthorityStore } = require('./persistd/src/persistflow/authority-store');
const { PersistFlowService } = require('./persistd/src/persistflow/service');

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req, maxBytes = 64 * 1024) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > maxBytes) throw new Error('BODY_TOO_LARGE');
  }
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error('INVALID_JSON'); }
}

function errorStatus(error) {
  const code = error?.message || 'INTERNAL_ERROR';
  if (code === 'RUN_NOT_FOUND') return 404;
  if (['RUN_ALREADY_EXISTS', 'STALE_GENERATION', 'CLAIM_NOT_PENDING', 'CLAIM_TARGET_MISMATCH', 'CLAIM_NONCE_MISMATCH'].includes(code)) return 409;
  if (['RUN_ID_REQUIRED', 'INVALID_GENERATION', 'CLAIM_SECRET_REQUIRED', 'INVALID_JSON', 'BODY_TOO_LARGE', 'INVALID_RUN_UPDATE'].includes(code)) return 400;
  return 500;
}

function createServer({ store = new MemoryAuthorityStore(), clock = () => new Date() } = {}) {
  const service = new PersistFlowService({ store, clock });
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://persistflow.local');
      if (req.method === 'GET' && url.pathname === '/') {
        return sendJson(res, 200, { service: 'persistflow', status: 'ok' });
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, service: 'persistflow' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/runs') {
        const run = service.startRun(await readJson(req));
        return sendJson(res, 201, { run });
      }

      const runMatch = /^\/v1\/runs\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && runMatch) {
        const run = service.inspectRun(decodeURIComponent(runMatch[1]));
        return sendJson(res, 200, { run });
      }
      const heartbeat = /^\/v1\/runs\/([^/]+)\/heartbeat$/.exec(url.pathname);
      if (req.method === 'POST' && heartbeat) {
        const run = service.heartbeat(decodeURIComponent(heartbeat[1]), await readJson(req));
        return sendJson(res, 200, { run });
      }
      const claim = /^\/v1\/runs\/([^/]+)\/claim$/.exec(url.pathname);
      if (req.method === 'POST' && claim) {
        const run = service.claim(decodeURIComponent(claim[1]), await readJson(req));
        return sendJson(res, 200, { run });
      }
      const checkpoints = /^\/v1\/runs\/([^/]+)\/checkpoints$/.exec(url.pathname);
      if (req.method === 'POST' && checkpoints) {
        const run = service.checkpoint(decodeURIComponent(checkpoints[1]), await readJson(req));
        return sendJson(res, 200, { run });
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      const status = errorStatus(error);
      const code = status === 500 ? 'internal_error' : String(error.message || 'error').toLowerCase();
      return sendJson(res, status, { error: code });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => process.stdout.write(`persistflow listening on ${port}\n`));
}

module.exports = { createServer };
