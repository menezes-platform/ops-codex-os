const { createPersonalRecall } = require('./personal-recall');
const { enforceRecall } = require('./recall-enforcer');
const { validateRecallEvidence } = require('./recall-evidence');
const { sanitizeEvidenceForModel } = require('./evidence-sanitizer');
const { normalizeRecallStatus } = require('./recall-status');
const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FILTER_FIELDS = new Set(['source_types', 'revision', 'after', 'before']);

function assertRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function assertOnlyFields(value, allowed, code = 'REQUEST_FIELD_INVALID') {
  assertRecord(value, code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(code);
}

function assertProjectScope(value) {
  if (typeof value !== 'string' || !PROJECT_SCOPE.test(value)) throw new Error('INVALID_PROJECT_SCOPE');
  return value;
}

function normalizeQuery(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('QUERY_REQUIRED');
  return value;
}

function normalizeFilters(value = {}) {
  assertOnlyFields(value, FILTER_FIELDS);
  if (value.source_types !== undefined && (!Array.isArray(value.source_types) || value.source_types.some((item) => typeof item !== 'string' || !item.trim()))) {
    throw new Error('FILTERS_INVALID');
  }
  for (const field of ['revision', 'after', 'before']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim())) throw new Error('FILTERS_INVALID');
  }
  return { ...value };
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
}

function createContextGateway({ executionPlaneClient, personalRetrievalClient = null, projectCorpusReader = null, resolveProjectScope, allowlistedMultiProjectScopes = [], resolvePersonalOwner = null } = {}) {
  // Project read/reindex and authenticated personal retrieval are distinct lanes.
  // A read-only or personal-only host must not need an unrelated project writer.
  const projectConfigured = typeof resolveProjectScope === 'function';
  const personalConfigured = typeof resolvePersonalOwner === 'function';
  const projectReaderAvailable = executionPlaneClient && typeof executionPlaneClient.retrieve === 'function';
  if (projectConfigured && !projectReaderAvailable) throw new Error('EXECUTION_PLANE_CLIENT_REQUIRED');
  if (resolveProjectScope != null && !projectConfigured) throw new Error('PROJECT_SCOPE_RESOLVER_REQUIRED');
  if (!projectConfigured && !personalConfigured) throw new Error('PROJECT_SCOPE_RESOLVER_REQUIRED');
  // A personal provider is supplied by the trusted host, never selected by the model.
  // Keep the existing injected-client fallback for compatibility, but do not fall
  // back to project memory when a dedicated personal adapter was explicitly supplied.
  if (personalConfigured && (personalRetrievalClient != null
    ? typeof personalRetrievalClient.retrieve !== 'function' : !projectReaderAvailable)) {
    throw new Error('PERSONAL_RETRIEVAL_CLIENT_REQUIRED');
  }
  if (!Array.isArray(allowlistedMultiProjectScopes)) throw new Error('MULTI_PROJECT_ALLOWLIST_INVALID');

  const configuredScopes = new Set(allowlistedMultiProjectScopes.map(assertProjectScope));
  if (configuredScopes.size !== allowlistedMultiProjectScopes.length) throw new Error('MULTI_PROJECT_ALLOWLIST_INVALID');

  async function currentScope() {
    if (!projectConfigured) throw new Error('PROJECT_SCOPE_RESOLVER_REQUIRED');
    return assertProjectScope(await resolveProjectScope());
  }

  const personalRecall = personalConfigured
    ? createPersonalRecall({ executionPlaneClient: personalRetrievalClient ?? executionPlaneClient, ownerResolver: resolvePersonalOwner }) : null;
  return Object.freeze({
    async answerWithContext({ userIntent, historyReferences = false, answerProducer } = {}) {
      // Purely personal recall must not depend on an active Git checkout.
      // An unrelated scope must never be guessed to satisfy a history query.
      const scope = userIntent?.domain !== 'personal' && projectConfigured ? await currentScope() : null;
      const availableScopes = scope ? [scope] : [];
      if (personalRecall) availableScopes.push('personal/current');
      return enforceRecall({
        intent: { userIntent, historyReferences, availableScopes },
        gateway: {
          recall: scope ? async ({ query }) => {
            const raw = await executionPlaneClient.retrieve({ scope, query, filters: { source_types: ['git'] } });
            if (!raw || raw.status !== 'ok') return raw;
            if (!Array.isArray(raw.evidence) || raw.evidence.some(hit =>
              !hit || hit.source !== 'git' || (hit.authority !== undefined && hit.authority !== 'git'))) {
              throw new Error('PROJECT_SOURCE_AUTHORITY_DENIED');
            }
            return { ...raw, evidence: validateRecallEvidence({
              hits: raw.evidence,
              manifest: { scope, revision: raw.revision, generation_id: raw.generation_id },
              sourceAuthority: 'git',
            }) };
          } : null,
          recallPersonal: personalRecall ? ({ query }) => personalRecall.recall({ query }) : null,
        },
        answerProducer,
      });
    },
    // Derived project indexes are candidates, never Git authority. Explicit host
    // adapter and separate method: the canonical answerWithContext route stays Git-only.
    async answerWithProjectCorpus({userIntent,answerProducer}={}) {
      if (!projectCorpusReader || typeof projectCorpusReader.retrieve !== 'function')
        throw new Error('PROJECT_CORPUS_ADAPTER_REQUIRED');
      if (typeof answerProducer !== 'function') throw new Error('ANSWER_PRODUCER_REQUIRED');
      if (!userIntent || typeof userIntent !== 'object' || userIntent.domain !== 'project')
        throw new Error('PROJECT_CORPUS_SCOPE_DENIED');
      const query=normalizeQuery(userIntent.text);
      if (Buffer.byteLength(query,'utf8')>4096) throw new Error('QUERY_LIMIT_EXCEEDED');
      const scope=await currentScope();
      if (userIntent.projectScope !== undefined && userIntent.projectScope !== scope)
        throw new Error('PROJECT_CORPUS_SCOPE_DENIED');
      let raw, verified;
      try {
        raw=await projectCorpusReader.retrieve({scope,query,filters:{source_types:['project-derived']}});
        const normalized=normalizeRecallStatus({primary:raw,policy:{allowEngram:false}});
        if(normalized.status!=='ok')
          return {answer:null,receipt:Object.freeze({required:true,status:normalized.status,
            reason_code:normalized.reason_code})};
        const hits=normalized.evidence;
        if (!hits.length || hits.length>100 ||
            new Set(hits.map(hit=>hit.evidence_id)).size!==hits.length ||
            hits.some(hit=>hit.scope!==scope || typeof hit.source_ref!=='string' ||
              !hit.source_ref.startsWith('https://') || hit.source==='git' || hit.authority==='git'))
          throw new Error('PROJECT_CORPUS_EVIDENCE_INVALID');
        verified=validateRecallEvidence({hits,
          manifest:{scope,revision:raw.revision,generation_id:raw.generation_id},
          sourceAuthority:'project-derived'});
      } catch {
        return {answer:null,receipt:Object.freeze({required:true,status:'unavailable',
          reason_code:'PROJECT_CORPUS_UNVERIFIED'})};
      }
      const safe=sanitizeEvidenceForModel(verified);
      if (safe.evidence.every(hit=>hit.suspicious))
        return {answer:null,receipt:Object.freeze({required:true,status:'denied',
          reason_code:'DERIVED_EVIDENCE_UNTRUSTED'})};
      const promptBoundary=safe.promptBoundary+
        ' Project-derived evidence is NOT authoritative. Cite the original source and verify current Git/project truth before asserting operational facts.';
      const answer=await answerProducer({evidence:safe.evidence,
        promptBoundary,memoryStatus:'candidate'});
      return {answer,receipt:Object.freeze({required:true,status:'candidate',
        reason_code:'DERIVED_CONTEXT_CANDIDATE',generation_id:raw.generation_id,
        evidence_count:verified.length})};
    },
    async recallPersonal(request) {
      if (!personalRecall) throw new Error('PERSONAL_RECALL_DISABLED');
      return personalRecall.recall(request);
    },
    async recall(request) {
      assertOnlyFields(request, new Set(['query', 'filters']));
      const query = normalizeQuery(request.query);
      const filters = normalizeFilters(request.filters);
      const scope = await currentScope();
      return executionPlaneClient.retrieve({ scope, query, filters });
    },

    async recallAcrossProjects(request) {
      if (!projectReaderAvailable) throw new Error('EXECUTION_PLANE_CLIENT_REQUIRED');
      assertOnlyFields(request, new Set(['query', 'filters', 'allowlisted_scopes']));
      const query = normalizeQuery(request.query);
      const filters = normalizeFilters(request.filters);
      const scopes = request.allowlisted_scopes;
      if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 20) throw new Error('ALLOWLIST_REQUIRED');
      const checkedScopes = scopes.map(assertProjectScope);
      if (new Set(checkedScopes).size !== checkedScopes.length) throw new Error('ALLOWLIST_DUPLICATE_SCOPE');
      if (checkedScopes.some((scope) => !configuredScopes.has(scope))) throw new Error('PROJECT_SCOPE_NOT_ALLOWLISTED');
      return executionPlaneClient.retrieve({ allowlisted_scopes: checkedScopes, query, filters });
    },

    async requestReindex(request) {
      assertOnlyFields(request, new Set(['revision', 'idempotency_key']));
      if (typeof request.revision !== 'string' || !request.revision.trim()) throw new Error('REVISION_REQUIRED');
      assertIdempotencyKey(request.idempotency_key);
      const scope = await currentScope();
      if (typeof executionPlaneClient.indexProject !== 'function') throw new Error('PROJECT_INDEX_WRITER_REQUIRED');
      return executionPlaneClient.indexProject({ scope, revision: request.revision, idempotency_key: request.idempotency_key });
    },
  });
}

module.exports = { createContextGateway, assertProjectScope };
