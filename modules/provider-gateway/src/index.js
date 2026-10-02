const REQUEST_FIELDS = new Set(['policy_profile', 'task_class', 'input', 'budget']);

function assertRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function assertOnlyFields(value, allowed) {
  assertRecord(value, 'REQUEST_INVALID');
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('REQUEST_FIELD_INVALID');
}

function assertText(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
}

function normalizeRequest(request) {
  assertOnlyFields(request, REQUEST_FIELDS);
  assertText(request.policy_profile, 'POLICY_PROFILE_REQUIRED');
  assertText(request.task_class, 'TASK_CLASS_REQUIRED');
  if (!Array.isArray(request.input) || request.input.length === 0) throw new Error('INFERENCE_INPUT_REQUIRED');
  const input = request.input.map((message) => {
    assertOnlyFields(message, new Set(['role', 'content']));
    if (!['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('INFERENCE_INPUT_INVALID');
    return { role: message.role, content: message.content };
  });
  assertOnlyFields(request.budget, new Set(['max_output_tokens', 'max_cost_usd']));
  if (!Number.isInteger(request.budget.max_output_tokens) || request.budget.max_output_tokens < 1) throw new Error('BUDGET_INVALID');
  if (request.budget.max_cost_usd !== undefined && (typeof request.budget.max_cost_usd !== 'number' || request.budget.max_cost_usd < 0)) {
    throw new Error('BUDGET_INVALID');
  }
  return {
    policy_profile: request.policy_profile,
    task_class: request.task_class,
    input,
    budget: { ...request.budget },
  };
}

function normalizeResult(routeId, result, maxOutputTokens) {
  assertRecord(result, 'PROVIDER_RESULT_INVALID');
  if (!Array.isArray(result.output) || result.output.length === 0) throw new Error('PROVIDER_RESULT_INVALID');
  const output = result.output.map((message) => {
    assertOnlyFields(message, new Set(['role', 'content']));
    if (!['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('PROVIDER_RESULT_INVALID');
    return { role: message.role, content: message.content };
  });
  const usage = result.usage;
  assertRecord(usage, 'PROVIDER_USAGE_INVALID');
  if (!Number.isInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isInteger(usage.output_tokens) || usage.output_tokens < 0) {
    throw new Error('PROVIDER_USAGE_INVALID');
  }
  if (usage.output_tokens > maxOutputTokens) throw new Error('PROVIDER_RESULT_OVER_BUDGET');
  const normalized = { output, route_id: routeId, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } };
  if (typeof result.finish_reason === 'string' && result.finish_reason) normalized.finish_reason = result.finish_reason;
  return normalized;
}

function createProviderGateway({ resolveRoute, adapters } = {}) {
  if (typeof resolveRoute !== 'function') throw new Error('PROVIDER_POLICY_REQUIRED');
  if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) throw new Error('PROVIDER_ADAPTERS_REQUIRED');

  return Object.freeze({
    async infer(input) {
      const request = normalizeRequest(input);
      const route = await resolveRoute({
        policy_profile: request.policy_profile,
        task_class: request.task_class,
        budget: { ...request.budget },
      });
      assertRecord(route, 'PROVIDER_ROUTE_UNAVAILABLE');
      assertText(route.route_id, 'PROVIDER_ROUTE_UNAVAILABLE');
      assertText(route.adapter_id, 'PROVIDER_ROUTE_UNAVAILABLE');
      if (!Number.isInteger(route.max_output_tokens) || route.max_output_tokens < 1) throw new Error('PROVIDER_ROUTE_UNAVAILABLE');
      if (typeof route.max_cost_usd !== 'number' || !Number.isFinite(route.max_cost_usd) || route.max_cost_usd < 0) {
        throw new Error('PROVIDER_BUDGET_POLICY_UNAVAILABLE');
      }
      const adapter = adapters[route.adapter_id];
      if (!adapter || typeof adapter.infer !== 'function') throw new Error('PROVIDER_ADAPTER_UNAVAILABLE');
      const maxOutputTokens = Math.min(request.budget.max_output_tokens, route.max_output_tokens);
      const maxCostUsd = request.budget.max_cost_usd === undefined
        ? route.max_cost_usd
        : Math.min(request.budget.max_cost_usd, route.max_cost_usd);
      const result = await adapter.infer({
        input: request.input,
        budget: { max_output_tokens: maxOutputTokens, max_cost_usd: maxCostUsd },
      });
      return normalizeResult(route.route_id, result, maxOutputTokens);
    },
  });
}

module.exports = { createProviderGateway };
