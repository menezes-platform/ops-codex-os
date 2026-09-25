const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function dataDir(env = process.env) {
  return env.PERSISTFLOW_DATA_DIR || path.join(os.homedir(), '.persistflow-data');
}

function buildAuthorizationUrl({ clientId, redirectUri, state }) {
  if (!clientId || !redirectUri || !state) throw new Error('DRIVE_AUTHORIZATION_INPUT_REQUIRED');
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', String(clientId));
  url.searchParams.set('redirect_uri', String(redirectUri));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', String(state));
  return url.toString();
}

function writeRefreshToken(directory, refreshToken) {
  if (!refreshToken) throw new Error('DRIVE_REFRESH_TOKEN_MISSING');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'google-drive-refresh-token');
  fs.writeFileSync(target, String(refreshToken).trim() + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch {}
  return target;
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri, fetchImpl = globalThis.fetch }) {
  const body = new URLSearchParams({
    client_id: String(clientId),
    client_secret: String(clientSecret),
    code: String(code),
    redirect_uri: String(redirectUri),
    grant_type: 'authorization_code',
  });
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('DRIVE_AUTH_CODE_EXCHANGE_' + response.status);
  if (!payload.refresh_token) throw new Error('DRIVE_REFRESH_TOKEN_MISSING');
  return payload.refresh_token;
}

async function authorize({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const clientId = String(env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('DRIVE_OAUTH_CLIENT_CONFIG_REQUIRED');

  const state = crypto.randomBytes(24).toString('hex');
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const redirectUri = 'http://127.0.0.1:' + address.port + '/callback';
  const authorizationUrl = buildAuthorizationUrl({ clientId, redirectUri, state });

  process.stdout.write('Open this URL in your browser and approve Google Drive access:\n' + authorizationUrl + '\n');

  try {
    const code = await new Promise((resolve, reject) => {
      server.once('request', (req, res) => {
        try {
          const url = new URL(req.url, redirectUri);
          if (url.pathname !== '/callback') throw new Error('DRIVE_OAUTH_CALLBACK_PATH_INVALID');
          if (url.searchParams.get('state') !== state) throw new Error('DRIVE_OAUTH_STATE_MISMATCH');
          const value = url.searchParams.get('code');
          if (!value) throw new Error('DRIVE_OAUTH_CODE_MISSING');
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Google Drive authorization recorded. You can close this tab.');
          resolve(value);
        } catch (error) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Authorization failed.');
          reject(error);
        }
      });
    });
    const refreshToken = await exchangeCode({ clientId, clientSecret, code, redirectUri, fetchImpl });
    const target = writeRefreshToken(dataDir(env), refreshToken);
    process.stdout.write('Refresh credential stored at ' + target + '\n');
    return { path: target };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  authorize().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { buildAuthorizationUrl, writeRefreshToken, exchangeCode, authorize, dataDir };
