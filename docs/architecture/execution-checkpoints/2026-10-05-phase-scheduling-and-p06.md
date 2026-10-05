# Phase scheduling instruction and P06 module preparation

- recorded_at: 2026-10-05T00:46:36Z
- earliest_incomplete_phase: P03
- work_phase: P06
- execution_scope: OFFLINE_MODULE_PREPARATION
- phase_exit: NOT_PASSED
- DoD: NOT_MET
- user_instruction: "Se alguma P0n estiver travada passa pra próxima"
- scheduling: leave blocked exits pending and advance to feasible independent work in later phases; no synthetic PASS, state cutover, deletion or archive without their required evidence.
- source_ref: 7a211eaae2b54ad8bcbe15ff03b2abb953feed2b
- remote_main_observed: f4e31b4897f9fc4bf6c9bc8cf743c8cf712693b8
- working_branch: consolidation/p06-provider-policy-20261005
- base_branch: migration/platform-consolidation-p03
- target_revision: working branch; final commit recorded in the accompanying local evidence manifest.
- migration_receipts: none; no state move occurred.
- active_shim_ids: none introduced by this change; previous compatibility paths retained.
- rollback: revert this preparation commit or return to source_ref; existing production paths/configs and prior investigative checkout untouched.

## Phase work routing

| Phase | Current prerequisite/blocking scope | Work routing |
| --- | --- | --- |
| P03 | Global authority/caller/runtime evidence incomplete; AG-001 known legacy storage edges still fail | Exit pending; do not conceal those paths or mutate active authority |
| P04 | Dependent state ownership/caller inventory and current pre-mutation backup/rollback not established | State migration/cutover pending |
| P05 | P04 physical indexing runtime unavailable as a verified target | Production retrieval rollout pending |
| P06 | P03 Provider Gateway seam exists; local policy behavior can be implemented without runtime/account/corpus access | Offline module work performed; full phase exit remains pending |
| P07 | Target production command/read interfaces and writer inventory not yet complete | Runtime simplification pending; no source/runtime claim of zero writers |
| P08 | P03-P07 production target paths and effective caller/worker configs not verified | Caller/worker migration pending |
| P09 | P08 migration/zero-caller evidence and current state rollback gates unavailable | Deletion pending |
| P10 | P09 plus zero caller/deploy/state dependencies not proven | Archive pending |
| P11 | P10 and live branch/deploy/caller dependency audit incomplete | Rename/destructive cleanup pending |
| P12 | Prior phase exits and production end-to-end evidence absent | Final acceptance pending |

This routing records readiness for dependent production actions, not a claim that all source inspection or preparation in those phases is impossible. The user's instruction changes the work order; the frozen Spec Kit and its acceptance criteria are unchanged.

## Change and evidence

The existing injected Provider Gateway gains explicit configured fallback, finite/safe budget validation, an optional disposable exact cache and optional `freshness_required` on its producer-owned v1 request. Existing requests remain accepted. Freshness requests bypass both reads/writes. Cache generations are bound to trusted namespace, route, profile, input and effective budget, and responses are normalized/copied. Missing adapters or the explicit `PROVIDER_UNAVAILABLE_BEFORE_EXECUTION` signal permit fallback. Ambiguous provider failures are sanitized and do not cause a second potentially billable execution.

No SDK, cache/database backend, credential storage, broker protocol, authority, service registration, deployment or live provider call is added. Real adapters must enforce monetary caps and use the approved broker/capability path; this module does not measure remote provider charges. Semantic-cache integration and actual production callers remain unverified.

## Follow-up source caller audit — 2026-10-05T02:39:53Z

Source review of Agent Platform main `f4e31b4897f9fc4bf6c9bc8cf743c8cf712693b8` found a concrete platform-owned bypass: `persistd/src/fleet/typesafe-router.js` POSTs directly to TypeSafe System One with `TYPESAFE_API_KEY`. `persistd/src/start-entrypoint.js` wires that scorer when `PERSISTFLOW_FLEET_ROUTER_ENABLED=1`; `FleetRouter.route()` calls it when more than one candidate is eligible and falls back deterministically when the key is absent or scoring fails. The production flag, key presence and invocation count were not inspected. The source-level P06 zero-bypass condition is therefore **NOT MET**; this audit did not change that caller or any live configuration.

The existing TypeSafe protocol sends `{state, model, questions}` and consumes an `answers` map. The Provider Gateway v1 boundary currently exposes generic messages and requires normalized token usage; the TypeSafe caller tests do not establish that the remote response supplies those usage fields. A production adapter therefore still needs a verified vendor translation, a broker-backed credential source, and enforceable token/cost behavior before the caller can move without changing its deterministic fallback semantics. A wrapper that forwards the current key or fabricates usage would not close the gate.

The P07 source inventory also found direct provider routes in Gabriel Ops dashboard-swarm and TypeSafe guardrail/email-triage flows. Their platform ownership and live execution remain unresolved; they are additional caller candidates, not a zero-count result. No provider was invoked and no secret values were read in this source audit.

RED: node --test tests/provider-gateway-policy.test.js, exit 1, 14 tests: 3 passed, 11 failed before implementation.

GREEN: node --test tests/provider-gateway-policy.test.js tests/platform-modules.test.js tests/platform-contracts.test.js tests/spec-kit-validator.test.js, exit 0, 40 tests passed, 0 failed, 0 skipped. Existing dev dependencies were reused from the prior checkout via process-only NODE_PATH; no package install occurred. All inference/cache adapters in these tests are synthetic and local.

- completed_gate_evidence: changed-scope FG-001 and FG-002 tests pass; AG-008 freshness behavior and AG-018 neutral contract have local module evidence only; Spec Kit validator tests pass.
- pending_gate_ids: full AG-008, AG-013, AG-014 production caller/secret/cache-policy evidence; broker-backed provider adapters and the direct PersistFlow TypeSafe caller migration; Gabriel Ops/Orquestra caller ownership and live-use reconciliation; zero model-call bypasses; P03 AG-001 and authority-zero exit; all dependent phase production/migration/security/archive gates.
- authority_audit: no new writer/store introduced by this patch; known Agent Platform/PersistFlow legacy authority mismatch remains pending.
- architecture_drift_audit: changes are inside the approved Provider Gateway seam, with injected derived cache; no Spec Kit edit. Offline preparation does not satisfy production topology.
- blockers: VM current configuration access still unresolved as previously evidenced (Actions startup billing failure, SSM AWS_AUTH_UNAVAILABLE); current global callers, broker/adapters and cutover backup unavailable.
- next_safe_action: review/integrate this isolated P06 module patch against the source branch; continue independent preparation in later phases where prerequisites exist; resume dependent migration only when its evidence gates are established.
