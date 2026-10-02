# 00 — Architecture Constitution

**Status:** Approved architectural law for the consolidation program.

## Constitutional rules

1. **Exactly one authority per durable state domain.** Every other representation is a projection, cache, index, snapshot, replica, telemetry stream, or exported artifact.
2. **Frameworks are implementation details.** Platform-owned interfaces never expose vendor/framework-specific types.
3. **Interfaces live with the producer module.** Consumers receive a client/SDK; no independent contracts repository becomes a third authority.
4. **No valid scope, no project recall.** Normal project recall requires deterministic `project/<owner>/<repo>` scope. Multi-project recall is explicit and allowlisted.
5. **Compatibility is temporary and mortal.** Every shim has an owner, caller list, objective removal condition, and latest removal phase.
6. **Destruction is part of Done.** The migration is incomplete while obsolete authorities, eligible shims, dead deployments, superseded branches, or legacy repositories remain live contrary to the deletion map.
7. **Current evidence beats architectural prose for current state.** The Spec Kit defines the target. Repository/runtime evidence defines what is actually live until migration proves otherwise.
8. **No new paid infrastructure is authorized by this program without explicit human authorization.**

## Framework rule

The architecture must survive replacement of any implementation detail, including LangChain, FAISS, Redis/RedisVL, RAGFlow, Hindsight, Engram integration adapters, provider SDKs, and MCP transports.

## Deferred capabilities

The initial consolidation explicitly defers:

- RAGFlow runtime deployment;
- LangGraph adoption;
- distributed multi-primary execution;
- automatic leader election;
- permanent cloud database;
- hot standby;
- full event-sourced rewrite;
- provider-specific retrieval architecture.

A deferred capability may enter only through a later reviewed architectural change after the consolidated system is operational.

## State-model rule

A derived system may improve retrieval, latency, availability, or visibility. It may not silently acquire write authority because it happens to persist data.

## Mutation rule

A migration executor may change implementation to satisfy this constitution. It may not change this constitution merely to make an implementation easier.
