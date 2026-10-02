'use strict';

const crypto = require('node:crypto');

const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|token|credential|secret)\s*[:=]\s*\S+/i,
  /\b(?:cookie|set-cookie|session[_ -]?token|auth[_ -]?token)\s*[:=]\s*\S+/i,
  /\b(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/]+:[^\s@]+@/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

const MCP_TOOL_DEFINITIONS = Object.freeze([
  { name: 'memory_recall', description: 'Recall evidence-backed derived context for one explicitly scoped project.', inputSchema: { type: 'object', additionalProperties: false, required: ['scope', 'query'], properties: { scope: { type: 'string', pattern: '^project/[^/]+/[^/]+$' }, query: { type: 'string', minLength: 1, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 20 }, timeWindow: { type: 'object' }, evidenceFilters: { type: 'object' } } } },
  { name: 'memory_derive', description: 'Ingest explicitly supplied project events and emit review-only derived candidates.', inputSchema: { type: 'object', additionalProperties: false, required: ['scope', 'events'], properties: { scope: { type: 'string', pattern: '^project/[^/]+/[^/]+$' }, events: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['eventId', 'content', 'observedAt', 'provenance'], properties: { eventId: { type: 'string', maxLength: 500 }, content: { type: 'string', maxLength: 16000 }, observedAt: { type: 'string', format: 'date-time' }, provenance: { type: 'object', additionalProperties: false, required: ['repo', 'ref', 'path'], properties: { repo: { type: 'string' }, ref: { type: 'string' }, path: { type: 'string' }, section: { type: 'string' } } } } } }, context: { type: 'object' } } } },
  { name: 'memory_explain', description: 'Explain the evidence and temporal provenance for one derived item.', inputSchema: { type: 'object', additionalProperties: false, required: ['scope', 'itemId'], properties: { scope: { type: 'string', pattern: '^project/[^/]+/[^/]+$' }, itemId: { type: 'string', minLength: 1, maxLength: 200 } } } },
]);

function canonicalProjectScope(scope) {
  if (typeof scope !== 'string' || !/^project\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(scope)) {
    throw new Error('scope must be project/<owner>/<repo>');
  }
  return scope.toLowerCase();
}

function scopeToBankId(scope) {
  const canonical = canonicalProjectScope(scope);
  const [, owner, repo] = canonical.split('/');
  return `project--${owner}--${repo}`;
}

function assertSafeText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 16000) throw new Error('content unavailable');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) throw new Error('secret-like content rejected');
}

function validateEvidenceScope(expectedScope, request) {
  if (typeof request?.scope !== 'string' || request.scope !== expectedScope) throw new Error('explicit matching scope is required');
}

class MemoryCognitionProvider {
  constructor({ provider }) {
    if (!provider) throw new Error('provider name is required');
    this.providerName = provider;
    this.capabilities = Object.freeze({ recall: true, derive: false, explain: false });
  }

  normalizeRecall(records, request) {
    if (!request?.scope) throw new Error('explicit scope is required');
    if (!Array.isArray(records)) throw new Error('provider response must be a list');
    const retrievedAt = new Date().toISOString();
    return records.slice(0, Math.max(0, request.limit ?? 8)).map((record, index) => {
      if (!record || typeof record.text !== 'string' || !record.text.trim()) return null;
      const occurredAt = record.occurredAt ?? record.occurred_start ?? record.occurredStart ?? null;
      const recordedAt = record.recordedAt ?? record.mentionedAt ?? record.mentioned_at ?? record.timestamp ?? null;
      const provenance = record.provenance ?? {};
      return {
        id: String(record.id ?? record.chunk_id ?? `rank-${index + 1}`),
        text: record.text,
        scope: request.scope,
        provider: this.providerName,
        derived: true,
        retrieval: {
          method: record.retrievalMethod ?? record.retrieval_method ?? this.providerName,
          score: Number.isFinite(record.score) ? record.score : null,
          rank: index + 1,
        },
        temporal: {
          occurredAt,
          recordedAt,
          validFrom: record.occurredStart ?? record.occurred_start ?? null,
          validUntil: record.occurredEnd ?? record.occurred_end ?? null,
          retrievedAt,
          status: occurredAt ? 'event-time-known' : recordedAt ? 'recorded-time-only' : 'unknown',
        },
        provenance: {
          ...provenance,
          provider: this.providerName,
          retrievalMethod: record.retrievalMethod ?? record.retrieval_method ?? this.providerName,
          originalEvidenceRef: provenance.originalEvidenceRef ?? provenance.itemId ?? record.id ?? record.chunk_id ?? null,
        },
        entities: Array.isArray(record.entities) ? record.entities : [],
        conflicts: Array.isArray(record.conflicts) ? record.conflicts : [],
        stale: record.stale === true,
      };
    }).filter(Boolean);
  }

  async derive() {
    throw new Error(`${this.providerName} does not support derive`);
  }

  async explain() {
    throw new Error(`${this.providerName} does not support explain`);
  }
}

class EngramAdapter extends MemoryCognitionProvider {
  constructor({ search, now = () => new Date().toISOString() }) {
    super({ provider: 'engram' });
    if (typeof search !== 'function') throw new Error('Engram search transport is required');
    this.search = search;
    this.now = now;
    this.capabilities = Object.freeze({ recall: true, semantic: true, keyword: true, transcript: true, derive: false, securityIsolation: false });
    this.isolation = Object.freeze({ kind: 'relevance-filter-only', securityBoundary: false });
  }

  async recall(request) {
    if (!request?.query?.trim()) throw new Error('query is required');
    const scope = canonicalProjectScope(request.scope);
    const [, owner, repo] = scope.split('/');
    const response = await this.search({ query: request.query, project: repo, limit: request.limit ?? 8, ...(request.evidenceFilters?.tags ? { tags: request.evidenceFilters.tags } : {}) });
    const rows = Array.isArray(response?.results) ? response.results : [];
    const items = [];
    for (const row of rows) {
      const title = typeof row.conversation_title === 'string' ? row.conversation_title.toLowerCase() : '';
      // Search filters in Engram are relevance selectors, so discard every result without an exact project-title prefix.
      if (title !== repo && !title.startsWith(`${repo}:`) && !title.startsWith(`${repo} `)) continue;
      const item = {
        id: row.chunk_id ?? row.conversation_id,
        text: row.chunk_text ?? row.chunk_summary,
        score: row.score,
        retrievalMethod: 'engram-hybrid',
        recordedAt: row.created_at ?? row.timestamp ?? null,
        provenance: {
          repo: `${owner}/${repo}`,
          conversationId: row.conversation_id ?? null,
          messageId: row.chunk_id ?? null,
          sourceId: row.conversation_id ?? row.chunk_id ?? null,
          timestamp: row.created_at ?? row.timestamp ?? null,
          project: repo,
          tags: Array.isArray(row.tags) ? row.tags : [],
          retrievalMethod: 'engram-hybrid',
          originalEvidenceRef: row.chunk_id ?? row.conversation_id ?? null,
          conversationTitle: row.conversation_title,
        },
      };
      if (typeof item.text === 'string' && item.text.trim()) items.push(item);
    }
    return this.normalizeRecall(items, { ...request, scope });
  }
}


class RAGFlowAdapter extends MemoryCognitionProvider {
  constructor({
    baseUrl,
    apiKey,
    datasetsByScope = {},
    fetchImpl = globalThis.fetch,
    timeoutMs = 2500,
    attempts = 2,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    metrics = new Metrics(),
    similarityThreshold = 0.2,
    vectorSimilarityWeight = 0.5,
    knnTopK = 128,
    knnNumCandidates = 256,
    rerankCandidatesCount = 32,
    rerankId = null,
    includeKnowledgeCompilation = false,
  }) {
    super({ provider: 'ragflow' });
    if (!baseUrl || typeof fetchImpl !== 'function') throw new Error('RAGFlow URL and fetch transport are required');
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('RAGFlow API key is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.attempts = Math.max(1, Math.min(2, attempts));
    this.sleep = sleep;
    this.random = random;
    this.metrics = metrics;
    this.similarityThreshold = Math.max(0, Math.min(1, Number(similarityThreshold)));
    this.vectorSimilarityWeight = Math.max(0, Math.min(1, Number(vectorSimilarityWeight)));
    this.knnTopK = Math.max(1, Math.min(2048, Number(knnTopK) || 128));
    this.knnNumCandidates = Math.max(this.knnTopK, Math.min(4096, Number(knnNumCandidates) || 256));
    this.rerankCandidatesCount = Math.max(1, Math.min(512, Number(rerankCandidatesCount) || 32));
    this.rerankId = typeof rerankId === 'string' && rerankId.trim() ? rerankId.trim() : null;
    this.includeKnowledgeCompilation = includeKnowledgeCompilation === true;
    this.datasetsByScope = new Map();
    for (const [rawScope, ids] of Object.entries(datasetsByScope)) {
      const canonical = canonicalProjectScope(rawScope);
      const normalizedIds = Array.isArray(ids)
        ? [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
        : [];
      if (!normalizedIds.length) throw new Error('RAGFlow dataset allowlist must contain at least one dataset per scope');
      this.datasetsByScope.set(canonical, Object.freeze(normalizedIds));
    }
    this.capabilities = Object.freeze({
      recall: true,
      semantic: true,
      keyword: true,
      hybrid: true,
      rerank: Boolean(this.rerankId),
      derive: false,
      explain: false,
      securityIsolation: true,
    });
    this.isolation = Object.freeze({ kind: 'explicit-scope-to-dataset-allowlist', securityBoundary: true });
  }

  datasetsForScope(scope) {
    const canonical = canonicalProjectScope(scope);
    const datasetIds = this.datasetsByScope.get(canonical);
    if (!datasetIds?.length) throw new Error('scope is not in the configured RAGFlow dataset allowlist');
    return { scope: canonical, datasetIds };
  }

  async request(body) {
    let lastError;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const started = Date.now();
      this.metrics.increment('requests');
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/v1/retrieval`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.status === 429) this.metrics.increment('rateLimits');
        if (!response.ok) {
          const error = new Error(`RAGFlow HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        let payload;
        try { payload = await response.json(); } catch { throw new Error('RAGFlow malformed response'); }
        if (!payload || typeof payload !== 'object') throw new Error('RAGFlow malformed response');
        if (Number.isFinite(payload.code) && payload.code !== 0) {
          const error = new Error('RAGFlow request rejected');
          error.status = 400;
          throw error;
        }
        this.metrics.increment('successes');
        this.metrics.observeLatency(Date.now() - started);
        return payload;
      } catch (error) {
        lastError = error;
        const isTimeout = error?.name === 'AbortError';
        if (isTimeout) this.metrics.increment('timeouts');
        if (attempt < this.attempts && (isTimeout || !error?.status || error.status === 429 || error.status >= 500)) {
          this.metrics.increment('retries');
          const delay = Math.min(250, 30 * (2 ** (attempt - 1))) * (0.5 + this.random());
          await this.sleep(delay);
          continue;
        }
        this.metrics.increment('failures');
        this.metrics.observeLatency(Date.now() - started);
        throw new Error('RAGFlow request failed');
      } finally {
        clearTimeout(timer);
      }
    }
    this.metrics.increment('failures');
    throw new Error(lastError ? 'RAGFlow request failed' : 'RAGFlow request unavailable');
  }

  async recall(request) {
    if (!request?.query?.trim()) throw new Error('query is required');
    const { scope, datasetIds } = this.datasetsForScope(request.scope);
    const [, owner, repo] = scope.split('/');
    const repoName = `${owner}/${repo}`;
    const limit = Math.min(20, Math.max(1, Number(request.limit) || 8));
    const body = {
      question: request.query,
      dataset_ids: datasetIds,
      page: 1,
      page_size: limit,
      similarity_threshold: this.similarityThreshold,
      vector_similarity_weight: this.vectorSimilarityWeight,
      knn_top_k: this.knnTopK,
      knn_num_candidates: this.knnNumCandidates,
      rerank_candidates_count: Math.max(limit, this.rerankCandidatesCount),
      keyword: true,
      highlight: false,
      use_kg: request.evidenceFilters?.useKg === true,
      toc_enhance: request.evidenceFilters?.tocEnhance === true,
      include_knowledge_compilation: this.includeKnowledgeCompilation,
      metadata_condition: {
        logic: 'and',
        conditions: [{ name: 'repo', comparison_operator: '=', value: repoName }],
      },
    };
    if (this.rerankId) body.rerank_id = this.rerankId;
    if (Array.isArray(request.evidenceFilters?.documentIds)) {
      body.document_ids = request.evidenceFilters.documentIds
        .filter((id) => typeof id === 'string' && id.trim())
        .slice(0, 100);
    }
    if (Array.isArray(request.evidenceFilters?.crossLanguages)) {
      body.cross_languages = request.evidenceFilters.crossLanguages
        .filter((language) => typeof language === 'string' && language.trim())
        .slice(0, 8);
    }

    const payload = await this.request(body);
    const envelope = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const rows = Array.isArray(envelope.chunks) ? envelope.chunks : [];
    const allowedDatasets = new Set(datasetIds);
    const normalized = [];

    for (const row of rows.slice(0, limit)) {
      if (!row || typeof row.content !== 'string' || !row.content.trim()) continue;
      if (row.dataset_id && !allowedDatasets.has(row.dataset_id)) continue;
      const metadata = row.document_metadata && typeof row.document_metadata === 'object'
        ? row.document_metadata
        : row.metadata && typeof row.metadata === 'object'
          ? row.metadata
          : {};
      if (metadata.repo && String(metadata.repo).toLowerCase() !== repoName.toLowerCase()) continue;
      normalized.push({
        id: row.id,
        text: row.content,
        score: Number.isFinite(row.similarity) ? row.similarity : null,
        retrievalMethod: this.rerankId ? 'ragflow-hybrid-rerank' : 'ragflow-hybrid',
        recordedAt: metadata.observed_at ?? metadata.timestamp ?? null,
        stale: metadata.stale === true,
        provenance: {
          repo: repoName,
          ref: metadata.ref ?? metadata.commit ?? null,
          path: metadata.path ?? row.document_name ?? null,
          section: metadata.section ?? null,
          timestamp: metadata.observed_at ?? metadata.timestamp ?? null,
          datasetId: row.dataset_id ?? datasetIds[0],
          documentId: row.document_id ?? null,
          documentName: row.document_name ?? null,
          vectorSimilarity: Number.isFinite(row.vector_similarity) ? row.vector_similarity : null,
          termSimilarity: Number.isFinite(row.term_similarity) ? row.term_similarity : null,
          provider: 'ragflow',
          retrievalMethod: this.rerankId ? 'ragflow-hybrid-rerank' : 'ragflow-hybrid',
          originalEvidenceRef: metadata.source_id ?? row.document_id ?? row.id ?? null,
        },
      });
    }

    this.metrics.increment('recalls');
    this.metrics.increment('recallResults', normalized.length);
    if (!normalized.length) this.metrics.increment('noResults');
    return this.normalizeRecall(normalized, { ...request, scope, limit });
  }
}

class HindsightAdapter extends MemoryCognitionProvider {
  constructor({ baseUrl, token, projectScopes = [], fetchImpl = globalThis.fetch, timeoutMs = 2500, attempts = 2, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random, metrics = new Metrics() }) {
    super({ provider: 'hindsight' });
    if (!baseUrl || typeof fetchImpl !== 'function') throw new Error('Hindsight URL and fetch transport are required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token || null;
    this.allowedScopes = new Set(projectScopes.map(canonicalProjectScope));
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.attempts = Math.max(1, Math.min(2, attempts));
    this.sleep = sleep;
    this.random = random;
    this.metrics = metrics;
  }

  assertAllowed(scope) {
    const canonical = canonicalProjectScope(scope);
    if (!this.allowedScopes.has(canonical)) throw new Error('scope is not in the configured Hindsight project allowlist');
    return canonical;
  }

  async request(scope, operation, body) {
    const bank = scopeToBankId(this.assertAllowed(scope));
    const url = `${this.baseUrl}/v1/default/banks/${encodeURIComponent(bank)}/memories/${operation}`;
    let lastError;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const started = Date.now();
      this.metrics.increment('requests');
      try {
        const headers = { 'content-type': 'application/json' };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        const response = await this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        if (response.status === 429) this.metrics.increment('rateLimits');
        if (!response.ok) {
          const error = new Error(`Hindsight HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        let payload;
        try { payload = await response.json(); } catch { throw new Error('Hindsight malformed response'); }
        if (!payload || typeof payload !== 'object') throw new Error('Hindsight malformed response');
        if (payload.usage && typeof payload.usage === 'object') this.metrics.observeUsage(payload.usage);
        this.metrics.increment('successes');
        this.metrics.observeLatency(Date.now() - started);
        return payload;
      } catch (error) {
        lastError = error;
        const isTimeout = error?.name === 'AbortError';
        if (isTimeout) this.metrics.increment('timeouts');
        if (attempt < this.attempts && (isTimeout || !error?.status || error.status === 429 || error.status >= 500)) {
          this.metrics.increment('retries');
          const delay = Math.min(250, 30 * (2 ** (attempt - 1))) * (0.5 + this.random());
          await this.sleep(delay);
          continue;
        }
        this.metrics.increment('failures');
        this.metrics.observeLatency(Date.now() - started);
        throw new Error('Hindsight request failed');
      } finally {
        clearTimeout(timer);
      }
    }
    this.metrics.increment('failures');
    throw new Error(lastError ? 'Hindsight request failed' : 'Hindsight request unavailable');
  }

  async recall(request) {
    const scope = this.assertAllowed(request?.scope);
    if (!request?.query?.trim()) throw new Error('query is required');
    const payload = await this.request(scope, 'recall', {
      query: request.query,
      max_tokens: Math.min(2000, Math.max(1, request.maxTokens ?? 1200)),
      types: request.evidenceFilters?.types,
    });
    const rows = Array.isArray(payload.results) ? payload.results : [];
    const [, owner, repo] = scope.split('/');
    const normalized = rows.slice(0, Math.min(20, request.limit ?? 8)).map((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const metadataRepo = metadata.repo;
      if (metadataRepo && metadataRepo !== `${owner}/${repo}`) return null;
      const text = typeof row.text === 'string' ? row.text : '';
      if (!text.trim()) return null;
      return {
        id: row.id,
        text,
        score: row.score ?? row.relevanceScore ?? null,
        occurredStart: row.occurredStart ?? row.occurred_start ?? null,
        occurredEnd: row.occurredEnd ?? row.occurred_end ?? null,
        mentionedAt: row.mentionedAt ?? row.mentioned_at ?? null,
        entities: row.entities,
        conflicts: row.conflicts,
        stale: row.state === 'invalidated' || row.stale === true,
        provenance: {
          repo: `${owner}/${repo}`,
          ref: metadata.commit ?? null,
          path: metadata.path ?? null,
          section: row.context ?? metadata.section ?? null,
          provider: 'hindsight',
          retrievalMethod: 'hindsight-hybrid',
          itemId: row.id ?? null,
          documentId: row.documentId ?? row.document_id ?? metadata.document_id ?? null,
          timestamp: row.mentionedAt ?? row.mentioned_at ?? null,
          originalEvidenceRef: metadata.source_url ?? metadata.source_id ?? row.documentId ?? null,
          metadata,
        },
      };
    }).filter(Boolean);
    this.metrics.increment('recalls');
    this.metrics.increment('recallResults', normalized.length);
    if (normalized.length === 0) this.metrics.increment('noResults');
    return this.normalizeRecall(normalized, { ...request, scope });
  }

  async ingest({ scope, events = [] }) {
    const allowedScope = this.assertAllowed(scope);
    if (!Array.isArray(events) || events.length > 20) throw new Error('event batch unavailable');
    const [, owner, repo] = allowedScope.split('/');
    const unique = new Map();
    let duplicates = 0;
    for (const event of events) {
      if (!event?.eventId || !event?.observedAt || !event?.provenance?.path || !event?.provenance?.ref) throw new Error('event provenance unavailable');
      if (event.provenance.repo !== `${owner}/${repo}`) throw new Error('event provenance scope mismatch');
      assertSafeText(event.content);
      if (unique.has(event.eventId)) { duplicates += 1; continue; }
      unique.set(event.eventId, event);
    }
    const prepared = [...unique.values()].map((event) => {
      const documentId = crypto.createHash('sha256').update(String(event.eventId)).digest('hex').slice(0, 40);
      const metadata = {
        repo: `${owner}/${repo}`,
        commit: event.provenance.ref,
        path: event.provenance.path,
        section: event.provenance.section ?? '',
        source_id: event.eventId,
        source_url: `https://github.com/${owner}/${repo}/blob/${event.provenance.ref}/${event.provenance.path}`,
      };
      return { documentId, item: { content: event.content, context: `${event.provenance.path}#${event.provenance.section ?? ''}`, timestamp: event.observedAt, document_id: documentId, metadata } };
    });
    let sourceResults = [];
    if (prepared.length) {
      try {
        const response = await this.request(allowedScope, 'retain', { items: prepared.map((entry) => entry.item) });
        const itemResults = Array.isArray(response.items) ? response.items : Array.isArray(response.results) ? response.results : null;
        sourceResults = prepared.map((entry, index) => {
          const item = itemResults?.find((result) => result.document_id === entry.documentId || result.documentId === entry.documentId) ?? itemResults?.[index];
          const accepted = response.success !== false && item?.success !== false && item?.status !== 'rejected' && item?.status !== 'failed';
          return { status: accepted ? 'ingested' : 'rejected', documentId: accepted ? entry.documentId : null };
        });
      } catch {
        sourceResults = prepared.map(() => ({ status: 'rejected', documentId: null }));
      }
    }
    const ingested = sourceResults.filter((result) => result.status === 'ingested').length;
    const rejected = sourceResults.length - ingested;
    this.metrics.increment('ingestedItems', ingested);
    this.metrics.increment('rejectedItems', rejected);
    this.metrics.increment('duplicateItems', duplicates);
    return { ingested, rejected, duplicates, sourceResults };
  }

  async derive({ scope, events = [] }) {
    const allowedScope = this.assertAllowed(scope);
    if (!Array.isArray(events) || events.length > 20) throw new Error('event batch unavailable');
    const candidates = [];
    for (const event of events) {
      const ingestion = await this.ingest({ scope: allowedScope, events: [event] });
      if (!ingestion.ingested) continue;
      const [, owner, repo] = allowedScope.split('/');
      const docId = ingestion.sourceResults.find((result) => result.status === 'ingested')?.documentId;
      const recalled = await this.recall({ scope: allowedScope, query: event.content, limit: 5, maxTokens: 1000 });
      for (const item of recalled) {
        const claimId = `${item.id}:${docId}`;
        candidates.push({
          schema_version: 2,
          candidate_id: `cog-${crypto.createHash('sha256').update(claimId).digest('hex').slice(0, 24)}`,
          scope: allowedScope,
          claim: item.text,
          observed_at: event.observedAt,
          valid_until: null,
          confidence: null,
          confidence_basis: 'Hindsight recall score is not a calibrated confidence; manual source verification required.',
          evidence: [{
            source_type: 'git',
            locator: `https://github.com/${owner}/${repo}/blob/${event.provenance.ref}/${event.provenance.path}`,
            observed_at: event.observedAt,
          }],
          provenance: {
            repo: `${owner}/${repo}`,
            ref: event.provenance.ref,
            path: event.provenance.path,
            section: event.provenance.section ?? item.provenance.section,
            timestamp: item.provenance.timestamp,
            original_evidence_ref: item.provenance.originalEvidenceRef,
          },
          provider: 'hindsight',
          derived_from: [event.eventId, item.id].filter(Boolean),
          contradiction_status: 'not_checked',
          contradicts: [],
          freshness: { last_verified_at: null, status: 'not_verified' },
          promotion_status: 'ready_for_review',
          canonical_write: false,
        });
      }
    }
    return candidates;
  }

  async explain({ scope, itemId }) {
    const requestedScope = this.assertAllowed(scope);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/default/banks/${encodeURIComponent(scopeToBankId(requestedScope))}/memories/${encodeURIComponent(itemId)}`, {
      method: 'GET', headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
    });
    if (!response.ok) throw new Error('Hindsight provenance unavailable');
    const item = await response.json();
    return {
      itemId,
      scope: requestedScope,
      provider: 'hindsight',
      derived: true,
      evidence: item.metadata ?? {},
      temporal: { occurredStart: item.occurredStart ?? null, occurredEnd: item.occurredEnd ?? null, mentionedAt: item.mentionedAt ?? null },
      conflicts: Array.isArray(item.conflicts) ? item.conflicts : [],
      stale: item.state === 'invalidated',
    };
  }
}

class Metrics {
  constructor() { this.values = Object.create(null); this.latencies = []; this.usageMeasured = false; }
  increment(key, amount = 1) { this.values[key] = (this.values[key] ?? 0) + amount; }
  observeLatency(ms) { this.latencies.push(ms); }
  observeUsage(usage) {
    this.usageMeasured = true;
    for (const [metric, keys] of Object.entries({ inputTokens: ['input_tokens', 'inputTokens'], outputTokens: ['output_tokens', 'outputTokens'], llmCalls: ['llm_calls', 'llmCalls'] })) {
      const key = keys.find((candidate) => Number.isFinite(usage[candidate]));
      if (key) this.increment(metric, usage[key]);
    }
    const cost = usage.cost_usd ?? usage.costUsd;
    if (Number.isFinite(cost)) this.increment('costMicroUsd', Math.round(cost * 1_000_000));
  }
  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const percentile = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
    return {
      ...this.values,
      inputTokens: this.usageMeasured ? this.values.inputTokens ?? 0 : null,
      outputTokens: this.usageMeasured ? this.values.outputTokens ?? 0 : null,
      llmCalls: this.usageMeasured ? this.values.llmCalls ?? 0 : null,
      estimatedCostUsd: this.usageMeasured ? (this.values.costMicroUsd ?? 0) / 1_000_000 : null,
      latencyP50Ms: percentile(0.5),
      latencyP95Ms: percentile(0.95),
    };
  }
}

function parseFeatureFlags(env = process.env) {
  const on = (value) => String(value).toLowerCase() === 'true';
  return {
    cognitionEnabled: on(env.COGNITION_ENABLED),
    hindsightShadowEnabled: on(env.HINDSIGHT_SHADOW_ENABLED),
    hindsightServingEnabled: false,
    ragflowShadowEnabled: on(env.RAGFLOW_SHADOW_ENABLED),
    ragflowServingEnabled: false,
    servingAllowed: false,
  };
}

function safeEvalSummary(baseline, shadow) {
  const baselineIds = new Set(baseline.map((item) => item.id));
  const shadowIds = new Set(shadow.map((item) => item.id));
  return {
    baselineCount: baseline.length,
    shadowCount: shadow.length,
    overlapCount: [...baselineIds].filter((id) => shadowIds.has(id)).length,
    shadowOnlyCount: [...shadowIds].filter((id) => !baselineIds.has(id)).length,
    baselineOnlyCount: [...baselineIds].filter((id) => !shadowIds.has(id)).length,
    scopes: [...new Set([...baseline, ...shadow].map((item) => item.scope).filter(Boolean))],
    shadowServed: false,
  };
}

function createProvider({ flags = parseFeatureFlags(), baseline, hindsight, ragflow, evaluate = () => {}, retry = {} }) {
  if (!baseline || typeof baseline.recall !== 'function') throw new Error('baseline provider is required');
  const metrics = new Metrics();
  const states = new Map();

  const shadowState = (name) => {
    if (!states.has(name)) states.set(name, { failures: 0, circuitOpenUntil: 0 });
    return states.get(name);
  };

  async function runShadow(name, provider, enabled, request, baselineItems) {
    if (!enabled || !provider || typeof provider.recall !== 'function') return;
    const state = shadowState(name);
    if (Date.now() < state.circuitOpenUntil) {
      metrics.increment('circuitOpen');
      evaluate({
        shadowProvider: name,
        metrics: { circuitOpen: true },
        baseline: baselineItems,
        shadow: [],
        shadowServed: false,
      });
      return;
    }
    try {
      const shadowItems = await provider.recall(request);
      state.failures = 0;
      const summary = safeEvalSummary(baselineItems, shadowItems);
      evaluate({
        shadowProvider: name,
        metrics: summary,
        baseline: baselineItems,
        shadow: shadowItems,
        shadowServed: false,
      });
    } catch {
      state.failures += 1;
      if (state.failures >= 3) state.circuitOpenUntil = Date.now() + 30000;
      metrics.increment('failures');
      evaluate({
        shadowProvider: name,
        metrics: { failure: true, circuitOpen: state.circuitOpenUntil > Date.now() },
        baseline: baselineItems,
        shadow: [],
        shadowServed: false,
      });
    }
  }

  return {
    metrics,
    async recall(request) {
      const baselineItems = await baseline.recall(request);
      if (!flags.cognitionEnabled) return baselineItems;
      await runShadow('hindsight', hindsight, flags.hindsightShadowEnabled, request, baselineItems);
      await runShadow('ragflow', ragflow, flags.ragflowShadowEnabled, request, baselineItems);
      return baselineItems;
    },
    async derive(request) {
      if (!flags.cognitionEnabled || !flags.hindsightShadowEnabled || !hindsight || typeof hindsight.derive !== 'function') return [];
      return hindsight.derive(request);
    },
    async explain(request) {
      if (!flags.cognitionEnabled) return null;
      if (typeof baseline.explain === 'function') return baseline.explain(request);
      if (typeof hindsight?.explain === 'function') return hindsight.explain(request);
      return null;
    },
  };
}

function createMcpHandlers(provider) {
  if (!provider || typeof provider.recall !== 'function') throw new Error('provider contract is required');
  return Object.freeze({
    async memory_recall(args) {
      if (!args || typeof args.scope !== 'string' || typeof args.query !== 'string' || !args.query.trim()) throw new Error('invalid recall request');
      try { return await provider.recall({ ...args, limit: Math.min(20, Math.max(1, Number(args.limit) || 8)) }); }
      catch { throw new Error('memory recall unavailable'); }
    },
    async memory_derive(args) {
      if (!args || typeof args.scope !== 'string' || !Array.isArray(args.events)) throw new Error('invalid derive request');
      if (typeof provider.derive !== 'function') return [];
      try {
        const candidates = await provider.derive(args);
        if (!Array.isArray(candidates) || candidates.some((candidate) => candidate?.canonical_write !== false)) throw new Error('candidate write invariant failed');
        return candidates;
      } catch { throw new Error('memory derivation unavailable'); }
    },
    async memory_explain(args) {
      if (!args || typeof args.scope !== 'string' || typeof args.itemId !== 'string' || !args.itemId) throw new Error('invalid explain request');
      if (typeof provider.explain !== 'function') return null;
      try { return await provider.explain(args); }
      catch { throw new Error('memory provenance unavailable'); }
    },
  });
}

module.exports = { MemoryCognitionProvider, EngramAdapter, RAGFlowAdapter, HindsightAdapter, Metrics, createProvider, createMcpHandlers, MCP_TOOL_DEFINITIONS, parseFeatureFlags, canonicalProjectScope, scopeToBankId };
