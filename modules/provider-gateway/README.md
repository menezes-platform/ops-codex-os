# Provider Gateway

Producer-owned inference v1 remains provider-neutral. The gateway is an injected module: it registers no service, keeps no conversation/run/project authority, imports no provider SDK, stores no credential, and makes no network call itself. This P06 preparation extends the existing P03 seam; it does not migrate production callers or certify P06 completion.

## Requests and policy

Existing requests remain valid. The optional boolean `freshness_required` is added to inference v1. Consumers asking for current Git/CI/deploy/worker/run/quota evidence must set it; it is forwarded to routing policy and bypasses both cache reads and cache writes. Invalid flags and nonfinite/unsafe budgets fail before policy or provider execution.

`resolveRoute` receives profile, task class, requested budget and the freshness flag when present. It returns an internal route containing `route_id`, `adapter_id`, `max_output_tokens` and `max_cost_usd`. It may explicitly supply an ordered `fallback_routes` array of the same route descriptors. The whole plan is validated before dispatch. Every candidate is capped by the caller's budget and that candidate's approved route limits. Adapters must enforce the supplied cost/token limits before acquiring or executing provider work; token usage is checked again after completion. This module cannot independently measure or guarantee a remote provider's monetary charge.

An unavailable adapter can be skipped. An adapter may signal `PROVIDER_UNAVAILABLE_BEFORE_EXECUTION` only when it knows that provider execution/acquisition never began and no charge was incurred. Only that signal permits trying the next configured route. Ambiguous errors, timeouts after acquisition, malformed results and returned over-budget results never trigger another execution. Ambiguous provider errors are replaced by `PROVIDER_REQUEST_FAILED` without copying message/cause/SDK details.

## Optional derived exact cache

Inject a disposable `cache` with async `get(key)` and `set(key, result)`. Caching is disabled unless trusted policy explicitly supplies a nonempty, versioned `cache_namespace` on the selected candidate and the request does not require freshness. Policy must approve the data class for caching and change the namespace when adapter/model configuration or routing/cache policy changes. A namespace is policy metadata, not a secret or a new public model selector.

The opaque key hashes the namespace, route/adapter, profile/task class, normalized prompt and effective budget. It does not export the prompt in the key. Cached results are revalidated against route identity and current token bounds, normalized to public fields and copied. Invalid entries and cache failures become misses; failed publication does not fail inference. Caller mutations cannot change the stored response. Disabling/deleting the cache preserves the provider path.

This interface prepares exact-cache reuse only. Existing semantic-cache implementation, eligibility/freshness policy, production callers and real provider adapters still require inventory and migration. No cache backend or database is introduced here. Real adapters must obtain credentials through the approved Secrets Broker/capability path before activation.

## Verification

Run `node --test tests/provider-gateway-policy.test.js tests/platform-modules.test.js tests/platform-contracts.test.js tests/spec-kit-validator.test.js`. Contract tests require the repository's existing development dependencies. Policy tests use local synthetic adapters and an in-memory cache; they perform no paid provider request or production mutation. These tests verify the changed module/contract and do not replace global AG-008/AG-013/AG-014, secret-custody or zero-bypass runtime evidence.
