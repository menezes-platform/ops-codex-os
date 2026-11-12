# 02 — Target Architecture

## Principal repositories

### agent-platform

Evolution of `menezes-platform/ops-codex-os`.

Owns:

- global agent architecture and policies;
- reusable skills;
- Context Gateway;
- Context Store ownership and corpus policy;
- retrieval orchestration;
- Provider Gateway;
- global ADRs and architecture constitution.

Target modules:

- `agent-os`
- `context-gateway`
- `context-store`
- `retrieval`
- `provider-gateway`
- `docs/architecture`

The runtime is architecturally stateless. It may keep disposable caches and configuration, but no operational authority or unique durable knowledge may exist only inside it.

### execution-plane

Evolution of `menezesx2k26-byte/resident-node`.

Owns:

- PersistFlow core;
- Resident Runtime;
- indexing/retrieval physical execution;
- SQLite/WAL operational authority;
- secrets broker;
- worker adapters;
- authority epoch, leases and capability fencing.

Target modules:

- `persistflow-core`
- `resident-runtime`
- `indexing-runtime`
- `secrets-broker`
- `worker-adapters`

### ops-gabriel-ops

Retained and simplified.

Owns:

- observability;
- dashboards;
- health;
- projections;
- operational command console.

It owns no platform authority state. All mutations pass through official clients.

### Memory

Retained, private, and narrowed to canonical personal context.

It owns:

- durable personal preferences;
- long-term goals;
- persistent personal constraints;
- identity/account context;
- durable personal decisions.

It does not own platform architecture, project architecture, execution state, or technical project corpus.

## Cloud-primary physical deployment (owner availability requirement, 2026-11-11)

A **hosted/cloud primary** runs the Context Gateway and the single-fenced Execution Plane authority with qualified native retrieval/indexing and server-side secret custody. Its service endpoints, source ingest, scheduled refresh and recovery **must remain functional with the developer's Windows PC completely off**. The Windows desktop is optional development, diagnostics and maintenance infrastructure only; it cannot be the primary, required tunnel, mandatory cron executor, exclusive secrets vault, source of unique data or automatic fallback.

- Preserve exactly one authoritative primary and approved producer-owned interfaces; no multi-primary or implicit leader election.
- Preserve the existing Hostinger Node application as a candidate cloud HTTP/control-plane host, subject to plan and runtime qualification. Shared Hostinger Node hosting does not imply support for native Rust/FAISS binaries or indefinitely running workers.
- Use a bounded cloud scheduler (existing Hostinger Node Cron or Cloudflare Cron Trigger if eligible) for incremental ingress/checks. Cloudflare's lightweight Worker must not silently become the CPU-heavy index host.
- Keep encrypted owner-approved corpus and backups in durable remote storage; active BM25/FAISS snapshots are derived local materializations **on the qualified cloud executor**, not in the deploy tree or Windows.
- Use private HTTPS/JSON and versioned contracts for inter-plane and client access, with authenticated owner capabilities, source revisions, freshness and rollback receipts.
- When hosted retrieval/ingestion is down, explicitly return unavailable/stale; never fabricate current data or depend on an unattended Windows machine.

This replaces the initial PC-host placement, not the existing authority and migration gates. **The cloud-primary runtime and PC-off drill are NOT yet qualified or deployed.** See ADR 0013.

## Context flow

1. Agent identifies deterministic scope.
2. Context Gateway selects allowed sources.
3. Project truth is checked against Git/current source evidence.
4. Personal Memory is consulted only when materially relevant.
5. Engram provides episodic candidates only.
6. Derived retrieval executes BM25 + FAISS against the project-isolated index.
7. Context Gateway normalizes evidence and provenance.
8. Agent consumes normalized evidence, never raw framework/vendor types.

## Corpus and retrieval

The Context Store is the durable retrieval corpus projection, not original project truth.

Backing model:

- Google Drive stores normalized corpus, manifests, and index snapshots;
- active FAISS/BM25 work happens on local materialization;
- every project has a physically separate index;
- current and previous index generations are retained;
- incremental updates occur after durable approved changes;
- periodic full rebuild restores derived-index consistency.

Initial retrieval:

- BM25 lexical retrieval;
- FAISS vector retrieval;
- one global versioned local embedding profile;
- structural chunking by source type;
- fusion/reranking owned by the retrieval module.

RAGFlow remains outside the initial runtime.

## Execution flow

1. Agent Platform submits a versioned command.
2. Execution Plane validates idempotency, lease, capability and authority epoch as applicable.
3. PersistFlow advances run/generation/checkpoint/claim state.
4. Resident Runtime or a worker performs the physical task.
5. Result is accepted only if fencing remains valid.
6. Authoritative state is committed by the owning module.
7. Gabriel Ops receives projections only.

## Failover

Initial failover is manual:

1. fence or confirm loss of old primary;
2. choose replacement host;
3. restore consistent snapshot;
4. advance authority epoch;
5. restore services;
6. reject stale leases/capabilities;
7. verify health and outstanding run state;
8. resume.

Automatic leader election and multi-primary execution are intentionally out of scope.
