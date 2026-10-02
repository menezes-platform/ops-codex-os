# 09 — Rollout and Rollback

Rollback is phase-local. The migration never assumes that “restore the entire old architecture” is a valid recovery strategy.

## Global rollback rules

- Capture a readable backup before mutating authoritative state.
- Record source and target repository refs for every phase.
- Preserve compatibility only until its registered removal gate.
- Never delete the previous valid state before the new state passes its exit gates.
- Any primary-node failover advances `authority_epoch` before authoritative worker commits resume.
- Retrieval publishing is generation-based: candidate -> validate -> current, old current -> previous.
- Repository archive/deletion operations require preservation tags/refs and caller/deployment count = 0.

## P00
Rollback: remove freeze-only documentation changes if abandoned; no runtime mutation is allowed.
Required artifact: pre-freeze repository refs.

## P01
Rollback: evidence gathering is read-only.
Required artifact: timestamped evidence ledger with source locators.

## P02
Rollback: revert contract/test commits while legacy paths remain intact.
Required artifact: pre-contract refs plus compatibility-shim registry.

## P03
Rollback: restore prior Agent Platform branch/ref; registered shims keep legacy callers valid.
Required artifact: module/caller map and pre-consolidation refs.

## P04
Rollback: restore consistent pre-migration SQLite/WAL/state snapshot and prior execution binaries/config; advance epoch if primary ownership changes.
Required artifact: snapshot integrity proof, migration receipt, previous client config.

## P05
Rollback: point `current` back to previous validated project index generation; corpus projections remain immutable/provenance-linked.
Required artifact: `previous` index manifest, corpus manifest, embedding/chunking profile IDs.

## P06
Rollback: restore prior provider routing configuration; derived semantic/exact cache may be discarded.
Required artifact: previous routing config and caller inventory.

## P07
Rollback: redeploy previous Gabriel Ops version without altering underlying authorities.
Required artifact: prior deploy/ref and projection schema compatibility note.

## P08
Rollback: return individual callers/workers to their last approved client version while target interfaces remain available.
Required artifact: caller/worker enrollment map and previous configs.

## P09
Rollback: only registered deletion targets with preservation evidence may be removed. Stateful legacy writer deletion requires migration receipt + backup; stateless shim deletion requires preserved ref.
Required artifact: preservation refs, zero-caller evidence, backup where stateful.

## P10
Rollback: repository archive is reversible through provider settings while preservation tag/history remains. Dead deployment deletion requires recreation metadata if rollback is permitted.
Required artifact: preservation tag, archive status, deployment inventory.

## P11
Rollback: repository rename relies on provider redirects; branch deletion relies on tags/commit refs; docs cleanup relies on Git history.
Required artifact: old/new names, redirect verification, preservation tags.

## P12
Rollback: fixes are ordinary phase-local commits. The final audit never weakens the Spec Kit; if target architecture cannot pass, execution stops at a valid residual human gate.
Required artifact: final pre-audit checkpoint.

## Primary-node recovery protocol

1. Confirm/fence the old primary or treat it as lost.
2. Select replacement host.
3. Restore the most recent consistent authoritative snapshot.
4. Advance `authority_epoch`.
5. Start Secrets Broker, PersistFlow/Resident Runtime, then Agent Platform in declared dependency order.
6. Reject stale worker leases/capabilities.
7. Inspect outstanding runs/tasks before reissuing work.
8. Resume only after health and fencing gates pass.

## Retrieval snapshot publication

For each project:

1. materialize allowed corpus;
2. build/update candidate BM25 + FAISS generation;
3. validate manifest, project scope and retrieval smoke;
4. publish immutable generation;
5. set candidate as `current`;
6. demote old `current` to `previous`;
7. remove older derived generations only after publication succeeds.

Drive stores snapshots/manifests. FAISS/BM25 operate on local materialization, never on an actively synchronized database directory.
