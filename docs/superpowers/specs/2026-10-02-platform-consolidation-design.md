# Platform Consolidation Architecture Design

**Date:** 2026-10-02  
**Status:** Design approved in brainstorming; pending written-spec review  
**Scope:** Entire Gabriel agent/runtime/context platform  
**Current architecture authority:** This document becomes the design input for the future Spec Kit. Until the migration completes, current production/runtime evidence remains authoritative for actual state.

## 1. Intent

The platform has accumulated multiple repositories, runtimes, caches, memory systems, control planes, workers and experimental providers. Most pieces are individually defensible, but responsibilities overlap and architectural authority is expressed mainly in prose rather than in module seams, contracts and executable invariants.

The objective is not to add another abstraction. The objective is to consolidate the platform into a small number of deep modules with explicit ownership, one authoritative writer per state domain, deterministic retrieval scope, disposable derived indexes, and a migration path that deletes obsolete architecture instead of layering over it.

Success means a future agent can answer all of the following without reading historical design documents:

1. Which module owns this state?
2. Which interface must I call?
3. Which repository owns that interface?
4. Is this data authoritative or derived?
5. Can this cache/index be deleted and rebuilt?
6. Which runtime is allowed to mutate the state?
7. What objective condition permits removal of a legacy shim?

## 2. Architectural constitution

The following rules are constitutional and override convenience-driven implementation choices.

### 2.1 Exactly one authority per domain

Every durable state domain has exactly one authoritative writer.

All other representations are explicitly one of:

- projection;
- cache;
- index;
- snapshot;
- replica;
- telemetry;
- exported artifact.

Derived state may improve latency, recall or observability, but may never silently become an authority.

### 2.2 Frameworks are implementation details

External frameworks and products do not define platform interfaces.

This includes, but is not limited to:

- LangChain;
- FAISS;
- Redis/RedisVL;
- RAGFlow;
- Hindsight;
- Engram;
- provider SDKs;
- MCP transports.

Public platform contracts use platform-owned request/result schemas. Vendor/framework types do not escape module implementations.

### 2.3 Interfaces live with the module that offers them

The producer module owns its interface, schemas and compatibility policy.

Consumers receive generated or maintained clients/SDKs. There is no independent “contracts repository” with authority over modules it does not own.

### 2.4 No valid scope, no project recall

Project retrieval requires a deterministic canonical scope derived from the active workspace/repository identity.

Canonical format:

    project/<owner>/<repo>

The model may not invent, widen or merge project scope. Multi-project retrieval is a separate explicit operation.

### 2.5 Compatibility is temporary and mortal

Every migration shim must declare:

- owner;
- why it exists;
- allowed callers;
- removal condition;
- latest permitted migration phase.

A shim whose removal condition is satisfied must be deleted. “Keep for safety” is not an acceptable permanent state.

### 2.6 Destruction is part of Done

The migration is not complete when the new architecture works. It is complete only when the obsolete architecture, duplicate authorities, dead shims, superseded branches and stale global architecture documents have been removed or archived according to this design.

## 3. Final repository topology

The final platform uses four principal repositories/systems.

### 3.1 agent-platform

Evolution and final rename of the current:

    menezes-platform/ops-codex-os

Responsibilities:

- global agent architecture;
- agent policies and reusable skills;
- context policy and normalization;
- context corpus management;
- retrieval orchestration;
- provider/model routing;
- global ADRs and architecture constitution;
- shared high-level architecture documentation.

Modules:

    agent-platform/
      agent-os/
      context-gateway/
      context-store/
      retrieval/
      provider-gateway/
      docs/architecture/

The repository is architecturally stateless. It may use ephemeral caches and configuration, but no important operational state or unique durable knowledge may exist only inside its runtime.

### 3.2 execution-plane

Evolution and final rename of the current:

    menezesx2k26-byte/resident-node

Responsibilities:

- PersistFlow execution authority;
- Resident local runtime;
- indexing and retrieval physical execution;
- durable local operational state;
- secret custody and capability issuance;
- worker adapters;
- execution health and fencing.

Modules:

    execution-plane/
      persistflow-core/
      resident-runtime/
      indexing-runtime/
      secrets-broker/
      worker-adapters/

The repository absorbs the useful implementation from the current PersistFlow sandbox and execution-oriented pieces from other repositories.

### 3.3 ops-gabriel-ops

Current repository retained and aggressively simplified.

Responsibilities:

- observability;
- dashboards;
- health views;
- projections;
- operational command console.

It may issue commands only through official module interfaces.

It may not own:

- run state;
- generation state;
- worker authority;
- project corpus truth;
- personal memory;
- model routing truth;
- secret custody.

### 3.4 Memory

Current private Memory repository retained.

Its sole role is canonical personal context.

It owns:

- durable user preferences;
- long-term goals;
- persistent personal constraints;
- identity/account context;
- durable personal decisions.

It does not own:

- platform architecture;
- project architecture;
- execution state;
- run/checkpoint state;
- technical project corpus;
- global ADRs.

Global architecture documents currently stored there must migrate to agent-platform.

## 4. Legacy repository disposition

### 4.1 ops-dev-orquestra

Disposition: migrate useful capability, then archive.

Capability routing:

- semantic cache -> agent-platform/provider-gateway;
- browser/computer execution -> execution-plane;
- runtime bridges -> owning module adapter;
- useful provider integration -> provider-gateway;
- useful worker integration -> worker-adapters;
- duplicate orchestration/control-plane logic -> delete after migration;
- duplicate state authority -> delete;
- stale architectural docs -> supersede/archive.

Archive gate:

- all production callers migrated;
- equivalent or improved tests pass;
- no authoritative state remains;
- useful decisions captured in canonical architecture docs;
- no live deployment depends on the repository;
- repository tagged for historical preservation.

### 4.2 ops-persistflow-sandbox

Disposition: migrate useful implementation into execution-plane, then archive.

Archive gate:

- PersistFlow state path and interfaces migrated;
- callers migrated;
- state migration verified;
- rollback snapshot verified;
- no deployment depends on sandbox;
- equivalent execution tests pass;
- repository tagged for historical preservation.

## 5. Authority matrix

| Domain | Authoritative source/writer | Derived representations |
| --- | --- | --- |
| Project source/code | Git repository | Context Store projection, retrieval indexes |
| Project specs/ADRs/docs | Git repository | Context Store projection, retrieval indexes |
| Personal context | Memory | Selective retrieval projection |
| Episodic conversation | Engram | Search results/candidates |
| Run/generation/checkpoint/claim | PersistFlow core | Ops projections, telemetry |
| Local jobs/capabilities/security state | Resident Runtime | Ops projections, telemetry |
| Retrieval corpus projection | Context Store | BM25/FAISS indexes |
| Retrieval indexes | No independent authority | Fully rebuildable |
| Secrets | Secrets Broker | Short-lived scoped capabilities |
| Observability | Upstream authorities | Gabriel Ops projections |
| Model/provider routing policy | Provider Gateway configuration | Metrics/cache |
| Semantic response cache | No independent authority | Disposable cache |

Conflict precedence is domain-specific and explicit:

- current Git beats stale project projection;
- Memory beats derived personal-context candidates;
- PersistFlow beats dashboards, logs and inferred run state;
- Resident Runtime beats worker-reported authority claims;
- original source provenance beats derived retrieval index content.

## 6. Agent Platform

### 6.1 agent-os

Owns:

- global agent policies;
- reusable skills;
- routing rules;
- architecture-aware tool policy;
- global operator instructions.

Does not own:

- operational execution state;
- secrets;
- blobs;
- retrieval index persistence;
- personal canonical memory.

### 6.2 context-gateway

The Context Gateway is the only agent-facing context seam.

Responsibilities:

- deterministic scope resolution;
- source selection;
- personal-context policy;
- episodic-context policy;
- retrieval requests;
- evidence normalization;
- provenance validation;
- authority/conflict handling;
- ingestion classification;
- redaction policy before durable ingestion.

Conceptual interface:

    recall(scope, query, filters?) -> evidence[]
    ingest(scope, durable_change) -> ingestion_receipt
    explain(evidence_id) -> provenance
    request_reindex(scope, revision) -> indexing_receipt

The interface is platform-owned. LangChain types never cross it.

### 6.3 context-store

The Context Store is the canonical durable corpus for retrieval, not the original truth of projects.

It stores normalized, provenance-linked projections of durable source material.

Backing store:

- Google Drive for durable corpus/manifests/index snapshots;
- local materialization/cache for active work;
- no database is kept actively open on a Drive-synchronized directory.

Per-project structure is physically isolated:

    projects/
      <owner>/<repo>/
        corpus/
        manifests/
        lexical/
        vector/
        index-manifest.json

The storage layout may evolve, but project isolation is non-negotiable.

For each project, index retention keeps:

- current generation;
- previous generation.

Older derived index generations may be removed because indexes are rebuildable from corpus projections and authoritative sources.

### 6.4 Corpus ingestion policy

Only durable material is eligible for canonical corpus ingestion.

Eligible classes include:

- committed specs;
- ADRs;
- handoffs;
- durable project decisions;
- durable documentation;
- verified execution evidence;
- durable generated artifacts;
- normalized source projections.

Ineligible by default:

- ordinary conversational chatter;
- hidden reasoning;
- ephemeral scratch state;
- unverified claims;
- raw secrets;
- transient worker telemetry;
- arbitrary model output with no durable promotion event.

A durable change approved in its authoritative source triggers incremental project indexing.

### 6.5 Memory integration

Memory is consulted selectively, not globally.

The Context Gateway requests Memory only when personal preferences, goals, constraints or durable account context can materially affect the task.

Technical tasks do not receive personal context by default.

### 6.6 Engram integration

Engram remains episodic and non-authoritative.

Its role:

- recover prior conversation;
- locate informal prior discussion;
- surface candidate context;
- assist continuity when no durable promotion has occurred.

Engram cannot settle conflicts against Git, Memory, PersistFlow or runtime evidence.

Raw Engram conversation is not bulk-promoted into the Context Store.

## 7. Retrieval design

### 7.1 Initial retrieval stack

RAGFlow is outside the initial runtime scope.

Initial retrieval uses:

- LangChain only as an internal implementation library where useful;
- lexical retrieval with BM25;
- vector retrieval with FAISS;
- local embeddings;
- fusion/reranking owned by the retrieval module;
- per-project physical isolation.

RAGFlow may be evaluated later behind the same platform-owned retrieval interface.

### 7.2 LangChain rule

LangChain may reduce implementation effort inside the retrieval module.

It may not:

- define public interfaces;
- own durable state;
- become the platform control plane;
- own orchestration;
- own execution continuity;
- leak framework-specific document/retriever/runnable types to callers.

### 7.3 Per-project indexes

Every project has independent lexical and vector indexes.

A normal retrieval request may touch exactly one project index.

Multi-project retrieval requires an explicit multi-project command and an allowlisted scope set.

This provides a structural defense against cross-project leakage rather than relying only on metadata filtering.

### 7.4 Embeddings

Embeddings are local, deterministic enough for reproducible rebuilds, and versioned.

There is one default global embedding profile.

Every index generation records:

- embedding profile identifier;
- model/revision identifier;
- vector dimension;
- chunking profile/version;
- corpus generation;
- source revision set;
- creation timestamp;
- index format version.

Changing the embedding model/profile produces a new index generation. It never silently overwrites an incompatible generation.

The exact initial model is an implementation parameter selected and frozen in the implementation plan under the global local-embedding constraint; changing model class later is not an architecture change as long as the manifest and rebuild rules are preserved.

### 7.5 Chunking

Chunking is structural by source type.

Preferred strategy:

- Markdown: heading/section aware;
- source code: symbol/class/function aware where parser support is reliable;
- PDF/document text: section/paragraph aware;
- unknown/plain text: deterministic size-based fallback.

Chunking profile is versioned.

### 7.6 Update strategy

Normal operation:

- incremental update after durable approved change.

Maintenance:

- periodic complete project rebuild;
- rebuild on incompatible embedding/chunking/index-format change;
- rebuild after integrity drift.

The full rebuild is authoritative for derived-index consistency.

### 7.7 Snapshot behavior

FAISS/BM25 operate on local materialization.

Drive stores durable snapshots and manifests.

Publishing a new generation is atomic at the manifest/pointer level:

    build candidate
    validate
    publish generation
    advance current -> candidate
    old current -> previous

Rollback restores previous as current without requiring a full corpus rebuild.

## 8. Execution Plane

### 8.1 PersistFlow core

PersistFlow exclusively owns:

- run;
- generation;
- checkpoint;
- claim;
- task continuity;
- reconciliation receipts;
- authoritative execution progression.

No other module may independently advance these concepts.

### 8.2 Resident Runtime

Resident Runtime owns:

- local durable jobs;
- local capabilities;
- security epoch enforcement;
- local execution;
- runtime audit;
- worker-facing execution adapters where local.

It does not own global project context or personal memory.

### 8.3 Indexing Runtime

Physical indexing and retrieval execute inside execution-plane, not in agent-platform.

Responsibilities:

- materialize project corpus/index snapshot locally;
- structural chunking;
- local embedding generation;
- BM25 build/update;
- FAISS build/update;
- index validation;
- snapshot publication;
- project retrieval execution;
- normalized evidence return.

Agent Platform decides policy and scope. Execution Plane performs CPU/disk/model work.

Conceptual commands:

    index_project(scope, revision, idempotency_key)
    retrieve(scope, query, filters, idempotency_key?)

### 8.4 SQLite/WAL authority

Initial authoritative execution state uses SQLite with WAL on the primary node.

Reasons:

- single authoritative primary;
- local-first;
- transactional state;
- no new permanent cloud database;
- simpler recovery than distributed consensus.

SQLite tables/domains remain separated by module responsibility even if they share the same database technology.

Postgres may be introduced later only through an adapter if real multi-primary/multi-writer requirements emerge. The initial architecture does not require it.

### 8.5 Primary-node topology

There is exactly one authoritative primary node.

It owns:

- PersistFlow SQLite/WAL;
- execution authority epoch;
- Resident Runtime authoritative local state;
- secret custody;
- local index working sets.

Remote workers are subordinate executors.

Examples:

- Railway workers;
- Hostinger workers;
- CloudShell workers;
- future ephemeral workers.

Workers never become execution authority by retaining local state.

### 8.6 Failover

Failover is manual in the initial architecture.

Recovery procedure concept:

1. fence or confirm loss of the old primary;
2. select replacement host;
3. restore the most recent consistent snapshot;
4. advance authority epoch;
5. restore services;
6. verify invariants and outstanding leases;
7. resume execution.

There is no automatic hot-standby election in the initial design.

### 8.7 Worker fencing

Authorized worker execution uses:

- run_id;
- task_id;
- lease_id;
- authority_epoch;
- short-lived scoped capability.

A worker with:

- expired lease;
- stale epoch;
- invalid capability;
- wrong task scope

cannot commit an authoritative result.

Static API keys alone are insufficient for authoritative worker mutation.

## 9. Secrets

Execution Plane owns secret custody through a Secrets Broker.

Initial storage:

- encrypted local vault;
- encryption anchored to the primary operating-system keystore where available;
- no repository-committed credentials;
- no distributed per-project .env sprawl as the canonical secret store.

Consumers receive only the least authority needed:

- short-lived credential;
- scoped capability;
- in-memory materialization where possible.

Agent Platform does not persist provider secrets.

Secrets are excluded from:

- logs;
- Context Store corpus;
- retrieval indexes;
- metrics;
- durable handoffs;
- ordinary snapshots.

## 10. Provider Gateway

Provider Gateway is the mandatory inference seam.

All model calls from platform-owned code pass through it.

Responsibilities:

- provider selection;
- model selection;
- routing;
- policy enforcement;
- fallback;
- budget/cost policy;
- semantic/exact cache policy;
- usage metrics.

It is architecturally stateless.

Any semantic/exact cache is derived and disposable.

It may not own:

- conversation authority;
- personal memory;
- execution history;
- project truth.

The semantic-cache implementation currently in ops-dev-orquestra migrates here if it remains useful after compatibility and test review.

## 11. Inter-plane contract

Agent Platform and Execution Plane communicate through a small versioned interface.

Initial transport:

- private HTTP/JSON;
- carried over Tailscale/private networking;
- transport is not the architecture.

Interface ownership:

- each producing module owns its schemas;
- consumers use clients/SDKs generated or maintained from those schemas.

Mutating commands require idempotency keys.

Illustrative operations include:

    submit_task(...)
    get_run_state(...)
    cancel_task(...)
    retrieve(...)
    index_project(...)

The final operation list is minimized during implementation. Internal SQLite, WAL and filesystem concepts are never exposed to Agent Platform.

MCP may exist as an agent-facing adapter, but MCP is not the authoritative internal platform protocol.

## 12. Deployment topology

Initial deployment favors logical isolation with physical simplicity.

Primary machine:

    primary node
      agent-platform service
      execution-plane service
      local retrieval/index working sets
      encrypted secret vault

The two top-level services run as isolated native OS services/processes.

Preferred supervision:

- native service manager;
- restart-on-failure;
- independent health checks;
- independent logs;
- explicit dependency ordering.

Examples:

- systemd on Linux;
- equivalent native Windows service supervision if the primary remains Windows.

Docker is used only where it materially simplifies a contained dependency. The architecture does not require “Docker for everything”.

Agent Platform and Execution Plane may initially coexist on the same machine while remaining separated by official interfaces.

## 13. Gabriel Ops

Gabriel Ops is an observability and command surface.

It reads projections from authoritative modules.

It may:

- show health;
- show runs;
- show workers;
- show index state;
- show retrieval/index freshness;
- show provider routing metrics;
- trigger commands through official interfaces.

It may not:

- mutate PersistFlow storage directly;
- maintain competing run state;
- own worker lease truth;
- own secret truth;
- own personal memory;
- own project context truth.

Deleting Gabriel Ops must never destroy platform authority.

## 14. Global architecture documentation

agent-platform is the authority for global architecture.

Canonical location:

    docs/architecture/

It contains:

- architecture constitution;
- global ADRs;
- authority matrix;
- dependency rules;
- migration/deprecation policy;
- future Spec Kit.

Other repositories document only local implementation details and reference the global constitution.

Memory ceases to be a home for platform architecture.

## 15. Branch and historical cleanup

Historical branches are not an operational architecture surface.

For obsolete architectural branches:

1. identify any still-useful decision/evidence;
2. move required decisions to canonical docs;
3. create a preservation tag when historical discoverability is valuable;
4. confirm no live deployment/PR/caller depends on the branch;
5. delete obsolete branch.

Git history remains the historical record.

The objective is a branch list that represents live work rather than a graveyard of competing designs.

## 16. Migration strategy

Migration uses a controlled strangler pattern.

No big-bang rewrite is required.

### Phase 0 — Architecture freeze

- freeze new control planes;
- freeze new databases/state authorities;
- freeze new memory/retrieval providers except work needed for the migration;
- keep RAGFlow serving disabled.

### Phase 1 — Inventory and dependency graph

- enumerate live repositories;
- enumerate live deployments;
- enumerate authorities;
- enumerate callers;
- enumerate workers;
- enumerate state stores;
- enumerate credential paths;
- enumerate branch/deployment dependencies.

Output must distinguish observed runtime truth from stale documentation.

### Phase 2 — Contracts and architecture tests

- introduce target interfaces;
- introduce forbidden-dependency checks;
- introduce exactly-one-authority checks where mechanically expressible;
- introduce project-scope retrieval tests;
- establish idempotency and compatibility tests.

### Phase 3 — Agent Platform consolidation

- establish target module layout inside ops-codex-os;
- isolate agent-os;
- establish context-gateway;
- establish context-store interface;
- establish provider-gateway;
- preserve compatibility only through registered shims.

### Phase 4 — Execution Plane consolidation

- consolidate Resident Runtime;
- migrate PersistFlow into resident-node;
- add indexing-runtime;
- add secrets-broker;
- normalize worker-adapters;
- establish SQLite/WAL authority.

### Phase 5 — Context Store and retrieval

- migrate durable Drive corpus/object behavior into context-store ownership;
- establish per-project layout;
- implement BM25 + FAISS;
- implement local embedding profile;
- implement current/previous generation snapshots;
- implement incremental + full rebuild paths.

### Phase 6 — Provider Gateway migration

- move semantic/exact cache behavior that remains justified;
- centralize model/provider calls;
- remove direct provider integrations from platform-owned callers.

### Phase 7 — Gabriel Ops simplification

- remove authority-like state;
- convert remaining data to projections;
- route mutations through official clients.

### Phase 8 — Caller and worker migration

- migrate all production callers;
- migrate remote workers;
- verify stale workers are fenced;
- remove direct storage access.

### Phase 9 — Duplicate-authority deletion

- delete legacy run-state writers;
- delete duplicate control-plane logic;
- delete duplicate secret paths;
- delete old retrieval-authority assumptions;
- remove migration shims whose gates pass.

### Phase 10 — Legacy repository archive

- archive ops-dev-orquestra;
- archive ops-persistflow-sandbox;
- preserve tags/history;
- remove live deployment dependencies.

### Phase 11 — Branch/docs/deployment cleanup

- consolidate architecture docs;
- migrate global docs out of Memory;
- delete obsolete branches after preservation gate;
- remove dead deployments and stale runtime config.

### Phase 12 — Final audit

- full integration test;
- production smoke;
- architecture graph verification;
- rollback verification;
- duplicate-authority scan;
- cross-project retrieval leakage test;
- final DoD check.

## 17. Migration shim contract

Every shim must have a machine-readable or mechanically inspectable record equivalent to:

    id:
    owner:
    purpose:
    allowed_callers:
    introduced_phase:
    removal_condition:
    latest_removal_phase:

No shim may have an indefinite removal condition.

Example:

    id: persistflow_legacy_adapter
    owner: execution-plane
    purpose: preserve old callers while execution-plane client migration completes
    allowed_callers: explicitly enumerated
    introduced_phase: 4
    removal_condition:
      - old callers == 0
      - execution-plane integration tests green
      - migrated state verified
      - rollback snapshot verified
    latest_removal_phase: 9

## 18. Architecture invariants

The Spec Kit must convert these rules into executable tests wherever feasible.

Required invariants include:

1. Agent Platform cannot import or access PersistFlow storage implementation.
2. Memory cannot depend on execution packages.
3. Gabriel Ops cannot own or directly write run state.
4. Resident Runtime cannot independently advance PersistFlow generations outside the PersistFlow interface.
5. Context Gateway cannot silently promote derived context into personal Memory.
6. Retrieval indexes cannot be treated as authoritative sources.
7. Object/corpus projection cannot overwrite authoritative Git source.
8. Semantic cache cannot answer live/current-state requests when policy requires fresh evidence.
9. Normal project retrieval cannot cross project index boundaries.
10. Project scope cannot be model-invented.
11. Workers with stale authority_epoch cannot commit authoritative results.
12. Workers with expired lease cannot commit authoritative results.
13. Agent Platform cannot persist provider secrets.
14. Platform-owned model calls cannot bypass Provider Gateway.
15. Derived indexes must be rebuildable from allowed sources/corpus.
16. Every authoritative domain has exactly one declared writer.
17. Every active migration shim has a finite removal gate.
18. Framework-specific types do not escape platform interfaces.

## 19. Luna executor contract

The future migration executor is expected to be capable of long autonomous execution, but it is not an architect.

The Spec Kit is authoritative.

The executor must not:

- redesign the target architecture;
- introduce new control planes;
- introduce new authorities;
- introduce new databases as architectural authorities;
- introduce new retrieval providers outside the approved scope;
- preserve legacy without a registered shim;
- modify the Spec Kit merely to make implementation pass;
- bypass a failed gate;
- claim completion without evidence.

For each phase the executor must:

1. read the phase contract;
2. verify entry conditions;
3. inspect current repository/runtime truth;
4. perform only allowed mutations;
5. test;
6. run architecture gates;
7. verify rollback artifact;
8. commit/checkpoint;
9. verify exit conditions;
10. continue automatically.

A failed automatic gate is not by itself a human gate.

The executor diagnoses and repairs failures within the approved design, then retries the gate.

## 20. Human-gate policy

Human architectural choices resolved in this design are not re-opened during migration unless current factual evidence proves the design impossible or unsafe.

Residual human gates are limited to cases such as:

- unavailable credential with no authorized alternative;
- irreversible/destructive action outside pre-authorized deletion policy;
- material new fact that invalidates a constitutional assumption;
- explicit cost-producing infrastructure not already authorized;
- external account action requiring human consent.

Ordinary implementation ambiguity is resolved by the Spec Kit and implementation plan, not by repeatedly asking the user.

## 21. Checkpoint and drift policy

Long execution is split into durable generations/checkpoints.

A checkpoint records at minimum:

- target phase;
- repository refs/commits;
- completed gates;
- current shims;
- pending gates;
- migration receipts;
- rollback artifact;
- observed architecture drift.

After each checkpoint the executor compares current state against:

- target topology;
- authority matrix;
- deletion map;
- forbidden dependency graph.

Functional success does not override architecture drift.

## 22. Rollback

Rollback is phase-local.

The migration does not rely on “restore the entire old architecture”.

Every phase must finish in an internally valid state and record the prior valid checkpoint.

Rollback requirements include:

- data backup where state is mutated;
- schema migration reversal or forward-fix strategy;
- previous index generation;
- preserved legacy adapter until its removal gate;
- state migration receipt;
- authority epoch correctness after primary-node recovery.

## 23. Definition of Done

The architecture migration is complete only when all of the following are true:

- target repositories/modules are active;
- ops-codex-os has completed its transition to agent-platform naming and responsibility;
- resident-node has completed its transition to execution-plane naming and responsibility;
- every authoritative domain has exactly one writer;
- all production callers use approved interfaces;
- Agent Platform is free of operational authority storage;
- Execution Plane owns PersistFlow/Resident/indexing/secrets responsibilities as specified;
- Context Store is Drive-backed with per-project isolation;
- BM25 + FAISS hybrid retrieval is active behind the Context Gateway;
- local embedding profile is versioned and rebuildable;
- current/previous index generations work and rollback is verified;
- project retrieval leakage tests pass with zero cross-project leakage;
- Provider Gateway is the mandatory model seam for platform-owned calls;
- duplicate control planes are removed;
- deprecated shims whose removal gates passed are deleted;
- ops-dev-orquestra is archived;
- ops-persistflow-sandbox is archived;
- Gabriel Ops contains no authoritative state;
- Memory contains personal canonical context, not global platform architecture;
- obsolete architectural branches are cleaned according to preservation policy;
- stale global architecture docs are superseded;
- forbidden dependency edges equal zero;
- duplicate authority paths equal zero;
- execution fencing tests pass;
- integration and end-to-end tests pass;
- production smoke passes;
- rollback paths are verified;
- final architecture graph matches the approved Spec Kit.

## 24. Spec Kit deliverables

After this design is approved, the implementation-planning stage must materialize a versioned Spec Kit under agent-platform architecture documentation.

Required deliverables:

    docs/architecture/spec-kit/
      00-constitution.md
      01-current-architecture.md
      02-target-architecture.md
      03-authority-matrix.md
      04-repository-map.md
      05-dependency-graph.md
      06-deletion-map.md
      07-migration-phases.md
      08-architecture-gates.md
      09-rollout-rollback.md
      10-acceptance-criteria.md
      11-definition-of-done.md
      12-executor-contract.md

The Spec Kit must contain no unresolved architectural placeholders.

Implementation-specific facts discovered during inventory must be recorded as evidence, not used to silently redesign the approved target.

## 25. Explicitly deferred items

The following are outside the initial architecture and do not block this migration:

- RAGFlow runtime deployment;
- LangGraph adoption;
- distributed multi-primary execution;
- automatic leader election;
- permanent cloud database;
- hot standby;
- full event-sourced rewrite;
- provider-specific retrieval architecture.

These may be reconsidered only after the consolidated architecture is operational and measured evidence justifies them.

## 26. Final design statement

The target platform is intentionally boring:

- few repositories;
- deep modules;
- one writer per state domain;
- small interfaces;
- deterministic scope;
- local-first execution;
- Drive-backed retrieval corpus;
- derived indexes that can be deleted;
- stateless agent/model control plane;
- one authoritative execution primary;
- explicit worker fencing;
- observability without authority;
- personal context separated from project context;
- frameworks hidden behind owned contracts;
- migration compatibility with mandatory deletion gates.

The architecture should make the correct ownership obvious from topology and interfaces rather than requiring prose to explain why five different systems are “not the authority”.
