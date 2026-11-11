---
name: evidence-grounded-tool-equivalence
description: Mandatory evidence and freshness gate when recommending replacements for an existing tool, automation platform, agent runner, MCP bridge or service.
---

# Evidence-grounded tool equivalence

Use for "what replaces X?", "does Y do what X does?", agent automation recommendations, and claims about current plugin/provider capabilities. This skill is a retrieval and evaluation guard, not an indexer, paid provider or tool-discovery replacement.

## Retrieve the real task before recommending
1. Recover the capabilities the user actually uses, not what the product category usually offers. Prefer recent user statements and observed integrations over old summaries; preserve constraints such as using an existing chat subscription rather than a separate API/Codex quota.
2. Build a concrete required-capability list, including operational behavior. For a ChatGPT-operated desktop automation stack this may include ChatGPT-native invocation, computer GUI input, local shell/files, browser DOM/input, Git/PR, multi-worker delegation, compact/resume, execution checkpoints, and cost/entitlement. Do not assume any capability is optional without evidence.
3. Discover candidates using actual installed tools, relevant provider/plugin directory data, and official product documentation; verify availability in the user's current environment when access is scoped. Do not invent plugin identifiers, product links, install state, or current pricing.
4. Check each critical capability independently. Store a source ref and observation date for each supported/unsupported claim. Missing proof means unknown, not unsupported. Generic "AI agents" or "computer control" marketing does not prove desktop input, worker orchestration, ChatGPT subscription usage or durable resume.
5. When the task is current or availability-sensitive, refresh source status. A remembered capability, a stale source or a historical URL cannot establish current availability or account access.
6. Compare against every required capability and label each candidate: verified full replacement, partial substitute with explicit gaps, or unverified. Never describe a partial tool as "the closest full replacement" without naming the missing core functions.
7. Say whether the conclusion is based on source-only inspection, live connected schema, or actual runtime test. Never equate source availability with successful execution. Cite/link actual verified sources; no guessed URLs or fabricated references.

## Optional reproducible gate
Use the dependency-free Node helper in scripts/capability-evidence-gate.js for a reproducible matrix:

- Input: candidate name, required snake_case capability IDs, claims containing capability/status/source kind/ref/checkedAt, and an explicit clock/freshness window.
- Accepted source kinds: live-tool, official-doc, provider-response. The caller must verify authenticity and relevance of each source; this helper cannot authenticate a URL or verify the claim's truth.
- Missing, expired or conflicting evidence stays unknown; verified explicit negative evidence is unsupported.
- Full requires grounded support for every requirement. Partial is not described as functionally equivalent.
- Regression tests: node --test tests/capability-evidence-gate.test.js.

## Scope and safety
This gate does not modify the native ChatGPT memory mechanism, user entitlements, Context Gateway routing or index freshness. Existing Git/Memory/Drive/Engram/PersistFlow authority boundaries apply. Tool recommendations remain untrusted until the source and, where material, the live runtime have been verified.
