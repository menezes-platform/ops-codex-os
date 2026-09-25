const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';

function safeQuestionId(nodeId) {
  return 'candidate__' + String(nodeId).replace(/[^a-zA-Z0-9_]/g, '_');
}

function redactCandidate(candidate) {
  return {
    id: candidate.id,
    platform: candidate.platform,
    capabilities: [...candidate.capabilities],
    affinities: [...candidate.affinities],
    freeDiskBytes: candidate.freeDiskBytes,
    totalDiskBytes: candidate.totalDiskBytes,
    freeMemoryBytes: candidate.freeMemoryBytes,
    totalMemoryBytes: candidate.totalMemoryBytes,
    cpuPercent: candidate.cpuPercent,
    activeJobs: candidate.activeJobs,
    cachedArtifactCount: candidate.cachedArtifactCount,
  };
}

function collectSecretValues(env = {}, apiKey = '', extras = []) {
  const values = [
    apiKey,
    env.GOOGLE_DRIVE_CLIENT_SECRET,
    env.GOOGLE_DRIVE_REFRESH_TOKEN,
    env.PERSISTFLOW_FLEET_NODE_SECRET,
    ...extras,
  ];
  try {
    const parsed = JSON.parse(String(env.PERSISTFLOW_FLEET_NODE_SECRETS_JSON || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      values.push(...Object.values(parsed));
    }
  } catch {}
  return [...new Set(values
    .filter((value) => typeof value === 'string' && value.length >= 6)
    .map(String))];
}

function redactText(value, secrets = []) {
  let output = String(value ?? '');
  for (const secret of secrets) {
    output = output.split(secret).join('[REDACTED]');
  }
  output = output
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [REDACTED]');
  return output;
}

function boundedTask(intent, redactValues = []) {
  return {
    taskId: redactText(intent.taskId, redactValues),
    summary: redactText(String(intent.summary || '').slice(0, 2000), redactValues),
    repo: intent.repo ? redactText(intent.repo, redactValues) : null,
    ref: intent.ref ? redactText(intent.ref, redactValues) : null,
    requiredCapabilities: [...(intent.requiredCapabilities || [])],
    preferredCapabilities: [...(intent.preferredCapabilities || [])],
    estimatedScratchBytes: Number(intent.estimatedScratchBytes || 0),
    artifactRefs: [...(intent.artifactRefs || [])].slice(0, 256),
    requiresInteractiveUi: intent.requiresInteractiveUi === true,
    requiresGpu: intent.requiresGpu === true,
    parallelSafe: intent.parallelSafe === true,
  };
}

class TypeSafeFleetRouter {
  constructor({
    apiKey = process.env.TYPESAFE_API_KEY,
    endpoint = process.env.TYPESAFE_ENDPOINT || DEFAULT_ENDPOINT,
    model = process.env.TYPESAFE_MODEL || DEFAULT_MODEL,
    fetchImpl = globalThis.fetch,
    env = process.env,
    redactValues = [],
  } = {}) {
    const resolvedApiKey = String(apiKey || '').trim();
    Object.defineProperties(this, {
      apiKey: { value: resolvedApiKey, enumerable: false },
      fetchImpl: { value: fetchImpl, enumerable: false },
      redactValues: {
        value: collectSecretValues(env, resolvedApiKey, redactValues),
        enumerable: false,
      },
    });
    this.endpoint = String(endpoint);
    this.model = String(model);
  }

  async score({ intent, candidates }) {
    if (!this.apiKey) throw new Error('typesafe_api_key_missing');
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('typesafe_candidates_required');

    const questions = {};
    const keyToNode = new Map();
    for (const candidate of candidates) {
      const key = safeQuestionId(candidate.id);
      if (keyToNode.has(key)) throw new Error('typesafe_question_id_collision');
      keyToNode.set(key, candidate.id);
      questions[key] = {
        type: 'score',
        instructions: 'How suitable is this already-eligible node for the task, considering task semantics, resource headroom, artifact locality, interaction needs, and coordination cost?',
        criteria: [
          'Eligible but poor fit; another eligible node is materially better.',
          'Acceptable fit with no material blocker.',
          'Strong fit for this task.',
        ],
      };
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        state: {
          task: boundedTask(intent, this.redactValues),
          candidates: candidates.map(redactCandidate),
        },
        model: this.model,
        questions,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('typesafe_http_' + response.status);
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !payload.answers) throw new Error('typesafe_invalid_response');

    const scores = {};
    for (const [key, nodeId] of keyToNode.entries()) {
      const answer = payload.answers[key];
      if (!answer || answer.type !== 'score'
        || typeof answer.score !== 'number'
        || !Number.isFinite(answer.score)
        || answer.score < 0 || answer.score > 2) {
        throw new Error('typesafe_invalid_answer:' + key);
      }
      scores[nodeId] = answer.score;
    }
    return scores;
  }
}

module.exports = {
  TypeSafeFleetRouter,
  safeQuestionId,
  redactCandidate,
  boundedTask,
  collectSecretValues,
  redactText,
};
