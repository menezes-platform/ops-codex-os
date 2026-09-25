const crypto = require('node:crypto');
const { McpServer, createMcpHandler } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { z } = require('zod');

function jsonResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function sameToken(actual, expected) {
  const a = Buffer.from(String(actual || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function createPersistFlowMcpNodeHandler({ service, token, tokenDigest, iconUrl, validateBearer, resourceMetadataUrl } = {}) {
  if (!service) throw new Error('PERSISTFLOW_SERVICE_REQUIRED');
  const handler = createMcpHandler((ctx) => {
    const resolvedIconUrl = iconUrl || (ctx.requestInfo ? new URL('/persistflow.svg', ctx.requestInfo.url).href : '');
    const info = { name: 'PersistFlow', version: '0.2.0' };
    if (resolvedIconUrl) info.icons = [{ src: resolvedIconUrl }];
    const server = new McpServer(info);

    server.registerTool('persist_run_start', {
      title: 'Start PersistFlow run',
      description: 'Create one durable PersistFlow run.',
      inputSchema: z.object({
        runId: z.string().min(1),
        goal: z.string().optional(),
      }),
    }, async (args) => jsonResult({ run: service.startRun(args) }));

    server.registerTool('persist_run_inspect', {
      title: 'Inspect PersistFlow run',
      description: 'Read canonical state for one run.',
      inputSchema: z.object({ runId: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    }, async ({ runId }) => jsonResult({ run: service.inspectRun(runId) }));

    server.registerTool('persist_run_heartbeat', {
      title: 'Heartbeat PersistFlow controller',
      description: 'Record liveness/progress for the current generation.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        progress: z.string().optional(),
      }),
    }, async ({ runId, ...input }) => jsonResult({ run: service.heartbeat(runId, input) }));

    server.registerTool('persist_run_checkpoint', {
      title: 'Checkpoint PersistFlow run',
      description: 'Persist the current generation checkpoint and next safe action.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        nextSafeAction: z.string().optional(),
        evidence: z.unknown().optional(),
      }),
    }, async ({ runId, ...input }) => jsonResult({ run: service.checkpoint(runId, input) }));

    server.registerTool('persist_run_claim', {
      title: 'Claim PersistFlow successor generation',
      description: 'CAS-promote the prepared successor generation using its one-time claim secret.',
      inputSchema: z.object({
        runId: z.string().min(1),
        expectedGeneration: z.number().int().positive(),
        generation: z.number().int().positive(),
        claimSecret: z.string().min(1),
      }),
    }, async ({ runId, ...input }) => jsonResult({ run: service.claim(runId, input) }));

    server.registerTool('persist_fleet_status', {
      title: 'Inspect PersistFlow fleet',
      description: 'Read registered fleet health and freshness without mutating machines.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, async () => jsonResult({ fleet: service.fleetStatus() }));

    server.registerTool('persist_fleet_route', {
      title: 'Route a PersistFlow task to the fleet',
      description: 'Choose and durably record the best eligible machine for one bounded task intent.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        intent: z.object({
          taskId: z.string().min(1),
          summary: z.string().min(1).max(2000),
          repo: z.string().optional(),
          ref: z.string().optional(),
          requiredCapabilities: z.array(z.string()).default([]),
          preferredCapabilities: z.array(z.string()).default([]),
          estimatedScratchBytes: z.number().int().nonnegative().default(0),
          artifactRefs: z.array(z.string()).default([]),
          requiresInteractiveUi: z.boolean().default(false),
          requiresGpu: z.boolean().default(false),
          parallelSafe: z.boolean().default(false),
          pinnedNodeId: z.string().optional(),
        }),
      }),
    }, async ({ runId, ...input }) => jsonResult(await service.routeTask(runId, input)));

    server.registerTool('persist_sandbox_create', {
      title: 'Create PersistFlow Sandbox workspace',
      description: 'Create a bounded execution workspace for a durable PersistFlow run and checkpoint the workspace evidence.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        repo: z.string().min(1),
        ref: z.string().min(1),
        providerHint: z.enum(['github_actions', 'railway', 'codespaces', 'remote_worker']).optional(),
        policyTier: z.enum(['trusted', 'standard', 'untrusted']).default('standard'),
        ttlSeconds: z.number().int().positive().max(86400).optional(),
        nextSafeAction: z.string().optional(),
      }),
    }, async ({ runId, ...input }) => jsonResult(await service.sandboxCreate(runId, input)));

    server.registerTool('persist_sandbox_inspect', {
      title: 'Inspect PersistFlow Sandbox workspace',
      description: 'Read workspace state from the execution plane without changing PersistFlow authority.',
      inputSchema: z.object({
        runId: z.string().min(1),
        workspaceId: z.string().min(1),
      }),
      annotations: { readOnlyHint: true },
    }, async ({ runId, workspaceId }) => jsonResult(await service.sandboxInspect(runId, workspaceId)));

    server.registerTool('persist_sandbox_exec', {
      title: 'Execute through PersistFlow Sandbox',
      description: 'Submit one replay-safe semantic operation to the Sandbox and checkpoint the queued job.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        workspaceId: z.string().min(1),
        operationId: z.string().min(1).max(128),
        operation: z.enum(['exec', 'read', 'write', 'git.status', 'git.diff', 'browser.run', 'artifact.list']),
        payload: z.record(z.string(), z.unknown()).default({}),
        priority: z.number().int().optional(),
        maxAttempts: z.number().int().positive().max(10).optional(),
        nextSafeAction: z.string().optional(),
      }),
    }, async ({ runId, ...input }) => jsonResult(await service.sandboxExec(runId, input)));

    server.registerTool('persist_sandbox_job', {
      title: 'Inspect PersistFlow Sandbox job',
      description: 'Read the current broker state for one sandbox job.',
      inputSchema: z.object({
        runId: z.string().min(1),
        jobId: z.string().min(1),
      }),
      annotations: { readOnlyHint: true },
    }, async ({ runId, jobId }) => jsonResult(await service.sandboxJob(runId, jobId)));

    server.registerTool('persist_sandbox_receipt', {
      title: 'Reconcile PersistFlow Sandbox receipt',
      description: 'Fetch the canonical sandbox receipt and persist it as evidence in the authoritative PersistFlow checkpoint.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        jobId: z.string().min(1),
        nextSafeAction: z.string().optional(),
      }),
    }, async ({ runId, ...input }) => jsonResult(await service.sandboxReceipt(runId, input)));

    server.registerTool('persist_sandbox_destroy', {
      title: 'Destroy PersistFlow Sandbox workspace',
      description: 'Destroy a sandbox workspace while preserving durable Git/receipt truth, then checkpoint the lifecycle evidence.',
      inputSchema: z.object({
        runId: z.string().min(1),
        generation: z.number().int().positive(),
        workspaceId: z.string().min(1),
        nextSafeAction: z.string().optional(),
      }),
    }, async ({ runId, ...input }) => jsonResult(await service.sandboxDestroy(runId, input)));

    return server;
  }, { responseMode: 'json' });

  const nodeHandler = toNodeHandler(handler);
  return async (req, res) => {
    if (!token && !tokenDigest && !validateBearer) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'mcp_not_configured' }));
      return;
    }
    const header = String(req.headers.authorization || '');
    const prefix = 'Bearer ';
    const actual = header.startsWith(prefix) ? header.slice(prefix.length) : '';
    const digest = crypto.createHash('sha256').update(actual, 'utf8').digest('hex');
    let authorized = token ? sameToken(actual, token) : sameToken(digest, tokenDigest);
    if (!authorized && validateBearer && actual) {
      try { authorized = Boolean(await validateBearer(actual, req)); }
      catch { authorized = false; }
    }
    if (!authorized) {
      const metadata = typeof resourceMetadataUrl === 'function' ? resourceMetadataUrl(req) : resourceMetadataUrl;
      const challenge = metadata
        ? `Bearer realm="PersistFlow", resource_metadata="${metadata}"`
        : 'Bearer realm="PersistFlow"';
      res.writeHead(401, {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': challenge,
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    return nodeHandler(req, res);
  };
}

module.exports = { createPersistFlowMcpNodeHandler, sameToken };
