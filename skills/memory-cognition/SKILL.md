---
name: memory-cognition-provider
description: Provider-neutral, project-scoped retrieval and derived-candidate gate for coding agents.
---

# Memory Cognition Provider

Use this package when an agent needs selective repository context or a review-only memory candidate. Agents call `memory_recall`, `memory_derive`, and `memory_explain` through the host's MCP integration. They do not call Engram or Hindsight APIs directly.

## Rules

- Derive scope from the checked-out repository identity. Never ask the model to invent a bank ID.
- Treat every provider result as derived. Check Git and current runtime/project sources before answering current-state questions or proposing promotion.
- Engram's project/title filter is for relevance only; it is not an authorization boundary.
- Hindsight is optional shadow evaluation. Its results do not change the recall result returned to the agent.
- Candidates carry provenance and `canonical_write: false`; validate them with the private Memory repository's validator using the exact project scope. A valid candidate is only `ready_for_review`.
- Never ingest account chats, secrets, private study material, or unrelated project data.
- Keep `HINDSIGHT_SERVING_ENABLED` off. This implementation hard-disables serving pending an actual isolated pilot and measured acceptance.

## Contract

`MemoryCognitionProvider` exposes normalized `recall(scope, query, timeWindow?, evidenceFilters?, limit?)`, `derive(scope, events, context?)`, and `explain(scope, itemId)`. Every recall item names its scope, provider, retrieval method, time status and evidence provenance. Unsupported provider capabilities fail closed instead of being simulated.
