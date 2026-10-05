const { createHash } = require('node:crypto');

const REQUEST_FIELDS = new Set(['policy_profile', 'task_class', 'input', 'budget', 'freshness_required']);

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
  if (!Number.isSafeInteger(request.budget.max_output_tokens) || request.budget.max_output_tokens < 1) throw new Error('BUDGET_INVALID');
  if (request.budget.max_cost_usd !== undefined && (!Number.isFinite(request.budget.max_cost_usd) || request.budget.max_cost_usd < 0)) {
    throw new Error('BUDGET_INVALID');
  }
  if (request.freshness_required !== undefined && typeof request.freshness_required !== 'boolean') throw new Error('FRESHNESS_INVALID');
  return {
    policy_profile: request.policy_profile,
    task_class: request.task_class,
    input,
    budget: { ...request.budget },
    ...(request.freshness_required === undefined ? {} : { freshness_required: request.freshness_required }),
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
  if (!Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0
    || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) {
    throw new Error('PROVIDER_USAGE_INVALID');
  }
  if (usage.output_tokens > maxOutputTokens) throw new Error('PROVIDER_RESULT_OVER_BUDGET');
  const normalized = { output, route_id: routeId, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } };
  if (typeof result.finish_reason === 'string' && result.finish_reason) normalized.finish_reason = result.finish_reason;
  return normalized;
}

function normalizeRoute(route) {
  assertRecord(route, 'PROVIDER_ROUTE_UNAVAILABLE');
  assertText(route.route_id, 'PROVIDER_ROUTE_UNAVAILABLE');
  assertText(route.adapter_id, 'PROVIDER_ROUTE_UNAVAILABLE');
  if (!Number.isSafeInteger(route.max_output_tokens) || route.max_output_tokens < 1) throw new Error('PROVIDER_ROUTE_UNAVAILABLE');
  if (!Number.isFinite(route.max_cost_usd) || route.max_cost_usd < 0) throw new Error('PROVIDER_BUDGET_POLICY_UNAVAILABLE');
  if (route.cache_namespace !== undefined) assertText(route.cache_namespace, 'PROVIDER_CACHE_POLICY_INVALID');
  return {
    route_id: route.route_id, adapter_id: route.adapter_id,
    max_output_tokens: route.max_output_tokens, max_cost_usd: route.max_cost_usd,
    ...(route.cache_namespace === undefined ? {} : { cache_namespace: route.cache_namespace }),
  };
}

function cacheKey(request, route, budget) {
  return createHash('sha256').update(JSON.stringify({
    namespace: route.cache_namespace,
    route_id: route.route_id, adapter_id: route.adapter_id,
    policy_profile: request.policy_profile, task_class: request.task_class,
    input: request.input, budget,
  })).digest('hex');
}

function createProviderGateway({ resolveRoute, adapters, cache } = {}) {
  if (typeof resolveRoute !== 'function') throw new Error('PROVIDER_POLICY_REQUIRED');
  if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) throw new Error('PROVIDER_ADAPTERS_REQUIRED');
  if (cache != null && (typeof cache.get !== 'function' || typeof cache.set !== 'function')) throw new Error('PROVIDER_CACHE_INVALID');

  return Object.freeze({
    async infer(input) {
      const request = normalizeRequest(input);
      const route = await resolveRoute({
        policy_profile: request.policy_profile,
        task_class: request.task_class,
        budget: { ...request.budget },
        ...(request.freshness_required === undefined ? {} : { freshness_required: request.freshness_required }),
      });
      const primary = normalizeRoute(route);
      if (route.fallback_routes !== undefined && !Array.isArray(route.fallback_routes)) throw new Error('PROVIDER_FALLBACK_POLICY_INVALID');
      const routes = [primary, ...(route.fallback_routes || []).map(normalizeRoute)];
      let unavailableCode = 'PROVIDER_ADAPTER_UNAVAILABLE';
      for (const candidate of routes) {
        const budget = {
          max_output_tokens: Math.min(request.budget.max_output_tokens, candidate.max_output_tokens),
          max_cost_usd: request.budget.max_cost_usd === undefined
            ? candidate.max_cost_usd : Math.min(request.budget.max_cost_usd, candidate.max_cost_usd),
        };
        const key = cache && candidate.cache_namespace && !request.freshness_required
          ? cacheKey(request, candidate, budget) : null;
        if (key) {
          try {
            const cached = await cache.get(key);
            if (cached && cached.route_id === candidate.route_id) {
              return normalizeResult(candidate.route_id, cached, budget.max_output_tokens);
            }
          } catch {
            // Derived cache misses, invalid entries and outages do not block inference.
          }
        }
        const adapter = Object.hasOwn(adapters, candidate.adapter_id) ? adapters[candidate.adapter_id] : null;
        if (!adapter || typeof adapter.infer !== 'function') continue;
        let result;
        try {
          result = await adapter.infer({
            input: request.input.map((message) => ({ ...message })), budget: { ...budget },
          });
        } catch (error) {
          if (error?.code === 'PROVIDER_UNAVAILABLE_BEFORE_EXECUTION') {
            unavailableCode = 'PROVIDER_UNAVAILABLE_BEFORE_EXECUTION';
            continue;
          }
          // An ambiguous failure may already have incurred cost; never retry it.
          throw new Error('PROVIDER_REQUEST_FAILED');
        }
        const normalized = normalizeResult(candidate.route_id, result, budget.max_output_tokens);
        if (key) {
          try {
            await cache.set(key, normalizeResult(candidate.route_id, normalized, budget.max_output_tokens));
          } catch {
            // Cache publication is optional and cannot become an authority.
          }
        }
        return normalized;
      }
      throw new Error(unavailableCode);
    },
  });
}

module.exports = { createProviderGateway };
