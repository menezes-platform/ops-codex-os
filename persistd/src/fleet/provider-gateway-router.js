const POLICY_PROFILE = 'fleet-routing-v1';
const TASK_CLASS = 'fleet.node-ranking';
const MAX_CANDIDATES = 64;
const TOKENS_PER_CANDIDATE = 32;

const SYSTEM_PROMPT = [
  'Rank only the eligible candidates supplied in the user message for the stated task.',
  'Return exactly one JSON object with this shape: {"scores":{"candidate_1":0}}.',
  'Include every supplied candidate key exactly once and no other keys.',
  'Each score must be a number from 0 to 2; a higher score means a better fit.',
  'Do not include markdown, explanations, prose, or invented candidates.',
].join(' ');

function collectSecretValues(env = {}, extras = []) {
  const values = [
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
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
  return output
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [REDACTED]');
}

function boundedTask(intent, redactValues = []) {
  return {
    taskId: redactText(intent.taskId, redactValues),
    summary: redactText(String(intent.summary || '').slice(0, 2000), redactValues),
    repo: intent.repo ? redactText(intent.repo, redactValues) : null,
    ref: intent.ref ? redactText(intent.ref, redactValues) : null,
    requiredCapabilities: [...(intent.requiredCapabilities || [])]
      .slice(0, 128)
      .map((value) => redactText(value, redactValues)),
    preferredCapabilities: [...(intent.preferredCapabilities || [])]
      .slice(0, 128)
      .map((value) => redactText(value, redactValues)),
    estimatedScratchBytes: Number(intent.estimatedScratchBytes || 0),
    artifactRefs: [...(intent.artifactRefs || [])]
      .slice(0, 256)
      .map((ref) => redactText(ref, redactValues)),
    requiresInteractiveUi: intent.requiresInteractiveUi === true,
    requiresGpu: intent.requiresGpu === true,
    parallelSafe: intent.parallelSafe === true,
  };
}

function boundedCandidate(candidate, candidateKey, redactValues = []) {
  return {
    candidate_key: candidateKey,
    platform: redactText(candidate.platform, redactValues),
    capabilities: [...(candidate.capabilities || [])]
      .slice(0, 128)
      .map((value) => redactText(value, redactValues)),
    affinities: [...(candidate.affinities || [])]
      .slice(0, 128)
      .map((value) => redactText(value, redactValues)),
    freeDiskBytes: candidate.freeDiskBytes,
    totalDiskBytes: candidate.totalDiskBytes,
    freeMemoryBytes: candidate.freeMemoryBytes,
    totalMemoryBytes: candidate.totalMemoryBytes,
    cpuPercent: candidate.cpuPercent,
    activeJobs: candidate.activeJobs,
    cachedArtifactCount: candidate.cachedArtifactCount,
  };
}

function normalizeGatewayResponse(response, keyToNode) {
  if (!response || !Array.isArray(response.output) || response.output.length !== 1
    || response.output[0]?.role !== 'assistant'
    || typeof response.output[0]?.content !== 'string'
    || typeof response.route_id !== 'string'
    || !/^[A-Za-z0-9._:/-]{1,128}$/.test(response.route_id.trim())) {
    throw new Error('PROVIDER_GATEWAY_INVALID_RESPONSE');
  }
  const usage = response.usage;
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0
    || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) {
    throw new Error('PROVIDER_GATEWAY_INVALID_USAGE');
  }

  let payload;
  try {
    payload = JSON.parse(response.output[0].content);
  } catch {
    throw new Error('PROVIDER_GATEWAY_INVALID_RESPONSE');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== 1 || !payload.scores
    || typeof payload.scores !== 'object' || Array.isArray(payload.scores)) {
    throw new Error('PROVIDER_GATEWAY_INVALID_RESPONSE');
  }

  const scoreKeys = Object.keys(payload.scores);
  if (scoreKeys.length !== keyToNode.size || scoreKeys.some((key) => !keyToNode.has(key))) {
    throw new Error('PROVIDER_GATEWAY_INVALID_SCORES');
  }
  const scores = {};
  for (const [key, nodeId] of keyToNode) {
    const value = payload.scores[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
      throw new Error('PROVIDER_GATEWAY_INVALID_SCORES');
    }
    scores[nodeId] = value;
  }
  return {
    scores,
    routeId: response.route_id.trim(),
    usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
  };
}

class ProviderGatewayFleetRouter {
  constructor({ providerGateway, env = process.env, redactValues = [] } = {}) {
    if (!providerGateway || typeof providerGateway.infer !== 'function') {
      throw new Error('PROVIDER_GATEWAY_REQUIRED');
    }
    Object.defineProperties(this, {
      providerGateway: { value: providerGateway, enumerable: false },
      redactValues: {
        value: collectSecretValues(env, redactValues),
        enumerable: false,
      },
    });
  }

  async score({ intent, candidates }) {
    if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > MAX_CANDIDATES) {
      throw new Error('PROVIDER_GATEWAY_CANDIDATES_INVALID');
    }

    const keyToNode = new Map();
    const boundedCandidates = candidates.map((candidate, index) => {
      const key = `candidate_${index + 1}`;
      keyToNode.set(key, candidate.id);
      return boundedCandidate(candidate, key, this.redactValues);
    });
    let response;
    try {
      response = await this.providerGateway.infer({
        policy_profile: POLICY_PROFILE,
        task_class: TASK_CLASS,
        freshness_required: true,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              task: boundedTask(intent, this.redactValues),
              candidates: boundedCandidates,
            }),
          },
        ],
        budget: { max_output_tokens: candidates.length * TOKENS_PER_CANDIDATE },
      });
    } catch (error) {
      const code = typeof error?.message === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.message)
        ? error.message : 'PROVIDER_GATEWAY_REQUEST_FAILED';
      throw new Error(code);
    }
    return normalizeGatewayResponse(response, keyToNode);
  }
}

module.exports = {
  ProviderGatewayFleetRouter,
  POLICY_PROFILE,
  TASK_CLASS,
  MAX_CANDIDATES,
  collectSecretValues,
  redactText,
  boundedTask,
  boundedCandidate,
  normalizeGatewayResponse,
};
