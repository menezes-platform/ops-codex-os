const assert = require('node:assert/strict');
const test = require('node:test');
const { createProviderGateway } = require('../modules/provider-gateway/src');

function request(extra = {}) {
  return {
    policy_profile: 'default', task_class: 'summary',
    input: [{ role: 'user', content: 'private prompt' }],
    budget: { max_output_tokens: 100, max_cost_usd: 0.02 },
    ...extra,
  };
}

function route(extra = {}) {
  return { route_id: 'primary-v1', adapter_id: 'primary', max_output_tokens: 80, max_cost_usd: 0.01, ...extra };
}

function result(content = 'answer', outputTokens = 2) {
  return { output: [{ role: 'assistant', content }], usage: { input_tokens: 3, output_tokens: outputTokens } };
}

function setup(selectedRoute, adapters, cache) {
  return createProviderGateway({ resolveRoute: async () => selectedRoute, adapters, cache });
}

function memoryCache() {
  const entries = new Map();
  const reads = [];
  const writes = [];
  return {
    entries, reads, writes,
    get: async (key) => { reads.push(key); return entries.get(key); },
    set: async (key, value) => { writes.push(key); entries.set(key, value); },
  };
}

test('nonfinite cost and unsafe token budgets are rejected before policy or adapter execution', async () => {
  let policyCalls = 0;
  const gateway = createProviderGateway({ resolveRoute: () => { policyCalls++; return route(); }, adapters: {} });
  for (const max_cost_usd of [NaN, Infinity, -Infinity]) {
    await assert.rejects(gateway.infer(request({ budget: { max_output_tokens: 10, max_cost_usd } })), /BUDGET_INVALID/);
  }
  await assert.rejects(gateway.infer(request({ budget: { max_output_tokens: Number.MAX_SAFE_INTEGER + 1 } })), /BUDGET_INVALID/);
  assert.equal(policyCalls, 0);
});

test('configured fallback can replace an unavailable adapter without widening the effective budget', async () => {
  const calls = [];
  const gateway = setup(route({ fallback_routes: [route({ route_id: 'fallback-v1', adapter_id: 'fallback', max_output_tokens: 50, max_cost_usd: 0.005 })] }), {
    fallback: { infer: async (input) => { calls.push(input); return result(); } },
  });
  assert.equal((await gateway.infer(request())).route_id, 'fallback-v1');
  assert.deepEqual(calls[0].budget, { max_output_tokens: 50, max_cost_usd: 0.005 });
});

test('fallback runs only on an explicit failure before provider execution starts', async () => {
  const calls = [];
  const gateway = setup(route({ fallback_routes: [route({ route_id: 'fallback-v1', adapter_id: 'fallback' })] }), {
    primary: { infer: async () => { calls.push('primary'); const error = new Error('private detail'); error.code = 'PROVIDER_UNAVAILABLE_BEFORE_EXECUTION'; throw error; } },
    fallback: { infer: async () => { calls.push('fallback'); return result(); } },
  });
  assert.equal((await gateway.infer(request())).route_id, 'fallback-v1');
  assert.deepEqual(calls, ['primary', 'fallback']);
});

test('an ambiguous execution failure is sanitized and never dispatches a fallback', async () => {
  let fallbackCalls = 0;
  const gateway = setup(route({ fallback_routes: [route({ route_id: 'fallback-v1', adapter_id: 'fallback' })] }), {
    primary: { infer: async () => { throw new Error('do not expose credential-like provider detail'); } },
    fallback: { infer: async () => { fallbackCalls++; return result(); } },
  });
  await assert.rejects(gateway.infer(request()), (error) => error.message === 'PROVIDER_REQUEST_FAILED' && error.cause === undefined);
  assert.equal(fallbackCalls, 0);
});

test('a returned over-budget result never causes another provider execution', async () => {
  let fallbackCalls = 0;
  const gateway = setup(route({ fallback_routes: [route({ route_id: 'fallback-v1', adapter_id: 'fallback' })] }), {
    primary: { infer: async () => result('too long', 81) },
    fallback: { infer: async () => { fallbackCalls++; return result(); } },
  });
  await assert.rejects(gateway.infer(request()), /PROVIDER_RESULT_OVER_BUDGET/);
  assert.equal(fallbackCalls, 0);
});

test('an invalid fallback policy is rejected before any provider dispatch', async () => {
  let calls = 0;
  const gateway = setup(route({ fallback_routes: [route({ max_cost_usd: NaN })] }), { primary: { infer: async () => { calls++; return result(); } } });
  await assert.rejects(gateway.infer(request()), /PROVIDER_BUDGET_POLICY_UNAVAILABLE/);
  assert.equal(calls, 0);
});

test('cache use requires explicit eligibility through a versioned policy namespace', async () => {
  const cache = memoryCache();
  let calls = 0;
  const gateway = setup(route(), { primary: { infer: async () => { calls++; return result(); } } }, cache);
  await gateway.infer(request());
  await gateway.infer(request());
  assert.equal(calls, 2);
  assert.deepEqual(cache.reads, []);
  assert.deepEqual(cache.writes, []);
});

test('eligible exact-cache hits use opaque policy and budget-specific keys', async () => {
  const cache = memoryCache();
  let calls = 0;
  const gateway = setup(route({ cache_namespace: 'summary-policy-v1' }), { primary: { infer: async () => { calls++; return result(); } } }, cache);
  assert.deepEqual(await gateway.infer(request()), await gateway.infer(request()));
  assert.equal(calls, 1);
  assert.equal(cache.writes.length, 1);
  assert.match(cache.writes[0], /^[a-f0-9]{64}$/);
  await assert.rejects(gateway.infer(request({ budget: { max_output_tokens: 1, max_cost_usd: 0.01 } })), /PROVIDER_RESULT_OVER_BUDGET/);
  assert.equal(calls, 2);
  assert.notEqual(cache.reads[0], cache.reads[2]);
});

test('freshness-required requests bypass all cache reads and writes', async () => {
  const cache = memoryCache();
  let calls = 0;
  let policyInput;
  const gateway = createProviderGateway({
    resolveRoute: async (input) => { policyInput = input; return route({ cache_namespace: 'summary-policy-v1' }); },
    adapters: { primary: { infer: async () => result(`live-${++calls}`) } }, cache,
  });
  await gateway.infer(request());
  const readCount = cache.reads.length;
  const writeCount = cache.writes.length;
  const live = await gateway.infer(request({ freshness_required: true }));
  assert.equal(live.output[0].content, 'live-2');
  assert.equal(policyInput.freshness_required, true);
  assert.equal(cache.reads.length, readCount);
  assert.equal(cache.writes.length, writeCount);
});

test('freshness flags are strict booleans and fail before policy execution', async () => {
  let calls = 0;
  const gateway = createProviderGateway({ resolveRoute: () => { calls++; return route(); }, adapters: {} });
  await assert.rejects(gateway.infer(request({ freshness_required: 'true' })), /FRESHNESS_INVALID/);
  assert.equal(calls, 0);
});

test('cache corruption or backend failure cannot make inference unavailable', async () => {
  const selected = route({ cache_namespace: 'summary-policy-v1' });
  for (const cache of [
    { get: async () => ({ route_id: 'wrong-route', ...result() }), set: async () => {} },
    { get: async () => ({ route_id: 'primary-v1', ...result('over budget', 81) }), set: async () => {} },
    { get: async () => { throw new Error('cache unavailable'); }, set: async () => { throw new Error('cache unavailable'); } },
  ]) {
    let calls = 0;
    const gateway = setup(selected, { primary: { infer: async () => { calls++; return result(); } } }, cache);
    assert.equal((await gateway.infer(request())).output[0].content, 'answer');
    assert.equal(calls, 1);
  }
});

test('policy namespace changes prevent reuse of old response generations', async () => {
  const cache = memoryCache();
  let generation = 1;
  let calls = 0;
  const gateway = createProviderGateway({
    resolveRoute: async () => route({ cache_namespace: `summary-policy-v${generation}` }),
    adapters: { primary: { infer: async () => result(`generation-${++calls}`) } }, cache,
  });
  assert.equal((await gateway.infer(request())).output[0].content, 'generation-1');
  generation = 2;
  assert.equal((await gateway.infer(request())).output[0].content, 'generation-2');
  assert.notEqual(cache.reads[0], cache.reads[1]);
});

test('mutating a caller result cannot poison a subsequent cache hit', async () => {
  const cache = memoryCache();
  let calls = 0;
  const gateway = setup(route({ cache_namespace: 'summary-policy-v1' }), { primary: { infer: async () => { calls++; return result(); } } }, cache);
  const first = await gateway.infer(request());
  first.output[0].content = 'caller mutation';
  first.usage.output_tokens = 999;
  assert.equal((await gateway.infer(request())).output[0].content, 'answer');
  assert.equal(calls, 1);
});

test('an inherited adapter cannot be invoked as a configured provider', async () => {
  const gateway = setup(route(), Object.create({ primary: { infer: async () => result() } }));
  await assert.rejects(gateway.infer(request()), /PROVIDER_ADAPTER_UNAVAILABLE/);
});

test('unsafe input-token usage is rejected instead of becoming an accounting receipt', async () => {
  const gateway = setup(route(), {
    primary: { infer: async () => ({
      ...result(),
      usage: { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 2 },
    }) },
  });
  await assert.rejects(gateway.infer(request()), /PROVIDER_USAGE_INVALID/);
});
