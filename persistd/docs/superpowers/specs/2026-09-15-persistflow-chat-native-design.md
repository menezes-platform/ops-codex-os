# PersistFlow Chat-Native Durable Execution Control Plane Design

**Status:** Approved
**Date:** 2026-09-15
**Evolves:** Persistd
**Primary deployment:** Hostinger Node.js Web App
**Cost constraint:** zero incremental recurring cost

## Goal

PersistFlow turns a minimal sequence of ephemeral ChatGPT conversations into one durable logical controller that can carry a task to verified Definition of Done without depending on chat memory or a final message from the current conversation.

The stable unit is a `RUN_ID`. A chat is only the currently leased controller generation (`G1`, `G2`, ...). Tasks, authority, checkpoints, operations, autonomy, evidence, capability requirements, and DoD belong to the run rather than to any conversation.

## Product invariants

1. ChatGPT remains the primary cognitive executor. No Codex worker or background LLM replaces the current chat.
2. At most one authoritative chat and one unclaimed successor candidate may exist per run.
3. The system minimizes chat generations while preserving safe takeover.
4. Every predecessor is archived and its tab closed after a successor is durably promoted.
5. A generation may disappear without warning; the run must recover automatically.
6. Visible chat text is never authority.
7. Plugins are capabilities of the current chat, not authority stores.
8. No paid service, paid inference, automatic credit purchase, or automatic plan upgrade is permitted in v1.
9. Persistd claim, fencing, rename, archive, prune, retry, cleanup-debt and browser-health behavior is reused rather than replaced.
10. A run that cannot safely advance enters an explicit waiting/blocking state rather than inventing authority or blindly retrying ambiguous effects.

## Hostinger-first topology

Hostinger is the primary durable HTTP host because an existing Node.js-capable deployment is already connected to `Gabriel-Codex-OS` through GitHub. The deployed app provides public health/version endpoints, semantic PersistFlow API/MCP ingress, durable run-state service, generation fencing and claim endpoints, heartbeat/watchdog scheduling, Baton v2 storage, and decision/evidence endpoints.

Hostinger coordinates; it never becomes a cognitive worker. The app must bind to `process.env.PORT`, expose healthy `/` and `/healthz`, and be deployable through Hostinger's GitHub pipeline (`install -> build -> start`).

Cloudflare becomes optional/fallback infrastructure for DNS, proxying, tunnels, or a future alternate authority adapter. Cloudflare Sandbox, Workers AI, paid queues, and paid inference are outside v1.

## Local bridge

`persistflow-bridge` is mechanical. It creates exactly one successor candidate, transports Baton v2 and claims, health-checks browser/control layers, preflights only required tools, renames chats, archives predecessors, closes predecessor/failed-candidate tabs, prunes scratch tabs, and projects canonical state locally. It does not reason about project implementation.

## Authority and claim

PersistFlow introduces an `AuthorityStore` contract. Hostinger-backed state is the target canonical authority for managed runs. `CONTROL.md` remains a local readable projection and compatibility/recovery artifact during migration, never a second authority. If canonical authority is unavailable, authority-changing mutations fail closed.

Controller generation is a monotonic fencing epoch. After `G18` is promoted, a mutating request from `G17` returns `STALE_GENERATION`.

Takeover remains two-phase: prepare one successor plus one-time claim secret; successor reads durable state and emits the exact nonce-bound request; authority CAS-promotes Gn->Gn+1 and consumes the secret; PersistFlow confirms that exact successor; only then may it mutate project state. Pre-promotion failures close the candidate. Persisted promotion is never rolled back because confirmation delivery failed.

## Chat lifecycle and crash recovery

Rollover is adaptive rather than a rigid timer. The current chat continues while useful, drains near its interaction budget, checkpoints at a safe point, prepares one successor, and performs takeover before the hard stop. The optimization target is `minimize(chat_generations)` subject to no state loss, safe takeover, and no window timeout.
After promotion, predecessor archival and tab closure are mandatory. Archive failure becomes durable `CLEANUP_DEBT` and is retried until verified. Healthy runs present exactly one visible active run chat.

Graceful handoff is not required. Active generations emit heartbeat/progress metadata. Stale generations become `SUSPECTED_STALL` and, when warranted, `RECOVERY_REQUIRED` without waiting for the old chat. Failed unclaimed candidates are closed and retried at the same target generation. Unhealthy browser control yields `WAITING_BROWSER` and no new chat spam.

## Operation semantics

Relevant mutations follow `action -> result -> verification -> receipt -> checkpoint`. Stable `operation_id`, dedupe ledgers, postcondition verification and reconciliation provide effectively-once behavior. Ambiguous timeouts never trigger blind retry.

## Baton v2 and capabilities

The successor receives `RUN_ID`, generation and claim material; objective and DoD reference; completed/current/blocking state; `next_safe_action`; repo/branch/head/machine refs; autonomy; required/conditional tools; unresolved ambiguous operations; and cleanup debt.

PersistFlow maintains a minimal per-project capability manifest. Remote Desktop Commander provides machine/control access; GitHub source control; Exa research; Engram auxiliary semantic memory; Vercel deployment when relevant; Supabase database access when relevant. Engram is never authority.

## Autonomy and cost

Autonomy has two axes: activation `IMMEDIATE | AFTER_DESIGN_APPROVAL`, and decisions `FULL_WITHIN_ENVELOPE | ASK_CRITICAL_ONLY`. Presets map to Acesso Total, Apenas decisões críticas, and Após Brainstorming. Hard human gates remain for production release, credentials/IAM, financial commitment, irreversible non-reproducible data loss, public security-boundary change, destructive shared history, material scope expansion, and preset elevation.

PersistFlow v1 must create no new recurring spend. Paid services, paid inference, automatic plan upgrades, automatic credit purchases, and silent paid fallbacks are denied. Existing Hostinger capacity is already-owned infrastructure, not permission to upgrade it.

## Semantic surface

Initial public operations: `persist.run.start`, `persist.run.inspect`, `persist.run.continue`, `persist.run.pause`, `persist.run.abort`, `persist.autonomy.inspect`, `persist.autonomy.set`, `persist.design.approve`, `persist.decision.inspect`, `persist.decision.answer`, `persist.capability.inspect`, and `persist.evidence.inspect`. Low-level shell/filesystem/Git/browser primitives remain behind capability providers.
## Acceptance

A real end-to-end run must span at least three chat generations, survive abrupt generation loss, preserve exactly one authoritative controller, avoid duplicate confirmed side effects, activate the correct minimal tool profile, archive predecessors and close their tabs, recover failed successor creation without generation spam, finish with verified DoD and one terminal state, require no human intervention for ordinary timeout recovery, and incur zero incremental recurring cost.
