# Infra Workbench — Langflow Visual Control Plane Design

**Status:** Written design approved in conversation; awaiting written-spec review  
**Date:** 2026-09-27  
**Bootstrap repository:** `menezes-platform/ops-codex-os`  
**Canonical repository after written-spec approval:** `menezes-platform/ops-infra-workbench`  
**Primary visual foundation:** Langflow upstream, pinned  
**Execution authority:** PersistFlow  
**Execution providers:** Resident Node, PersistFlow Sandbox, Railway workers, browser providers, MCP adapters, Dev-Orquestra-managed agents  
**Durable sources of truth:** Git, PersistFlow authority/receipts, provider-local authoritative state, content-addressed object store, validated Memory/docs, Engram for episodic context

> Bootstrap note: the canonical `ops-infra-workbench` repository does not yet exist. The architectural process explicitly forbids creating a new external project before the written spec is reviewed and approved. This document is therefore committed temporarily in `ops-codex-os`. The first implementation-plan phase creates `menezes-platform/ops-infra-workbench`, establishes its durable project documents, and copies this approved design there as canonical project history.

## 1. Purpose

Build a 24/7 visual infrastructure workbench whose product is a single live canvas. The canvas is simultaneously:

- infrastructure topology;
- flow editor;
- live runtime view;
- debugger;
- trace explorer;
- incident-impact viewer;
- bounded operational console.

The Workbench must make distributed infrastructure understandable and operable without creating a second execution authority. It must make recurrent failures such as HTTP 429, timeouts, MCP transport disconnects, stale workers, browser affinity loss, and unknown outcomes diagnosable from evidence rather than guesswork.

The Workbench is not a replacement for PersistFlow, Resident Node, Dev-Orquestra, or provider-local ownership. It observes, models, compiles intent, requests execution, and projects evidence. PersistFlow remains the authority for effectful distributed execution.

## 2. Success criteria

The design is successful when all of the following are true:

1. A human can log in with a file-based RSA credential and use one live canvas to understand real infrastructure state.
2. Real resources are discovered automatically, normalized, and represented by stable identities.
3. A user can assemble flows visually without giving Langflow direct operational credentials.
4. Promoted OPS flows are immutable, Git-versioned FlowSpecs compiled deterministically into immutable ExecutionPlans.
5. Any effectful operation passes through PersistFlow policy, routing, generation, lease, idempotency, recovery, and receipt semantics.
6. Runtime state, traces, incidents, and receipts are projected back onto the same nodes and edges used for design.
7. Failures are classified precisely; observation uncertainty is never presented as certainty.
8. `UNKNOWN_OUTCOME` is reconciled before retry so effectful operations are not duplicated silently.
9. New providers may appear automatically but cannot become OPS-eligible automatically.
10. The complete Workbench can be unavailable during an existing execution without causing that execution to fail; after restart the Workbench can reconcile and reconstruct the state it needs.
11. The system has measurable security, failure-injection, restore, and end-to-end evidence for Definition of Done.

## 3. Architectural principles and invariants

### 3.1 Authority invariants

**AUTH-01 — PersistFlow authority.** PersistFlow remains authoritative for runs, generations, claims, leases, routing, effective execution policy, checkpoints, idempotency, recovery, consumed approvals, and effect receipts.

**AUTH-02 — Observation is not authority.** Workbench state may be observed or derived, but no Workbench projection can override an authoritative source.

**AUTH-03 — Intent is not execution.** A canvas action produces an intent. It is not considered executed until the authoritative execution path reports the effect according to capability semantics.

**AUTH-04 — Trace is not receipt.** OpenTelemetry traces describe the technical path. PersistFlow receipts prove authoritative effect/result state.

**AUTH-05 — Provider self-report is not trust.** Discovery and advertised capability never grant OPS authority.

**AUTH-06 — Git is version authority.** FlowSpecs, capability definitions, provider approvals, policies, schemas, canonical layouts, infrastructure desired state, and Workbench source are versioned in Git.

**AUTH-07 — Provider-local state remains local authority.** Browser cookies/profiles, local jobs, local filesystem state, MCP credential ownership, and similar state remain authoritative at the owning provider.

### 3.2 Safety invariants

**SAFE-01.** Langflow never receives operational credentials or direct tailnet access.

**SAFE-02.** `workbench-sync` never becomes an alternate execution engine.

**SAFE-03.** `workbench-runner` executes only deterministic pure operations from an explicit allowlist and has no operational network, shell, tailnet, browser, external filesystem, or provider credentials.

**SAFE-04.** Any operation involving network I/O, MCP, browser, shell, external filesystem, Git mutation, deployment, or other external effect is classified as effectful and goes through PersistFlow.

**SAFE-05.** R3 operations require one-shot approval bound to the exact operation, target, input, generation, and ExecutionPlan.

**SAFE-06.** Unknown outcomes never retry blindly.

**SAFE-07.** Missing execution authority fails closed for new writes.

**SAFE-08.** Missing observability degrades visibility, not already-running execution.

**SAFE-09.** Provider identity mismatch causes quarantine.

**SAFE-10.** No component gains privilege because another component is unavailable.

### 3.3 Product invariants

**UX-01 — One canvas.** Topology, flow design, runtime state, tracing, incident impact, and control remain views of one canvas, not separate dashboards.

**UX-02 — Stable node identity.** The same real resource keeps the same canonical identity across Design, Live, Trace, and Impact lenses.

**UX-03 — Layout is presentation.** Moving a node changes layout only; it never changes authoritative resource state.

**UX-04 — Intellectual honesty.** `UNKNOWN`, `STALE`, `DERIVED`, `OBSERVED`, and `AUTHORITATIVE` are visually distinct. The UI never paints stale data as current, correlation as certainty, or unreceipted effect as completed.

## 4. System topology

The system is organized into five planes.

```text
┌─────────────────────────────────────────────────────────────┐
│                     EXPERIENCE PLANE                        │
│                                                             │
│  Langflow upstream + extensions + frontend patch layer     │
│                                                             │
│          SINGLE LIVE / INFINITE CANVAS                      │
│  topology + flows + live state + debug + control           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     WORKBENCH PLANE                         │
│                     Railway 24/7                            │
│                                                             │
│  workbench-gateway     auth / sessions / public ingress    │
│  langflow              visual editor/canvas foundation      │
│  workbench-sync        discovery / projection / tracing     │
│  workbench-runner      deterministic SAFE_LOCAL compute     │
│  PostgreSQL            editor + reconstructible read-model  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     AUTHORITY PLANE                         │
│                                                             │
│              PersistFlow / Hostinger                        │
│                                                             │
│ runs · generations · leases · claims · routing · policy    │
│ retries · checkpoints · approvals · receipts               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     EXECUTION PLANE                         │
│                                                             │
│ Resident Node        Railway Workers       Sandbox          │
│ Browser Providers    MCP adapters          Dev-Orquestra    │
│ local machines       ephemeral workers     agent sessions   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  DURABILITY / TRUTH PLANE                   │
│                                                             │
│ Git              Object Store         Engram / Memory       │
│ code/specs       blobs/evidence       episodic / canonical  │
│ FlowSpecs        trace bundles        contextual knowledge  │
│ policies         artifacts                                  │
└─────────────────────────────────────────────────────────────┘
```

## 5. Hosting and environments

Create one dedicated Railway project named `infra-workbench` after this written design is approved.

Initial services:

- `workbench-gateway`
- `langflow`
- `workbench-sync`
- `workbench-runner`
- PostgreSQL

Environments:

- preview/PR when useful;
- staging;
- production.

Each environment has isolated databases and secrets.

Staging is LAB-only with test/quarantine providers and no real production OPS credentials. Production supports LAB and OPS with approved policies/providers.

PersistFlow remains hosted separately on Hostinger. Hostinger remains a durable HTTP/control-plane host and must not become a browser, untrusted shell, Docker/build, Langflow, or heavy-worker host.

## 6. Network model

The network is hybrid:

- private infrastructure uses Tailscale/tailnet transport;
- public/cloud/SaaS uses authenticated HTTPS/OAuth/API mechanisms;
- `workbench-sync` is the controlled Workbench bridge to private infrastructure;
- Langflow does not directly join the tailnet;
- Tailscale is transport, not sole authorization.

Interaction paths:

```text
READ / PROBE
Langflow → Workbench API / Sync → Adapter → Target
```

```text
WRITE / EXECUTE
Langflow → Workbench API / Sync → PersistFlow → Provider/Adapter → Target → Receipt
```

If Sync is down, new Workbench interactions fail or degrade, but ongoing authority-plane/provider execution continues.

## 7. Human identity and authentication

### 7.1 Trust chain

```text
Owner Root RSA
hardware non-exportable
        │ certifies
        ▼
Delegated Workbench Issuer
protected on Resident Node
        │ signs
        ▼
session.workbench-auth
        │ upload
        ▼
workbench-gateway
```

The Owner Root has a separately stored encrypted offline recovery backup. Root private material never enters the Workbench, Railway, Hostinger, GitHub, Langflow, or Workbench databases.

The Root certifies/renews delegated issuers. Routine sessions are signed by a delegated issuer, not by the Root.

### 7.2 Session file

A `.workbench-auth` envelope contains signed identity/session claims and metadata. It contains no private key.

Gateway validation includes:

- signature;
- `kid`;
- issuer;
- audience;
- validity window;
- `jti`;
- role/scope;
- LAB or OPS mode.

The session file is read in memory, verified, exchanged for a short HttpOnly/Secure browser session, and discarded. The raw file/token is never written to database, logs, trace attributes, evidence, browser localStorage, or other durable state.

TTL is explicit deployment configuration rather than a hard-coded architectural constant. Production must refuse ambiguous/unbounded session configuration.

LAB session files may be reused during their valid lifetime. OPS session files are one-shot at login: the first successful exchange consumes the `jti`. Reuse fails closed.

### 7.3 R3 step-up approval

High-impact R3 actions require a separate one-shot `.approval` file.

Challenge binding includes at minimum:

- approval ID;
- flow ID;
- flow revision;
- run generation;
- step ID;
- target;
- input SHA-256;
- ExecutionPlan SHA-256;
- expiration.

The delegated issuer signs that exact challenge. Gateway verifies the chain and exact binding, consumes the approval identifier, records approval audit evidence, and allows PersistFlow to resume only that exact paused action/generation.

Any change to target, input, plan, generation, or validity invalidates the approval.

## 8. Service-to-service identity and secret custody

New Workbench components use individual asymmetric service identities with distinct keys, scopes, and rotation.

Existing protocols remain behind adapters where they are already authoritative and safe:

- PersistFlow fleet HMAC;
- Sandbox broker HMAC;
- Resident Node current authentication;
- SaaS OAuth/API credentials.

There is no Workbench master secret.

Secret custody follows ownership:

- Railway secret store: Workbench service secrets only;
- Hostinger: PersistFlow/Sandbox authority credentials;
- Resident Node: delegated issuer private key and local-machine/browser/desktop secrets;
- MCP/SaaS adapters: their own OAuth/API credentials.

`workbench-sync` is not a universal vault. It receives only the minimum credential necessary for a given adapter or, preferably, opaque references and sanitized projections.

A centralized vault is explicitly deferred until operational evidence shows it is needed.

## 9. Langflow integration model

Langflow is upstream-pinned and reused as the visual/editor foundation.

The Workbench uses three integration layers:

1. official Langflow extensions/components where supported;
2. a Workbench client SDK/API layer;
3. a minimal, versioned, rebaseable frontend patch layer for capabilities upstream extension points cannot provide.

Patches are permitted only for canvas experience needs such as:

- live node state;
- operational edge semantics;
- custom inspector;
- trace/impact highlighting;
- incident markers;
- receipts;
- progressive disclosure;
- edge bundling.

The backend is not conceptually forked. Upstream changes are adopted only through explicit upgrade branches and compatibility testing. There is no automatic Langflow update.

## 10. Canvas model

### 10.1 Semantic layers

One canvas contains three semantic layers:

**Infrastructure Layer**

Real resources projected from discovery:

- MCP connections;
- machines;
- workers;
- services;
- browsers;
- agent sessions;
- providers.

**Flow Layer**

Editable intent:

- capability nodes;
- transforms;
- conditions;
- intents;
- agent tasks;
- approvals.

**Runtime Overlay**

Non-editable live projection:

- health;
- latency;
- traces;
- running steps;
- incidents;
- receipts;
- provider routing.

### 10.2 Lenses

The same canvas supports lenses that alter emphasis, not identity:

- `DESIGN` — editable flow intent;
- `LIVE` — current state;
- `TRACE` — exact route of a selected execution;
- `IMPACT` — dependencies/affected resources of a selected incident/resource.

### 10.3 Progressive disclosure

Scale is handled inside the single canvas:

- L0 — system/service clusters;
- L1 — individual resources;
- L2 — sessions/tools/spans/jobs/details.

Semantic clusters may be derived from real relations such as:

- `HOSTS`;
- `PROJECT`;
- `PROVIDER`;
- `MACHINE`;
- `CAPABILITY_DOMAIN`;
- `FLOW`;
- `INCIDENT`.

Focus mode dims unrelated nodes while preserving location and identity. Search highlights matching resources and connected flows in place. Repeated edges may be bundled and expanded on demand.

### 10.4 Layout persistence

Operational/personal layout state is autosaved in Workbench Postgres:

- positions;
- zoom;
- groups;
- collapsed state;
- lens;
- filters.

Layout scopes may include:

- global;
- project;
- flow;
- incident.

A user may explicitly publish a curated/canonical layout to Git. Flow logic and layout are separate: moving or deleting a layout does not mutate FlowSpec, topology, or runtime authority.

## 11. Resource identity and graph model

The Workbench assigns deterministic canonical resource IDs and preserves source IDs/aliases.

Conceptual format:

```text
urn:gabriel:<domain>:<kind>:<stable-identity>
```

Examples:

```text
urn:gabriel:railway:service:<id>
urn:gabriel:resident-node:desktop-primary
urn:gabriel:mcp:connection:<id>
urn:gabriel:browser-session:<id>
```

Logical resources and source representations are distinct.

No fuzzy-name auto-merge is permitted. Identity merge requires explicit evidence such as:

- declared stable ID;
- trusted registration;
- versioned alias mapping;
- attested identity.

Uncertain matches remain separate and may be marked `POSSIBLE_DUPLICATE`.

Graph relations are typed, including:

- `HOSTS`;
- `OWNS_SESSION`;
- `PROVIDES`;
- `CONNECTS_TO`;
- `EXECUTES_ON`;
- `AUTHENTICATES_WITH`;
- `DEPENDS_ON`;
- `ROUTES_TO`;
- `OBSERVES`;
- `DERIVED_FROM`.

The V1 graph read-model is relational Postgres using tables such as:

- `resources`;
- `resource_aliases`;
- `resource_edges`;
- `resource_observations`.

Recursive SQL is sufficient for V1. No Neo4j, Kafka, Redis, or Elasticsearch is added without demonstrated need.

## 12. `workbench-gateway`

The Gateway is the only public Workbench ingress.

Responsibilities:

- `.workbench-auth` verification;
- session creation/renewal/expiry;
- OPS one-shot `jti` consumption;
- `.approval` verification and one-shot consumption;
- CSRF/origin/session protections;
- login rate limits;
- authenticated reverse proxying;
- minimal actor/session context propagation;
- security audit events.

It is not responsible for:

- FlowSpec semantics;
- capability semantics;
- provider routing;
- OAuth ownership for operational services;
- incident correlation;
- execution.

It stores only public verification material/trust configuration, not Owner Root private material.

## 13. `workbench-sync`

`workbench-sync` is the sensory/projection plane.

Internal modules:

- Discovery Manager;
- Adapter Host;
- Reconciliation Engine;
- Resource Graph Projector;
- Capability Projector;
- Trace Normalizer;
- Incident Correlator;
- Event Stream;
- Read API.

It answers questions such as:

- what exists;
- what is observable now;
- what changed;
- how resources relate;
- where a trace failed.

It does not decide:

- whether an effect is authorized;
- which runtime provider is eligible;
- whether a job has authoritatively completed.

All state in its graph/read-model is reconstructible from authoritative/current sources plus versioned configuration.

## 14. Adapter SDK

Adapters normalize heterogeneous systems into stable contracts.

Core read-side interface:

```text
discover()
probe()
listCapabilities()
reconcile()
executeRead()
sanitize()
describeHealth()
```

Effectful adapters may provide execution hooks only as translation endpoints for already-authorized PersistFlow work. They never independently grant authority.

Initial adapter families:

- PersistFlow;
- Resident Node;
- Railway;
- Sandbox;
- GitHub/Git;
- generic MCP;
- browser provider;
- Dev-Orquestra;
- Engram;
- object store.

The SDK standardizes:

- timeouts;
- retry hints;
- rate-limit metadata;
- redaction;
- OpenTelemetry propagation;
- resource identity mapping;
- health/error classification;
- protocol/version negotiation.

## 15. `workbench-runner`

The Runner is a deliberately constrained deterministic compute service for `SAFE_LOCAL` flow steps.

Allowed categories include:

- JSON map/filter;
- templates;
- conditions;
- schema validation;
- normalization;
- hashing;
- bounded encoding/decoding.

It must not have:

- operational outbound network access;
- DNS access beyond what is strictly required by the deployment platform, with no route to operational targets;
- shell/child-process capability;
- external host filesystem access;
- tailnet membership;
- browser sessions;
- MCP/SaaS tokens;
- SSH/deploy credentials.

Arbitrary JavaScript/Python is not a SAFE_LOCAL primitive. Arbitrary code belongs in the Sandbox execution path through PersistFlow.

Negative isolation tests are required for DoD.

## 16. PostgreSQL domains

The same PostgreSQL technology may host two logically isolated domains.

### 16.1 Langflow state

Owned by upstream/editor concerns:

- drafts;
- projects;
- editor state;
- Langflow metadata.

### 16.2 Workbench state

Contains reconstructible/read-model and UX state:

- resources;
- aliases;
- edges;
- observations;
- capability snapshots;
- provider projections;
- trace spans;
- incidents;
- layouts;
- session/revocation metadata;
- approval metadata;
- flow projections;
- execution projections;
- rejected/poison-event evidence.

Losing Workbench read-model data must never destroy execution truth.

## 17. Canonical contracts

Contracts are schema-first and versioned under the future Workbench repository.

Use:

- OpenAPI for control/query APIs;
- JSON Schema for FlowSpec, ExecutionPlan, Capability, Provider, Receipt, Approval, ContextBundle, events, and related wire models.

Generated artifacts:

- TypeScript types;
- runtime validators;
- clients;
- documentation;
- test fixtures.

CI blocks drift between schemas and generated code and blocks breaking contract changes without an explicit version bump/migration path.

Runtime data is schema-validated before canonical serialization or hashing.

## 18. Flow lifecycle

States include:

- `DRAFT`;
- `VALIDATING`;
- `VALIDATED`;
- `PROMOTION_PENDING`;
- `PROMOTED`;
- `DEPLOYED`;
- `DRIFTED`;
- `REVOKED`.

A promoted revision is immutable. Editing a promoted flow creates a new draft/revision.

### 18.1 Draft and validation

Draft state is edited in Langflow. Workbench components carry canonical references rather than arbitrary credentials.

Validation exports/builds a FlowSpec and classifies components:

- `TRUSTED_CANONICAL`;
- `SAFE_LOCAL`;
- `LAB_ONLY`;
- `UNMANAGED_IO`;
- `UNKNOWN`;
- `FORBIDDEN`.

OPS promotion rejects any `LAB_ONLY`, `UNMANAGED_IO`, `UNKNOWN`, or `FORBIDDEN` node.

### 18.2 Git promotion

LAB may automatically create branch/commit artifacts.

OPS promotion always opens a PR. OPS does not write directly to `main`.

Promotion requires schema validation, policy checks, deterministic compile checks, security checks, CI, review, and merge.

A promotion manifest binds at minimum:

- flow ID;
- revision;
- Git SHA;
- FlowSpec SHA-256;
- ExecutionPlan SHA-256;
- compiler SHA;
- capability manifest SHA;
- policy schema SHA.

## 19. Flow compiler and ExecutionPlan

The compiler is a deterministic package/CLI in `packages/flow-compiler`, not a network service.

Pipeline:

```text
FlowSpec
  ↓ parse
schema validate
  ↓
canonicalize
  ↓
classify nodes
  ↓
resolve capability contracts
  ↓
validate promotability
  ↓
build dependency DAG
  ↓
classify risk
  ↓
ExecutionPlan
  ↓
canonical serialize
  ↓
SHA-256
```

Compiler inputs are versioned/static:

- FlowSpec;
- capability catalog revision;
- policy schema revision;
- compiler revision.

Live worker health, queue depth, CPU, and current latency are forbidden compiler inputs.

Same input set must produce byte-for-byte identical ExecutionPlan and SHA-256 across supported CI runners.

The ExecutionPlan is not automatically authorized merely because it is valid. PersistFlow performs runtime policy and eligibility checks.

## 20. Capability model

Capability semantics live in Git.

Each capability defines:

- stable name/version;
- input schema;
- output schema;
- effect classification;
- minimum risk floor;
- retry semantics;
- reconciliation semantics;
- possible explicit compensation;
- provider classes;
- idempotency semantics.

This is where operational behavior such as “respect Retry-After” or “reconcile before retry after an unknown outcome” belongs.

## 21. Provider model

Provider trust and provider availability are independent.

Lifecycle:

```text
DISCOVERED
  ↓
QUARANTINED
  ↓
LAB_ELIGIBLE
  ↓
OPS_APPROVED
```

Additional runtime/admin states may include:

- `DRAINED`;
- `REVOKED`;
- `INCOMPATIBLE`.

The Git Provider Registry defines trusted identity, environment, supported/allowed capability ranges, and approval state.

Runtime observations define liveness/health/capacity.

Rule:

```text
registered != online != healthy != eligible
```

PersistFlow alone decides runtime execution eligibility.

## 22. Sync and reconciliation

Fast path:

- events;
- SSE;
- heartbeats;
- supported webhooks.

Correctness path:

- mandatory periodic reconciliation.

Observation metadata includes:

- event/source ID;
- source sequence;
- observation timestamp;
- TTL/staleness;
- resource;
- event type.

Sync deduplicates events, detects sequence gaps, and performs targeted reconciliation.

A missing event is recoverable by reconciliation. There is no Kafka/event broker requirement in V1.

On Sync restart:

1. load versioned configuration;
2. query authoritative sources;
3. reconstruct resources/edges;
4. reconcile active runs;
5. restore cursors where valid;
6. detect gaps;
7. resume SSE.

Existing runs are never recreated because a projection was lost.

## 23. Runtime execution

OPS does not send raw Langflow graphs to PersistFlow.

```text
Canvas
  ↓ intent
Sync/API
  ↓ resolve promoted revision
Verified immutable ExecutionPlan
  ↓
PersistFlow
  ↓ authority + policy + routing
Provider
  ↓ effect
Receipt/evidence
  ↓
Sync projection
  ↓
Canvas
```

PersistFlow may reject a syntactically valid promoted plan because current policy/capacity/eligibility does not allow execution.

### 23.1 Runtime routing

Provider selection uses current authority/runtime information such as:

- approved providers;
- heartbeat freshness;
- capability eligibility;
- concurrency;
- capacity;
- affinity;
- policy.

The compiler does not choose a live worker.

The Sync does not choose a live worker.

The Canvas only visualizes the decision.

## 24. Queue and concurrency

Workbench queue state is UX projection only.

PersistFlow remains authoritative for:

- claims;
- leases;
- generations;
- idempotency;
- routing;
- effective concurrency.

FlowSpec may declare constraints such as `maxConcurrentRuns` or `parallelSafe`; the compiler validates dependency structure, but PersistFlow decides actual runtime concurrency.

UI retries never bypass PersistFlow generation/lease/idempotency semantics.

## 25. Failure and retry model

Typed failure classes include:

- `TRANSIENT`;
- `PERMANENT`;
- `POLICY_BLOCK`;
- `AUTH_REQUIRED`;
- `APPROVAL_REQUIRED`;
- `CAPACITY`;
- `STALE_GENERATION`;
- `UNKNOWN_OUTCOME`.

FlowSpec may make retry policy stricter than the capability definition, never looser.

### 25.1 `UNKNOWN_OUTCOME`

When an effect may have occurred but acknowledgement is missing:

```text
UNKNOWN_OUTCOME
  ↓
capability-specific reconciliation against target
  ↓
effect exists?
  ├─ yes → record/attach authoritative evidence
  └─ no/known safe → policy-aware retry
```

If the outcome cannot be determined, enter a manual recovery state rather than double-execute.

### 25.2 Partial completion and compensation

Flows may end in first-class `PARTIALLY_COMPLETED`.

Compensation is explicit and capability-defined only when a real inverse exists. A failed compensation is `COMPENSATION_FAILED`; it does not erase evidence of the original effect.

## 26. Risk policy

Risk levels:

**R0 — READ**

Examples: health, inspect, list, metrics, sanitized logs.

May be automatic in LAB/OPS when allowed.

**R1 — reversible/low-risk**

Examples: disposable worker restart, create branch/PR/sandbox, bounded browser test.

May auto-execute when an approved promoted FlowSpec authorizes it.

**R2 — guarded mutation**

Examples: commit to a real repo, persistent service config change, shell on a persistent machine, authenticated browser action with external effect.

Requires explicit policy and may require human approval depending on target/context.

**R3 — sensitive/high-impact**

Examples: production deploy, merge, delete, credential rotation, auth/policy changes, destructive/irreversible actions.

Always requires step-up human approval.

Effective permission is the intersection of:

```text
Capability Catalog
∩ Provider Approval
∩ FlowSpec Policy
∩ PersistFlow Global Policy
∩ Session Mode
```

Any deny wins.

## 27. Browser Lab semantics

The browser session remains owned by its provider.

Workbench stores only opaque references and sanitized metadata:

- `session_ref`;
- provider identity;
- tab references;
- health;
- allowed display metadata.

It does not store browser cookies, profiles, localStorage/session tokens, or authenticated session secret material.

Stateful operations require provider affinity. If the owning provider is unavailable, the session becomes unavailable. Session migration is not implicit and is a future explicit sensitive capability.

## 28. MCP Lab semantics

MCP credentials remain owned by the adapter/provider.

Workbench stores:

- `connection_ref`;
- server identity;
- tools/capabilities;
- health;
- latency;
- last failure class.

Read/probe path:

```text
Canvas → Sync → MCP Adapter → MCP Server
```

Effectful tool path:

```text
Canvas → Sync → PersistFlow → MCP Adapter → MCP Server → Upstream → Receipt
```

Tool discovery never grants authority. Unknown tools are quarantined/LAB-only until mapped to canonical capability semantics.

Reconnect, authentication, refresh, transport, backoff, and rate-limit logic belong to the adapter/provider, not Langflow.

## 29. Agent Lab semantics

Dev-Orquestra retains ownership of:

- agent session lifecycle;
- task/session identity;
- repo/ref/worktree;
- redispatch/recovery;
- agent runtime status.

Workbench creates intents and visualizes sessions, traces, outputs, and receipts.

An agent saying an effect occurred is not proof. Real external effects go through PersistFlow and are confirmed by receipts/evidence.

## 30. Context and memory

There is no new “Workbench Memory”.

Authority remains separated:

- Engram: episodic history/conversations/decisions;
- validated Memory/docs: canonical durable knowledge/policy;
- Git: code/spec/versioned state;
- PersistFlow: execution/checkpoints/receipts.

Agent output lifecycle:

```text
EPHEMERAL → CANDIDATE → VALIDATED → CANONICAL
```

No agent output becomes canonical memory automatically.

### 30.1 ContextBundle

A reusable Context Builder creates reproducible sanitized bundles from authorized references:

- task;
- Git SHA;
- FlowSpec/ExecutionPlan;
- Engram refs;
- Memory/docs refs;
- receipt refs;
- capability snapshot;
- policy snapshot.

Complete bundles are encrypted and stored in the content-addressed object store. Postgres stores metadata only.

Bundles may contain opaque `connection_ref`, `session_ref`, `artifact_ref`, Git SHA, and receipt refs. They must not contain OAuth tokens, cookies, private keys, SSH keys, browser profiles, or MCP API keys.

## 31. Object store

Use the existing content-addressed object-store model for large immutable data:

- evidence;
- screenshots;
- HAR files;
- large logs;
- diagnostic bundles;
- ContextBundles;
- snapshots;
- runtime artifacts.

Universal reference:

```text
sha256:<64-hex>
```

Git stores canonical specs/plans/manifests. The object store stores immutable blobs/evidence. Receipts reference both where relevant.

## 32. Observability

OpenTelemetry is the canonical technical tracing format.

Propagate OTel context where supported and adapt legacy events where not.

Correlation fields include:

- `trace_id`;
- `span_id`;
- parent;
- `run_id`;
- `flow_id`;
- revision;
- `execution_plan_sha`;
- `step_id`;
- `provider_id`;
- capability;
- mode.

Hot/recent queryable state lives in Postgres.

Large/cold evidence goes to the object store.

### 32.1 Evidence classification

Every diagnostic claim is classified as:

- `SOURCE`;
- `OBSERVED`;
- `DERIVED`;
- `AUTHORITATIVE`.

The Incident Correlator may derive probable root cause with confidence/evidence. It may not rewrite authoritative run/provider state.

## 33. Incident correlation and notifications

Sync correlates multiple symptoms using:

- traces;
- resource graph relationships;
- time windows;
- shared upstream/provider/credential/capability relations.

Incidents deduplicate repeated symptoms.

Attention policy is based on severity, impact, duration, authority impact, and whether a human action is required.

Suggested semantic classes:

- `INFO` — visible in Workbench;
- `DEGRADED` — visually highlighted without interruption by default;
- `ACTION_REQUIRED` — notify because concrete human action is required;
- `CRITICAL` — notify immediately for authority/security/production-critical impact.

External notification channels are adapters. Incident logic is not embedded separately into each channel.

## 34. Remediation

The Incident Correlator never executes commands directly.

A correlated incident may select a matching already-promoted remediation FlowSpec:

```text
Incident
  ↓
Correlator
  ↓
Matching promoted remediation FlowSpec
  ↓
Verified ExecutionPlan
  ↓
PersistFlow
  ↓
R0-R3 policy
```

Circuit breakers include:

- max remediation attempts per incident/root cause;
- cooldown;
- same-root-cause dedupe;
- recursion-loop prevention.

R3 remediation pauses for step-up approval.

Failed remediation leaves the incident open with evidence and enters `AUTO_REMEDIATION_FAILED`; it does not loop indefinitely.

## 35. Rate-limit protection

HTTP 429 is treated as a first-class diagnostic/failure state.

If upstream returns `Retry-After`:

1. record rate-limit metadata;
2. open a scoped circuit breaker;
3. suppress aggressive retries;
4. schedule bounded reprobe;
5. preserve the fact that upstream rate limit may be the root cause while intermediate transport remains healthy.

Circuit scope may be:

- connection;
- tool;
- upstream;
- credential;
- provider.

Circuit states:

- `CLOSED`;
- `OPEN`;
- `HALF_OPEN`.

Retries use exponential backoff with jitter, bounded maximum delay, and retry budgets.

Retry budgets may be scoped by provider, connection, upstream, capability, or caller/session.

Auth failures never enter a blind retry loop.

## 36. Failure semantics and degraded modes

### 36.1 Resource state

Avoid one universal boolean. Relevant states include:

- `UNKNOWN`;
- `DISCOVERED`;
- `HEALTHY`;
- `DEGRADED`;
- `STALE`;
- `OFFLINE`;
- `BLOCKED`;
- `DRAINED`;
- `INCOMPATIBLE`;
- `QUARANTINED`;
- `REVOKED`.

Trust, availability, health, and eligibility are separate dimensions.

### 36.2 `UNKNOWN` versus `OFFLINE`

A timeout yields `UNKNOWN`, not automatically `OFFLINE`.

Offline requires stronger evidence such as authoritative platform state, repeated failed probes plus expired heartbeat/lease semantics, or explicit connection refusal according to provider contract.

### 36.3 Staleness

Every dynamic observation has timestamp and TTL. TTL is resource-type policy/configuration.

A stale observation is visibly stale and does not remain green indefinitely.

### 36.4 Component failure boundaries

**Gateway failure**

Blocks new UI/login/approval interactions. Does not stop existing PersistFlow/provider execution.

**Langflow failure**

Blocks/impairs visual editing and canvas interaction. Does not stop existing execution.

**Sync failure**

Stops live projections/new read probes/new Workbench intents and incident correlation. Does not stop ongoing PersistFlow/provider jobs.

**Runner failure**

Blocks SAFE_LOCAL steps only. There is no fallback into Langflow, Sync, or Hostinger execution.

**Workbench Postgres failure**

Impairs editor/read-model/history/layout. Existing promoted OPS execution remains outside the DB authority path.

**PersistFlow failure**

Workbench enters control-degraded mode. Reads, design, and SAFE_LOCAL may continue when safe. New effectful writes fail closed. Sync never bypasses PersistFlow.

**Provider failure**

Routing excludes ineligible providers. Stateful browser/session affinity may block instead of migrating.

### 36.5 Health endpoints

Each Workbench service provides at least:

- liveness: process alive;
- readiness: able to fulfill its role.

Startup order is not a correctness dependency. Services retry dependencies with bounded backoff/jitter and reconcile when dependencies return.

## 37. Drift and version mismatch

Drift types include:

- deployment/source SHA drift;
- policy drift;
- provider protocol/capability drift;
- infrastructure desired-state drift;
- promoted FlowSpec/ExecutionPlan hash drift.

No “closest version” execution is allowed.

Incompatible providers remain visible for diagnosis but are ineligible.

Workbench may detect drift and propose a PR. It does not silently repair production.

## 38. Workbench deployment authority

GitHub CI/CD is the Workbench deployment authority.

Workbench may:

- detect drift;
- generate a change proposal;
- open a branch/PR.

Workbench may not directly deploy production.

Pipeline:

```text
branch/PR
  ↓
contract + compiler + security + unit/integration tests
  ↓
preview as applicable
  ↓
merge
  ↓
staging deploy
  ↓
smoke/integration/read-back
  ↓
production promotion
```

Deployment success requires read-back/health verification, not merely “apply finished”.

Infrastructure is IaC-first where provider support is mature. Manual exceptions are versioned/inventoried with reason and verification method.

## 39. Backup and disaster recovery

Use layered durability:

- provider Postgres snapshots/backups;
- independent encrypted DB export;
- Git as separate source;
- object store as separate immutable blob store;
- versioned trust configuration excluding private root material.

Required staging restore drill:

1. destroy staging environment;
2. create fresh infrastructure/Postgres;
3. deploy all Workbench services;
4. restore backups;
5. rebuild read-model by reconciliation;
6. recover/verify FlowSpecs from Git;
7. verify trust configuration;
8. run LAB smoke;
9. run safe OPS smoke.

A backup is not accepted as valid until it has been restored and application integrity checked.

The design intentionally avoids inventing unsupported RPO/RTO numbers. Production RPO/RTO are operational configuration/objectives that must be documented with the deployed backup schedule and measured restore drill.

## 40. Security model

### 40.1 Threats explicitly in scope

At minimum:

1. stolen human session;
2. replayed approval;
3. compromised delegated issuer;
4. fake provider registration;
5. changed provider identity;
6. malicious MCP metadata/payload;
7. flow policy escape;
8. hidden I/O from Langflow component;
9. lying/misbehaving worker;
10. secret leakage in traces/evidence;
11. browser cookie/profile leakage;
12. compromised adapter;
13. replayed service request;
14. stale-generation execution;
15. compromised agent privilege escalation;
16. supply-chain compromise;
17. Langflow upstream/patch incompatibility;
18. Workbench attempt to bypass PersistFlow.

Every identified threat must have a documented prevent/detect/contain/recover treatment before DoD.

### 40.2 Data classification

Use:

- `PUBLIC`;
- `INTERNAL`;
- `SENSITIVE`;
- `SECRET`;
- `AUTH_MATERIAL`;
- `EVIDENCE`.

Private keys, raw OAuth tokens, browser cookies/profiles, SSH keys, raw `.workbench-auth`, and raw `.approval` are not general Workbench persisted data.

### 40.3 Redaction

Redaction occurs before persistence, not only before display.

At minimum scrub:

- `Authorization`;
- `Cookie`;
- `Set-Cookie`;
- API-key headers;
- bearer tokens;
- access/refresh tokens;
- client secrets;
- private-key material;
- SSH private material;
- raw authentication/approval payloads.

Adapters provide domain-specific redactors.

CI uses fake-secret fixtures to prove sanitization.

### 40.4 Audit

Audit records human/control actions such as:

- login success/failure;
- revocation;
- approval accepted/rejected;
- promotion requested;
- run requested;
- provider approved/revoked;
- policy changed;
- remediation requested.

Audit does not replace effect receipts.

### 40.5 Supply chain

Critical images are pinned by digest. Dependency/container/SBOM/security scanning is part of CI where supported. Dependency upgrades happen through PRs.

## 41. Canonical future repository

After written-spec approval create:

```text
menezes-platform/ops-infra-workbench
```

Initial conceptual layout:

```text
gateway/
sync/
runner/
extensions/
frontend-patches/

contracts/
  openapi/
  schemas/
  compatibility/

capabilities/
providers/
flows/
  lab/
  promoted/
policies/

packages/
  flow-compiler/
  trust/
  resource-identity/
  context-builder/
  adapter-sdk/

deploy/
migrations/
tests/

docs/
  superpowers/
    specs/
    plans/
```

The repository also establishes durable project-level documents required before substantive implementation:

- `AGENTS.md`;
- `README.md`;
- system/product requirements document appropriate for infrastructure;
- `docs/ARCHITECTURE.md`;
- `docs/SECURITY.md`;
- `docs/TESTING.md`;
- `docs/DESIGN_SYSTEM.md` because the live canvas interaction language is material;
- any code-style document only if conventions are not already enforced by tooling.

## 42. Testing strategy

Required layers:

- unit;
- contract;
- integration;
- end-to-end;
- failure injection;
- security/negative tests;
- deterministic compile tests;
- visual regression;
- disaster recovery.

### 42.1 Unit coverage

At minimum:

- compiler;
- resource identity;
- trust/approval validation;
- policy/risk classification;
- redaction;
- incident correlation;
- retry/circuit-breaker logic;
- staleness/reconciliation;
- adapter normalization.

### 42.2 Contract/golden fixtures

Maintain canonical fixtures for:

- FlowSpec;
- ExecutionPlan;
- Receipt;
- Provider Manifest;
- Capability Manifest;
- Approval Challenge;
- ContextBundle metadata;
- resource events;
- Incident.

Use these across compiler, API, CI, frontend, adapters, and tests.

### 42.3 Determinism tests

The same compile input set is compiled repeatedly and on independent supported CI runners. Canonical bytes and SHA-256 must match.

### 42.4 Negative security tests

Must prove failure for at least:

- invalid signature;
- unknown key ID;
- expired session;
- reused OPS `jti`;
- reused approval;
- approval wrong target/input/generation/plan;
- revoked issuer/provider;
- provider identity mismatch;
- forged heartbeat;
- untrusted capability;
- LAB-only/unknown node in OPS promotion;
- Runner network/shell/filesystem attempts;
- Sync direct-effect attempt.

### 42.5 Unknown-outcome tests

Inject:

- effect occurred but response lost;
- worker died after effect;
- late receipt;
- duplicate request;
- stale-generation retry;
- reordered/missed event;
- network timeout after submission.

No silent double effect is permitted.

### 42.6 Circuit-breaker and 429 tests

Prove:

```text
CLOSED → repeated failure → OPEN
OPEN → no retry storm
cooldown → HALF_OPEN
successful bounded probe → CLOSED
```

And prove one upstream circuit does not unnecessarily open unrelated upstreams.

### 42.7 Reconciliation/rebuild tests

Deliberately create projection divergence and event gaps. Authoritative reconciliation must converge the projection.

Destroy the Workbench projection database and prove graph/provider/active-run projections rebuild without restarting real jobs.

### 42.8 Canvas tests

Prove:

- same resource identity across lenses;
- layout persistence;
- runtime overlay cannot mutate FlowSpec;
- zoom/detail transitions;
- focus mode;
- edge bundling;
- incident impact highlighting;
- exact trace-route highlighting;
- stale/unknown/derived/authoritative states are visually distinct.

### 42.9 Visual regression

Protect patched Langflow canvas states including:

- node health states;
- inspector;
- clusters;
- trace overlay;
- incident overlay;
- R3 approval pause;
- stale state.

### 42.10 E2E flows

**LAB E2E**

Draft → SAFE_LOCAL transform → external sandbox capability → trace → receipt → canvas update.

**OPS E2E**

FlowSpec → compile → PR → CI → merge → promoted → run → provider → receipt → runtime overlay.

**R3 E2E**

R3 request → paused → challenge → signed approval → exact-binding verify → execution → approval consumed → second reuse rejected.

**Agent E2E**

Create agent session → ContextBundle → task → real Git effect request → PersistFlow → receipt → output and effect shown separately.

**Browser E2E**

Create session → navigate → inspect/screenshot → preserve affinity → kill provider → session unavailable, no implicit migration.

**MCP E2E**

Discover/probe → read → effectful test call via PersistFlow → receipt → inject 429 → honor Retry-After → open scoped circuit → no retry storm → incident correlation.

### 42.11 Chaos and DR

Staging failure injection intentionally kills/disconnects:

- Gateway;
- Langflow;
- Sync;
- Runner;
- Worker/provider;
- PostgreSQL connection;
- PersistFlow connection;
- object store connection.

At least one full staging destroy/recreate/restore/reconcile/smoke drill must pass before DoD.

## 43. Performance baseline and load shedding

V1 should demonstrate practical operation with at least:

- 100+ projected resources;
- 500+ graph edges;
- 50 simultaneous live observations;
- 10 concurrent active runs projected;
- a trace of 1,000+ spans viewable without making the Workbench unusable.

These are verification baselines, not promises of a hard scaling ceiling.

When overloaded, preserve in order:

1. authority/approval events;
2. run state;
3. incidents;
4. resource health;
5. traces;
6. cosmetic/high-frequency metrics.

Duplicate/cosmetic samples may be coalesced. Receipts, approvals, generation transitions, and policy blocks may not be silently discarded.

Adapters have explicit probe interval, concurrency, retry budget, rate-limit awareness, and backoff. Reconciliation must not become self-inflicted polling abuse.

## 44. Rollout

### Phase 0 — Repository and contracts

After written spec approval:

- create `menezes-platform/ops-infra-workbench`;
- copy this approved design into its canonical `docs/superpowers/specs/` location;
- create durable project documents;
- establish schemas/contracts;
- establish compiler/trust/resource-identity skeletons;
- establish CI.

No production behavior changes.

### Phase 1 — Read-only Workbench

Deploy:

- Gateway;
- pinned Langflow;
- Sync;
- Postgres;
- basic adapters;
- live topology;
- health;
- traces;
- canvas read-side patches/extensions.

No real mutation path.

### Phase 2 — LAB execution

Add:

- constrained Runner;
- Sandbox integration;
- LAB FlowSpecs;
- LAB receipts.

No real OPS execution.

### Phase 3 — Promotion pipeline

Complete:

- deterministic compiler;
- Git PR promotion;
- immutable ExecutionPlan;
- CI gates;
- promotion manifests.

### Phase 4 — Bounded OPS

Enable:

- R0;
- R1;
- selected R2 capabilities.

### Phase 5 — R3

Enable:

- delegated issuer tooling;
- one-shot approval;
- high-impact gated actions.

### Phase 6 — Incident remediation

Only after observability/correlation is proven reliable:

- promoted remediation FlowSpecs;
- scoped circuit breakers;
- bounded R1 auto-remediation.

## 45. Migration strategy

The Workbench first runs beside existing infrastructure.

It does not initially replace:

- PersistFlow;
- Resident Node;
- Sandbox;
- Dev-Orquestra;
- existing provider credential ownership.

It begins by observing them through adapters. Effectful intent is added incrementally through existing authority boundaries.

No rollout phase requires a full infrastructure stop.

## 46. Explicit V1 non-goals

V1 does not:

- replace PersistFlow;
- replace Dev-Orquestra;
- replace Resident Node;
- create a universal secret vault;
- add Kafka, Redis, Neo4j, Elasticsearch, or Kubernetes without demonstrated need;
- deeply fork Langflow backend;
- migrate every existing authentication mechanism;
- silently migrate browser sessions across providers;
- auto-correct production drift;
- auto-execute R3;
- allow arbitrary code in Runner;
- act as a full SIEM;
- act as a public multi-tenant platform.

## 47. Definition of Done

The project is not Done because the UI loads. DoD requires evidence per requirement.

### 47.1 Infrastructure

- [ ] `infra-workbench` exists in Railway.
- [ ] Preview/staging/production are isolated as designed.
- [ ] Gateway is the only public Workbench ingress.
- [ ] Langflow/Sync/Runner are not independently public.
- [ ] PostgreSQL domains are configured.
- [ ] Backups/independent export are configured.
- [ ] A staging restore drill succeeds.
- [ ] IaC/read-back can detect drift.
- [ ] Critical images are pinned.

### 47.2 Authentication and trust

- [ ] Owner Root private material is absent from cloud systems.
- [ ] Delegated issuer chain works.
- [ ] LAB session file behavior matches policy.
- [ ] OPS session file is one-shot.
- [ ] Session replay fails.
- [ ] Revoked issuer fails.
- [ ] Raw auth file never persists.
- [ ] R3 approval is one-shot.
- [ ] Approval binding mismatch fails.
- [ ] Stale-generation approval fails.

### 47.3 Canvas

- [ ] A single canvas hosts infra/flow/runtime semantics.
- [ ] Design lens works.
- [ ] Live lens works.
- [ ] Trace lens works.
- [ ] Impact lens works.
- [ ] Resource identity is preserved across lenses.
- [ ] Progressive disclosure works.
- [ ] Semantic clusters work.
- [ ] Edge bundling works.
- [ ] Focus mode works.
- [ ] Search acts on the canvas rather than creating a separate dashboard.
- [ ] Operational inspector works.
- [ ] Runtime overlay cannot alter FlowSpec.
- [ ] Layout autosave works.
- [ ] Canonical layout can be explicitly published to Git.

### 47.4 Discovery and projection

- [ ] Providers/resources appear automatically when discovered.
- [ ] New providers default to quarantine.
- [ ] Trust and availability remain independent.
- [ ] Unknown capability cannot become OPS-usable.
- [ ] Stale state is visually explicit.
- [ ] `UNKNOWN` is distinct from `OFFLINE`.
- [ ] Sequence gaps trigger reconciliation.
- [ ] Sync read-model rebuild succeeds from sources.

### 47.5 FlowSpec/compiler

- [ ] FlowSpec schema exists.
- [ ] ExecutionPlan schema exists.
- [ ] Canonical serialization is specified/tested.
- [ ] Compiler is deterministic.
- [ ] Compiler SHA/revisions appear in promotion manifest.
- [ ] Same compile inputs produce same SHA-256.
- [ ] Unknown/unmanaged/LAB-only nodes block OPS promotion.
- [ ] Promoted revision is immutable.
- [ ] OPS promotion always uses PR/review/CI.

### 47.6 Execution

- [ ] SAFE_LOCAL runs only through Runner.
- [ ] Runner cannot access operational network/shell/external filesystem.
- [ ] Every effectful action goes through PersistFlow.
- [ ] Runtime provider selection is made by PersistFlow.
- [ ] Stateful browser affinity is respected.
- [ ] Effectful steps produce receipts/evidence according to capability semantics.
- [ ] Duplicate execution is guarded.
- [ ] Stale generation is rejected.

### 47.7 Failure semantics

- [ ] 429 honors Retry-After when provided.
- [ ] Scoped circuit breaker works.
- [ ] Retry budget prevents storms.
- [ ] `AUTH_REQUIRED` does not blind-retry.
- [ ] `UNKNOWN_OUTCOME` reconciles before retry.
- [ ] Worker death cannot silently double an effect.
- [ ] Late receipts reconcile correctly.
- [ ] Partial completion is represented.
- [ ] Compensation failure is represented.

### 47.8 Observability/evidence

- [ ] OTel correlation works end-to-end.
- [ ] `trace_id`, run, step, and provider are correlatable.
- [ ] Source/observed/derived/authoritative classifications are represented.
- [ ] Trace and receipt remain distinct.
- [ ] Redaction tests pass.
- [ ] Large artifacts go to object store.
- [ ] Hot queryable traces/state live in Postgres.

### 47.9 MCP

- [ ] `connection_ref` works.
- [ ] MCP credentials remain in adapter/provider ownership.
- [ ] Tool discovery/probe works.
- [ ] Effectful MCP calls pass through PersistFlow.
- [ ] Transport/upstream/tool/auth errors are distinguishable.
- [ ] Reconnect/backoff works.
- [ ] 429 correlation identifies the supported root cause without blaming healthy layers.

### 47.10 Browser

- [ ] `session_ref` works.
- [ ] Workbench does not persist cookies/profile secrets.
- [ ] Provider affinity works.
- [ ] Screenshots/evidence use durable references.
- [ ] Provider loss does not silently migrate a session.

### 47.11 Agents/context

- [ ] Dev-Orquestra remains lifecycle authority.
- [ ] Agent session appears in canvas.
- [ ] ContextBundle is reproducible and sanitized.
- [ ] Agent output is distinct from execution proof.
- [ ] Real effects use PersistFlow.
- [ ] Receipts confirm real effects.

### 47.12 Incidents/remediation

- [ ] Incident correlation exists.
- [ ] Probable root cause includes confidence/evidence classification.
- [ ] Deduplication works.
- [ ] Impact graph works.
- [ ] Attention policy works.
- [ ] `DEGRADED` does not create alert spam by default.
- [ ] `ACTION_REQUIRED` and `CRITICAL` can notify through adapters.
- [ ] Correlator never executes directly.
- [ ] Only promoted remediation FlowSpecs can remediate.
- [ ] R3 remediation pauses for approval.
- [ ] Cooldown/max-attempt/recursion protection works.
- [ ] Failed remediation keeps incident open with evidence.

### 47.13 Degraded modes

Automated/integration evidence proves:

- [ ] Sync down → existing runs continue.
- [ ] Langflow down → existing runs continue.
- [ ] Gateway down → existing runs continue.
- [ ] PersistFlow down → new effectful writes fail closed.
- [ ] Workbench projection DB lost → graph rebuilds.
- [ ] Provider offline → routing excludes provider.
- [ ] Git unavailable → no new promotion.
- [ ] Object-store write failure is not falsely marked durable.

### 47.14 Self-hosting safety

- [ ] Workbench can detect its own drift.
- [ ] Workbench may open a corrective PR.
- [ ] Workbench cannot deploy production directly.
- [ ] Staging precedes production.
- [ ] Read-back validates deploy state.
- [ ] Rollback path is tested.
- [ ] Langflow patch compatibility suite blocks incompatible upgrade.

### 47.15 Documentation

The canonical repository contains durable, non-placeholder documentation for:

- project orientation;
- requirements;
- architecture;
- security/threat model;
- testing;
- visual/design system;
- FlowSpec;
- ExecutionPlan;
- capability model;
- provider model;
- Adapter SDK;
- failure model;
- incidents/remediation;
- DR/runbooks;
- Langflow patch policy.

The exact filename may follow the repository's durable-project conventions; equivalent authoritative documents satisfy the requirement.

## 48. Final evidence package

Final completion must include a machine-readable or clearly auditable requirement matrix:

```text
Requirement
→ Test / procedure
→ Execution / CI reference
→ Artifact/evidence reference
→ Result
```

Example:

```text
UNKNOWN_OUTCOME prevents duplicate effect
→ integration/failure-injection test
→ CI run reference
→ trace/evidence SHA
→ PASS
```

No evidence means the requirement is not Done.

## 49. Final architectural proof

The Workbench must demonstrate the full lifecycle:

```text
DISCOVER
  ↓
VISUALIZE
  ↓
DESIGN
  ↓
VALIDATE
  ↓
PROMOTE
  ↓
AUTHORIZE
  ↓
EXECUTE
  ↓
TRACE
  ↓
RECEIPT
  ↓
DIAGNOSE
  ↓
RECOVER
```

while preserving:

- security;
- deterministic promotion;
- authority boundaries;
- recovery semantics;
- trace/evidence provenance.

The strongest acceptance test is:

> Start an effectful promoted run, take the entire Workbench plane unavailable, allow the authority/execution planes to continue according to their own semantics, restore the Workbench, reconcile state, and determine exactly what happened without duplicating the effect, inventing state, or replacing PersistFlow authority.

If that proof passes together with the DoD matrix above, the Infra Workbench has graduated from “a customized Langflow UI” into the intended visual infrastructure control workbench.
