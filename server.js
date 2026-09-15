const http = require('node:http');

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      return sendJson(res, 200, { service: 'persistflow', status: 'ok' });
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      return sendJson(res, 200, { ok: true, service: 'persistflow' });
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => {
    process.stdout.write(`persistflow listening on ${port}\n`);
  });
}

module.exports = { createServer };
