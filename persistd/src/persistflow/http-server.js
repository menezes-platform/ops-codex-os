const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MemoryAuthorityStore, FileAuthorityStore } = require('./authority-store');
const { FileOAuthStore } = require('./oauth-store');
const { PersistFlowService } = require('./service');
const { createSandboxProviderFromEnv } = require('./sandbox-provider');
const { createPersistFlowMcpNodeHandler, sameToken } = require('./mcp-handler');
const { createOAuthHttpHandler, requestOrigin } = require('./oauth-server');
const { FileFleetStore } = require('../fleet/store');
const { loadFleetConfig } = require('../fleet/contracts');
const { verifyNodeRequest, parseNodeSecrets, signNodeRequest } = require('../fleet/auth');
const { createDriveTokenProviderFromEnv } = require('../storage/drive-auth');
const { DriveClient } = require('../storage/drive-client');
const { DriveObjectStore } = require('../storage/object-store');
const { ObservationQueue } = require('../fleet/observation');

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonWithRaw(req, maxBytes = 64 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new Error('BODY_TOO_LARGE');
  }
  if (!raw) return { raw: '', value: {} };
  try { return { raw, value: JSON.parse(raw) }; }
  catch { throw new Error('INVALID_JSON'); }
}

async function readJson(req, maxBytes = 64 * 1024) {
  return (await readJsonWithRaw(req, maxBytes)).value;
}
function errorStatus(error) {
  const code = error?.message || 'INTERNAL_ERROR';
  if (code === 'RUN_NOT_FOUND') return 404;
  if (code === 'FLEET_EXECUTION_DISABLED' || code === 'EXECUTOR_NODE_NOT_CONFIGURED' || code === 'NO_ELIGIBLE_NODE' || code === 'FLEET_ROUTER_NOT_CONFIGURED') return 503;
  if (code === 'EXECUTION_ID_CONFLICT') return 409;
  if (code === 'INVALID_EXECUTION_REQUEST') return 400;
  if (code === 'DRIVE_AUTH_UNAVAILABLE') return 503;
  if (['RUN_ALREADY_EXISTS', 'STALE_GENERATION', 'CLAIM_NOT_PENDING', 'CLAIM_TARGET_MISMATCH', 'CLAIM_NONCE_MISMATCH'].includes(code)) return 409;
  if (['RUN_ID_REQUIRED', 'INVALID_GENERATION', 'CLAIM_SECRET_REQUIRED', 'INVALID_JSON', 'BODY_TOO_LARGE', 'INVALID_RUN_UPDATE'].includes(code)) return 400;
  return 500;
}

function productionDataDir({ env = process.env, homedir = os.homedir() } = {}) {
  return env.PERSISTFLOW_DATA_DIR || path.join(homedir, '.persistflow-data');
}

function createProductionStore(options = {}) {
  return new FileAuthorityStore(productionDataDir(options));
}

function createProductionOAuthStore(options = {}) {
  return new FileOAuthStore(path.join(productionDataDir(options), 'oauth'));
}

function createProductionFleetStore(options = {}) {
  return new FileFleetStore(path.join(productionDataDir(options), 'fleet'));
}

const DEFAULT_FLEET_CONFIG_PATH = path.join(__dirname, '../../config/fleet.json');

function loadProductionFleetConfig({ configPath = DEFAULT_FLEET_CONFIG_PATH } = {}) {
  return loadFleetConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
}

function productionFleetNodeSecrets({ env = process.env } = {}) {
  return parseNodeSecrets(env.PERSISTFLOW_FLEET_NODE_SECRETS_JSON || '');
}

const DEFAULT_MCP_DIGEST_PATH = path.join(__dirname, '../../config/mcp-token.sha256');

function resolveMcpTokenDigest({ env = process.env, fallbackPath = DEFAULT_MCP_DIGEST_PATH } = {}) {
  const configured = String(env.PERSISTFLOW_MCP_TOKEN_SHA256 || '').trim();
  if (configured) return configured;
  try { return fs.readFileSync(fallbackPath, 'utf8').trim(); }
  catch { return ''; }
}

function ownerBearerAuthorized(req, token, tokenDigest) {
  const header = String(req.headers.authorization || '');
  const prefix = 'Bearer ';
  const actual = header.startsWith(prefix) ? header.slice(prefix.length) : '';
  if (!actual) return false;
  if (token && sameToken(actual, token)) return true;
  const digest = crypto.createHash('sha256').update(actual, 'utf8').digest('hex');
  return Boolean(tokenDigest && sameToken(digest, tokenDigest));
}

function createServer({
  store = new MemoryAuthorityStore(),
  clock = () => new Date(),
  mcpToken = process.env.PERSISTFLOW_MCP_TOKEN || '',
  mcpTokenDigest = resolveMcpTokenDigest(),
  iconUrl = process.env.PERSISTFLOW_ICON_URL || '',
  oauthStore = null,
  ownerTokenDigest = '',
  sandboxProvider = createSandboxProviderFromEnv(),
  fleetStore = null,
  fleetConfig = { nodes: [] },
  fleetNodeSecrets = {},
  fleetRouter = null,
  fleetExecutorEnabled = false,
  desktopObservationEnabled = false,
  desktopObservationNodes = {},
  ephemeralProvider = null,
  ephemeralEnabled = false,
  driveAuth = createDriveTokenProviderFromEnv(),
  objectStore = undefined,
} = {}) {
  let resolvedObjectStore = objectStore;
  if (resolvedObjectStore === undefined && driveAuth?.rootId) {
    const client = new DriveClient({ tokenProvider: () => driveAuth.getAccess() });
    resolvedObjectStore = new DriveObjectStore({ client, rootId: driveAuth.rootId });
  }
  const service = new PersistFlowService({
    store,
    clock,
    sandbox: sandboxProvider,
    fleetStore,
    fleetConfig,
    fleetRouter,
    fleetExecutorEnabled,
    ephemeralProvider,
    ephemeralEnabled,
    driveAuth,
    objectStore: resolvedObjectStore || null,
  });
  const resolvedOwnerTokenDigest = ownerTokenDigest || mcpTokenDigest;
  const observationQueue = new ObservationQueue({service,enabled:desktopObservationEnabled,nodes:desktopObservationNodes,clock:()=>clock().getTime()});
  if (oauthStore && typeof oauthStore.synchronizeOwnerTokenDigest === 'function') {
    oauthStore.synchronizeOwnerTokenDigest(resolvedOwnerTokenDigest);
  }
  const validateBearer = oauthStore ? (bearer, req) => oauthStore.validateAccessToken(bearer, `${requestOrigin(req)}/mcp`) : null;
  const resourceMetadataUrl = oauthStore ? (req) => `${requestOrigin(req)}/.well-known/oauth-protected-resource/mcp` : null;
  const mcpNodeHandler = createPersistFlowMcpNodeHandler({ service, observationQueue, token: mcpToken, tokenDigest: mcpTokenDigest, iconUrl, validateBearer, resourceMetadataUrl });
  const oauthHttpHandler = oauthStore ? createOAuthHttpHandler({ store: oauthStore, ownerTokenDigest: resolvedOwnerTokenDigest }) : null;
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://persistflow.local');
      if (oauthHttpHandler && await oauthHttpHandler(req, res, url)) return;
      if (url.pathname === '/mcp') return mcpNodeHandler(req, res);
      if (req.method === 'GET' && url.pathname === '/persistflow.svg') {
        const body = fs.readFileSync(path.join(__dirname, '../../assets/persistflow.svg'));
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'content-length': body.length, 'cache-control': 'public, max-age=86400' });
        res.end(body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') {
        return sendJson(res, 200, { service: 'persistflow', status: 'ok' });
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, service: 'persistflow', authority: store.kind, durable: store.kind !== 'memory' });
      }
      const executionWorker = /^\/v1\/fleet\/nodes\/([^/]+)\/executions\/(poll|report)$/.exec(url.pathname);
      const observationWorker = /^\/v1\/fleet\/nodes\/([^/]+)\/observations\/(poll|report)$/.exec(url.pathname);
      if (req.method==='POST' && observationWorker) {
        const nodeId=decodeURIComponent(observationWorker[1]);
        // Reject unsigned traffic before buffering an observation body.
        if (!Object.hasOwn(fleetNodeSecrets,nodeId) || req.headers['x-persistflow-node-id']!==nodeId
          || !/^[0-9a-f]{64}$/i.test(req.headers['x-persistflow-node-signature']||'')
          || !Number.isFinite(Date.parse(req.headers['x-persistflow-node-timestamp']))
          || Math.abs(clock().getTime()-Date.parse(req.headers['x-persistflow-node-timestamp']))>60000) return sendJson(res,401,{error:'unauthorized'});
        const {raw,value}=await readJsonWithRaw(req,observationWorker[2]==='poll' ? 4096 : 2*1024*1024);
        if (!fleetConfig.nodes.some(n=>n.id===nodeId) || req.headers['x-persistflow-node-id']!==nodeId
          || !verifyNodeRequest({nodeId,timestamp:req.headers['x-persistflow-node-timestamp'],signature:req.headers['x-persistflow-node-signature'],method:req.method,path:url.pathname,rawBody:raw,secrets:fleetNodeSecrets,nowMs:()=>clock().getTime(),maxSkewMs:60000})) return sendJson(res,401,{error:'unauthorized'});
        const reply=(status,result)=>{
          const body=JSON.stringify(result),timestamp=clock().toISOString();
          res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-persistflow-node-timestamp':timestamp,
            'x-persistflow-node-signature':signNodeRequest({nodeId,secret:fleetNodeSecrets[nodeId],timestamp,method:'RESPONSE-'+status,path:url.pathname,body})});res.end(body);
        };
        try {
          if (observationWorker[2]==='poll') {
            if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length) throw Error('INVALID_OBSERVATION_REQUEST');
            return reply(200,observationQueue.poll(nodeId));
          }
          return reply(200,observationQueue.report(nodeId,value));
        } catch(error) {
          const code=/^(OBSERVATION_|INVALID_OBSERVATION_|STALE_GENERATION|RUN_NOT_FOUND)/.test(error.message||'') ? error.message : 'OBSERVATION_FAILED';
          return reply(code==='OBSERVATION_DISABLED'?503:400,{error:code});
        }
      }
      if (req.method === 'POST' && executionWorker) {
        const nodeId = decodeURIComponent(executionWorker[1]);
        const { raw, value } = await readJsonWithRaw(req, 4096);
        const authorized = fleetConfig.nodes.some(node => node.id === nodeId)
          && req.headers['x-persistflow-node-id'] === nodeId
          && verifyNodeRequest({ nodeId, timestamp: req.headers['x-persistflow-node-timestamp'],
            signature: req.headers['x-persistflow-node-signature'], method: req.method, path: url.pathname,
            rawBody: raw, secrets: fleetNodeSecrets, nowMs: () => clock().getTime(), maxSkewMs: 60_000 });
        if (!authorized) return sendJson(res, 401, { error: 'unauthorized' });
        const reply = (status, result) => {
          const body = JSON.stringify(result), timestamp = clock().toISOString();
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
            'x-persistflow-node-timestamp': timestamp,
            'x-persistflow-node-signature': signNodeRequest({ nodeId, secret: fleetNodeSecrets[nodeId], timestamp,
              method: 'RESPONSE-' + status, path: url.pathname, body }) });
          res.end(body);
        };
        try {
          if (executionWorker[2] === 'poll') {
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new Error('INVALID_EXECUTION_REQUEST');
            return reply(200, service.pollFleetExecution(nodeId));
          }
          return reply(200, service.reportFleetExecution(nodeId, value));
        } catch (error) {
          const status = errorStatus(error);
          return reply(status, { error: status === 500 ? 'internal_error' : error.message });
        }
      }
      const fleetHeartbeat = /^\/v1\/fleet\/nodes\/([^/]+)\/heartbeat$/.exec(url.pathname);
      if (req.method === 'POST' && fleetHeartbeat) {
        const nodeId = decodeURIComponent(fleetHeartbeat[1]);
        const headerNodeId = String(req.headers['x-persistflow-node-id'] || '');
        const timestamp = String(req.headers['x-persistflow-node-timestamp'] || '');
        const signature = String(req.headers['x-persistflow-node-signature'] || '');
        const registered = Array.isArray(fleetConfig?.nodes)
          && fleetConfig.nodes.some((node) => node.id === nodeId);
        const { raw, value } = await readJsonWithRaw(req);
        const authorized = registered
          && headerNodeId === nodeId
          && verifyNodeRequest({
            nodeId,
            timestamp,
            signature,
            method: req.method,
            path: url.pathname,
            rawBody: raw,
            secrets: fleetNodeSecrets,
            nowMs: () => clock().getTime(),
          });
        if (!authorized) return sendJson(res, 401, { error: 'unauthorized' });
        const heartbeat = service.fleetHeartbeat(nodeId, value);
        return sendJson(res, 200, heartbeat);
      }
      const driveToken = /^\/v1\/fleet\/nodes\/([^/]+)\/drive-token$/.exec(url.pathname);
      if (req.method === 'POST' && driveToken) {
        const nodeId = decodeURIComponent(driveToken[1]);
        const headerNodeId = String(req.headers['x-persistflow-node-id'] || '');
        const timestamp = String(req.headers['x-persistflow-node-timestamp'] || '');
        const signature = String(req.headers['x-persistflow-node-signature'] || '');
        const registered = Array.isArray(fleetConfig?.nodes)
          && fleetConfig.nodes.some((node) => node.id === nodeId);
        const { raw } = await readJsonWithRaw(req);
        const authorized = registered
          && headerNodeId === nodeId
          && verifyNodeRequest({
            nodeId,
            timestamp,
            signature,
            method: req.method,
            path: url.pathname,
            rawBody: raw,
            secrets: fleetNodeSecrets,
            nowMs: () => clock().getTime(),
          });
        if (!authorized) return sendJson(res, 401, { error: 'unauthorized' });
        const access = await service.issueDriveAccess(nodeId);
        return sendJson(res, 200, access);
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
      const fleetExecution = /^\/v1\/runs\/([^/]+)\/fleet\/execute$/.exec(url.pathname);
      if (req.method === 'POST' && fleetExecution) {
        if (!ownerBearerAuthorized(req, mcpToken, mcpTokenDigest)) return sendJson(res, 401, { error: 'unauthorized' });
        return sendJson(res, 200, await service.executeFleetTask(decodeURIComponent(fleetExecution[1]), await readJson(req)));
      }
      const bridgeSync = /^\/v1\/runs\/([^/]+)\/bridge\/sync$/.exec(url.pathname);
      if (req.method === 'POST' && bridgeSync) {
        if (!ownerBearerAuthorized(req, mcpToken, mcpTokenDigest)) return sendJson(res, 401, { error: 'unauthorized' });
        const run = service.bridgeSync(decodeURIComponent(bridgeSync[1]), await readJson(req));
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

module.exports = {
  createServer,
  createProductionStore,
  createProductionOAuthStore,
  createProductionFleetStore,
  loadProductionFleetConfig,
  productionFleetNodeSecrets,
  resolveMcpTokenDigest,
};
