# 04 — Repository Map

This map freezes destination ownership. It does not claim that migration has already occurred.

| Current repository | Target | Target modules/capabilities | Final disposition | Rename/archive timing |
| --- | --- | --- | --- | --- |
| `menezes-platform/ops-codex-os` | `agent-platform` | Agent OS, Context Gateway, Context Store ownership, retrieval orchestration, Provider Gateway, global architecture | MOVE | Rename only after callers and docs are migrated and compatibility gates pass. |
| `menezesx2k26-byte/resident-node` | `execution-plane` | PersistFlow core, Resident Runtime, indexing runtime, secrets broker, worker adapters | MOVE | Rename only after PersistFlow/workers are consolidated and gates pass. |
| `menezes-platform/ops-persistflow-sandbox` | `execution-plane` | useful sandbox/worker execution implementation | ARCHIVE | Archive after callers=0, state/deploy dependency=0, equivalent tests green, preservation tag created. |
| `menezes-platform/ops-dev-orquestra` | multiple target modules | semantic cache -> Provider Gateway; browser/computer -> Execution Plane; useful bridges -> owning adapters | ARCHIVE | Archive after useful capability migration and deletion of duplicate orchestration/authority. |
| `menezesx2k26-byte/ops-gabriel-ops` | retained | observability, dashboards, health, projections, command console | KEEP | Simplify in place; no rename required. |
| `menezesx2k26-byte/Memory` | retained | canonical personal context only | KEEP | Global/platform architecture moves out; private personal memory remains. |

<!-- legacy: ops-codex-os -->
<!-- legacy: resident-node -->
<!-- legacy: ops-persistflow-sandbox -->
<!-- legacy: ops-dev-orquestra -->
<!-- legacy: ops-gabriel-ops -->
<!-- legacy: Memory -->

## Capability routing

| Legacy capability | Target owner |
| --- | --- |
| global agent rules/skills | Agent Platform / Agent OS |
| memory-cognition provider seam | Agent Platform / Context Gateway |
| RAGFlow shadow adapter | deferred implementation detail behind retrieval seam |
| PersistFlow run authority | Execution Plane / PersistFlow core |
| Resident durable jobs/security | Execution Plane / Resident Runtime |
| indexing/retrieval CPU+disk work | Execution Plane / Indexing Runtime |
| Drive-backed corpus ownership | Agent Platform / Context Store |
| semantic/exact model response cache | Agent Platform / Provider Gateway |
| browser/computer execution | Execution Plane |
| worker/provider execution adapters | Execution Plane / Worker Adapters |
| operational dashboards/projections | Gabriel Ops |
| personal context | Memory |

## Rename rule

Repository rename is a late migration action, not an early cosmetic action. Internal seams and callers migrate first; names change only after redirects/clients/docs are ready and rollback is proven.
