const crypto = require('node:crypto');

function canonicalNodeRequest({ nodeId, timestamp, method, path, body }) {
  return [
    String(nodeId || ''),
    String(timestamp || ''),
    String(method || '').toUpperCase(),
    String(path || ''),
    String(body || ''),
  ].join('\n');
}

function signNodeRequest({ nodeId, secret, timestamp, method, path, body }) {
  const value = String(secret || '');
  if (!value) throw new Error('NODE_SECRET_REQUIRED');
  return crypto.createHmac('sha256', value)
    .update(canonicalNodeRequest({ nodeId, timestamp, method, path, body }), 'utf8')
    .digest('hex');
}

function safeEqualHex(actual, expected) {
  if (!/^[0-9a-f]{64}$/i.test(String(actual)) || !/^[0-9a-f]{64}$/i.test(String(expected))) return false;
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyNodeRequest({
  nodeId,
  timestamp,
  signature,
  method,
  path,
  rawBody,
  secrets,
  nowMs = Date.now,
  maxSkewMs = 5 * 60 * 1000,
}) {
  const secret = secrets?.[nodeId];
  if (!secret || !timestamp || !signature) return false;
  const parsed = Date.parse(String(timestamp));
  if (!Number.isFinite(parsed) || Math.abs(Number(nowMs()) - parsed) > maxSkewMs) return false;
  const expected = signNodeRequest({ nodeId, secret, timestamp, method, path, body: rawBody });
  return safeEqualHex(expected, signature);
}

function parseNodeSecrets(value) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(String(value)); } catch { throw new Error('FLEET_NODE_SECRETS_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('FLEET_NODE_SECRETS_INVALID');
  const output = {};
  for (const [key, secret] of Object.entries(parsed)) {
    if (typeof secret !== 'string' || !secret) throw new Error('FLEET_NODE_SECRETS_INVALID');
    output[String(key)] = secret;
  }
  return output;
}

module.exports = { canonicalNodeRequest, signNodeRequest, verifyNodeRequest, parseNodeSecrets };
