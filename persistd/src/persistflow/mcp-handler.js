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

function createPersistFlowMcpNodeHandler({ service, token, iconUrl } = {}) {
  if (!service) throw new Error('PERSISTFLOW_SERVICE_REQUIRED');
  const handler = createMcpHandler((ctx) => {
    const resolvedIconUrl = iconUrl || (ctx.requestInfo ? new URL('/persistflow.svg', ctx.requestInfo.url).href : '');
    const info = { name: 'PersistFlow', version: '0.1.0' };
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

    return server;
  }, { responseMode: 'json' });

  const nodeHandler = toNodeHandler(handler);
  return async (req, res) => {
    if (!token) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'mcp_not_configured' }));
      return;
    }
    const header = String(req.headers.authorization || '');
    const prefix = 'Bearer ';
    const actual = header.startsWith(prefix) ? header.slice(prefix.length) : '';
    if (!sameToken(actual, token)) {
      res.writeHead(401, {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer realm="PersistFlow"',
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    return nodeHandler(req, res);
  };
}

module.exports = { createPersistFlowMcpNodeHandler, sameToken };
