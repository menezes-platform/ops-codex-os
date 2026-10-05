# Consolidation status — Drive-backed fleet routing

- `recorded_at`: `2026-10-05T07:09:00Z`
- `P06`: `PREPARATION_ONLY / NOT_PASSED`
- `P05`: `ENTRY_NOT_SATISFIED`
- `production_status`: `UNVERIFIED`
- `frozen_spec`: `unchanged`

The accompanying feature spec and implementation plan are retained as historical records of the pre-consolidation design. Their TypeSafe sections describe a direct provider integration and are not the current target interface. The feature spec's “Implemented and verified” label refers to its original source-level acceptance work; it does not mean the current architecture is deployed or production-verified.

Draft Agent Platform PR [#30](https://github.com/menezes-platform/ops-codex-os/pull/30) replaces the PersistFlow fleet scorer's direct TypeSafe HTTP/key path with an injected `ProviderGatewayFleetRouter`, and deterministically falls back when the gateway is not composed. At this note's capture, the source head was `4f5077292ffcec0ef26ea6b943d741983e630fdb`. It remains unmerged and undeployed; production gateway composition, a broker-backed adapter, other caller ownership/use, and the zero-bypass proof are still open.

For current implementation, follow the frozen [Agent Platform Spec Kit](../../docs/architecture/spec-kit/11-definition-of-done.md) and the P06 checkpoint [provider caller follow-up](https://github.com/menezes-platform/ops-codex-os/blob/consolidation/p08-caller-inventory-20261005/docs/architecture/execution-checkpoints/2026-10-05-P06-provider-caller-followup.md). TypeSafe may only be used as an explicitly approved Provider Gateway adapter; the historical direct `TYPESAFE_API_KEY`/endpoint path must not be reintroduced. P05 and the wider migration gates remain unchanged.

## Source scan refresh — 2026-10-05T08:24Z

The checked-out P06 branch is at `b085ceabe3d549444f4d8d05ee4dd098464626ba`. A targeted scan of code files under Agent Platform runtime paths (`modules`, `persistd/src`, `clients`, `scripts`, `skills`, `global`, and `server.js`) found no matches for the known direct model-provider HTTP endpoints or provider SDK patterns. The scan excluded Markdown, dependency locks and installed packages; it covered OpenAI, Anthropic, Groq, Mistral, OpenRouter, Gemini, and TypeSafe patterns. The draft also adds dense-array validation at the Gateway boundary; its local evidence is recorded in the P06 caller follow-up.

This is bounded source evidence for this checkout only. Dynamic endpoints, indirect provider/MCP calls, other repositories, installed tasks, effective production configuration, Gateway composition, broker-backed secrets, and global zero-bypass remain unverified. PR #30 is still unmerged/undeployed and P06 remains `NOT_PASSED`.

## Source regression guard — 2026-10-05T08:32Z

The bounded endpoint/SDK scan is now a regression test in `tests/platform-contracts.test.js`. It covers the Agent Platform runtime and workflow paths listed in the P06 checkpoint and requires known direct provider calls to live under the Provider Gateway adapter directory. The focused contract suite passed **9/9**, and recursive `node --test` passed **321/321** on this source tree. The temporary dependency junction used for the full run was removed. This guard strengthens source review but does not prove global AG-014 or production zero-bypass.
