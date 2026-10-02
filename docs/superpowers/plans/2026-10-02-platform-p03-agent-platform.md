# P03 Implementation Plan — Agent Platform Module Seams

## Phase boundary

Implement offline, platform-owned Agent OS, Context Gateway, Context Store, and Provider Gateway module seams inside `ops-codex-os`. Use the P02 producer schemas and the versioned Execution Plane client. No deployment, caller cutover, database, provider call, retrieval runtime, secret access, or durable operational state mutation is in scope.

The existing `server.js` -> PersistFlow production path and `FileAuthorityStore` remain untouched until callers, deployments, live state, a P04 Execution Plane replacement, and rollback evidence are observed. Their presence is an explicit P03 exit blocker, not a passing zero-authority gate or an exemption.

## Planned files and interfaces

- `modules/agent-os/src/index.js`: stateless composition facade over Context Gateway, Provider Gateway, and the versioned Execution Plane client. It holds no run, conversation, project, secret, or cache authority.
- `modules/context-gateway/src/index.js`: trusted project-scope resolver, one-project recall through the Execution Plane client, explicit allowlisted multi-project recall, and producer-owned validation. Do not take project scope from model output.
- `modules/context-store/src/index.js`: platform-owned corpus/manifest projection interface over an injected driver. Enforce project scope and idempotency; never write Git source. No Drive adapter or persistent storage implementation in P03; those depend on P05 evidence and gates.
- `modules/provider-gateway/src/index.js`: provider-neutral inference facade. Resolve route through injected gateway policy, select an internal adapter, enforce budget shape, and normalize output. Public callers cannot select a raw provider. No real provider adapter, credential, route, network call, or spend is configured in P03; Secrets Broker integration and production routing wait for their approved phases.
- `tests/platform-modules.test.js`: offline fake-dependency tests for each seam and the Agent OS facade.
- `tests/platform-contracts.test.js`: extend architecture checks over P03 module source, while retaining full-repository legacy findings as visible migration debt rather than suppressing or falsely passing the P03 authority-zero gate.

## Test-first sequence

1. Add failing tests for trusted deterministic scope, one-project recall, allowlisted multi-project recall, scoped/idempotent Context Store projection calls, provider-neutral routing/budget normalization, Agent OS delegation without local authority, and forbidden imports from target modules.
2. Implement only the injected module facades above; use platform-owned plain JSON objects and built-in validation. Do not add a dependency.
3. Run focused module tests, then the complete root `npm test`, `npm run validate:spec-kit`, and `git diff --check`.
4. Audit actual diff against target modules, authority matrix, dependency graph and deletion map. Verify `server.js`, PersistFlow authority storage, deployment config and live callers were not changed.
5. Record source-only seams as completed; record the P03 zero-authority/PersistFlow-storage gate as pending until safe replacement and live evidence exist.

## Explicit deferred mutations

- No PersistFlow source relocation, service disablement, API redirection, shim, route switch, state cleanup or deployment change in P03.
- No Context Store Drive object writes or corpus/index materialization; P01 did not identify the live corpus/manifests or rollback generation.
- No Memory or Engram connection; their runtime endpoints and state evidence are unresolved.
- No provider SDK integration or external inference; provider route policy, custody and live caller inventory are unresolved.
- No change to the Spec Kit or to the P00–P12 order.

## Verification and exit

P03 module acceptance requires all four module seams, isolated offline tests, green repository/architecture tests, and no new forbidden dependencies. The phase cannot exit until its Spec Kit requirements also hold: Agent Platform operational-authority stores = 0 and PersistFlow-storage access = 0. The current production entrypoint makes those conditions unproven and source-inconsistent, so they remain pending for evidence-backed resolution under the approved phase sequence.

## Rollback

Revert the P03 module/test commit to the P03 start checkpoint `fdef620b9e06ce6f2a795df64e57f1980d006fed`. These source-only facades have no runtime registration or persistent state, so no data snapshot is required. Keep the module/caller map and pre-consolidation refs in the phase checkpoint.
