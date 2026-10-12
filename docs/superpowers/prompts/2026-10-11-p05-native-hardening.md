# Native Hardening Prompt — RAG P05 (copy/paste)

Execute the already-approved RAG P05 in **Superpowers Native**, advancing as far as safely possible WITHOUT Hostinger access. Do not merely summarize the plan or repeatedly ask me whether to continue. Do not promise background work. Act during this session, with real commits, test evidence and checkpoints. Once I approve the supplemental offline plan, execute it task by task.

## Absolute source of truth

- Read superpowers:using-superpowers, superpowers:executing-plans, superpowers:test-driven-development, superpowers:verification-before-completion and superpowers:systematic-debugging when needed.
- Read the frozen Agent Platform Spec Kit and its original P05 plan: docs/superpowers/plans/2026-10-11-p05-hybrid-rag.md in PR #36. Read the companion plan docs/superpowers/plans/2026-10-11-p05-native-offline-hardening.md.
- Inspect the CURRENT GitHub heads, not memory: Agent Platform P05 PR #32, Node Native PR #37, resident-node P04 PR #1. Never assume draft code is merged into main or reimplement existing BM25, corpus manifest, generation policy or Execution Plane client.
- Work in isolated branches/worktrees per repository. Preserve current HEADs, never overwrite/merge/delete a branch without permission.
- Remember Hostinger accounts: PersistFlow Sandbox = **Conthabil**; MCP Remote = **Menezesx2k25**. They are independent. Neither is needed for offline RAG development, and one system's errors do not describe the other's health.

## Execution algorithm (mandatory)

1. Locate the pinned plan, spec, real source, task ledger and last verifiable commit. If no ledger, create one. Identify exactly which work packages are already finished; do not redo them.
2. Establish baseline: run Node tests/spec-kit checks, inspect Rust toolchain and existing non-paid, already-authorized runners. If Cargo unavailable, mark RUST_ENV_BLOCKED, but proceed with independent Node, contract, fixture and benchmark tasks. Never fabricate a Cargo RED/GREEN or silently deploy a runner.
3. For each reviewable task: WRITE the failing test first; RUN it and identify the expected failure; implement the smallest change; RUN focused tests and the full relevant suite; read exit codes and failures; review the diff; COMMIT with a useful message; update the ledger/checkpoint with branch+SHA+test commands+results. If a command fails because of environment, distinguish ENV_BLOCKED from CODE_FAIL and move to an independent task.
4. Reuse the established Rust interfaces: CorpusMaterializer, LocalEmbedder, FaissIndexBackend, IndexGenerationPublisher, SqliteFts5Bm25Backend; use real native FAISS and pinned offline embeddings, not a fake vector-search substitute. Keep current/previous index CAS atomic and replay-safe.
5. Test project isolation, path traversal, malicious corpus digests, stale contradictions, idempotency-key collisions, crash-before-CAS, rollback, vector dimension/profile mismatches, and zero cross-project leakage. Tests must fail without the corresponding feature/guard.
6. Benchmark real BM25-only and real hybrid retrieval against the SAME pinned corpus/query set, when those implementations actually execute. Keep synthetic traces labeled SYNTHETIC and do not reuse illustrative hit rates as real metrics.
7. Continue autonomously to the next feasible independent task instead of turning each ordinary technical obstacle into a conversational question. Conserve tokens by referring to the ledger and printing concise outputs, but do not omit correctness checks or source verification.
8. When no more honest, reversible progress is possible, report what was committed, what passed with fresh evidence, what is only SOURCE_PREPARED, what is ENV_BLOCKED, what remains for Conthabil Hostinger, and the exact next safe action. A useful partial implementation with truthful tests is better than a grand completion claim.

## Strict stop conditions

Stop before live deployment, destructive migration, production secrets/credentials access, branch merges, paid cloud/model/agent usage, unsafe security-sensitive changes or a truly unresolvable architecture ambiguity. Do not silently use new infrastructure to work around a gate. If a block applies to one independent task only, continue other work.

## Definition of execution quality

- No success claims without exact test command and output.
- No fabricated benchmarks, citations, commits, runners or deployment receipts.
- No P05 formal PASS until P03/P04 prerequisites, native Rust producer, Drive corpus, real model/FAISS, rollback, security tests and acceptance gates are proven.
- Capture a checkpoint that survives context resets. Start each subsequent session at the first unverified unfinished task, not at a fresh planning conversation.
- Prefer progress evidenced in Git over optimistic percentage-complete language.

**Immediate action on receiving this prompt after the supplemental plan is approved:** verify the three PR HEADs and task ledger; inspect available toolchains; begin or resume the first safely executable RED→GREEN task. Do not respond with another plan unless source divergence invalidates the approved design.
