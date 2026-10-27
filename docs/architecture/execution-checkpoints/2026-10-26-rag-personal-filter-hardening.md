# RAG Final — personal recall filter hardening (2026-10-26)

Status: SOURCE PATCH + FOCUSED TDD VERIFIED. **DoD BLOCKED; no production promotion.**

## Source ancestry
- Base: `integration/rag-final-20261017` at `f97658125f9f25f3646efab933a8f8646d61e71d` (stacked RAG PR #46).
- Isolated branch: `feat/rag-personal-filter-gates-20261026`.
- Changed:
  - `modules/context-gateway/src/personal-recall.js`
  - `tests/personal-recall-filter-validation.test.js`
- The branch does **not** update main, deploy, grant OAuth, enable capture, migrate Engram, or authorize Android permissions.

## Three observed RED -> GREEN loops (Node v24.19.0)
1. Added boundary tests for impossible calendar dates, reversed after/before, nonarray/foreign source filters, control chars and wrong filter types. RED: four failing out of five. Implemented `normalizePersonalFilters` with strict RFC3339 UTC timestamps, permitted event sources, bounded revision, and owner-scope-preserving forwarding. GREEN: 8/8 across new and existing personal recall tests.
2. Added fractional-second ordering case. RED: 1 failure out of 6 new tests because lexical `Z` versus `.` order is not chronological. Changed range check to `Date.parse` numeric comparison. GREEN: **9/9** across the two focused test files, plus successful Node syntax check.
3. Added two native hybrid query contract tests for UTF-8 byte limit and control characters. RED: 2 failures (old Gateway checked UTF-16 character length only and allowed controls). Implemented a 4096-byte well-formed/control-free query limit aligned with the qualified Rust hybrid adapter. GREEN: **11/11** across the two focused test files; Node syntax check PASS.

Commands in isolated approved scratch `C:\Users\Pichau\rag-node-regression-20261026`:
```sh
node --test tests/personal-recall.test.js tests/personal-recall-filter-validation.test.js tests/context-gateway-personal-integration.test.js
node --check modules/context-gateway/src/personal-recall.js
```
Additional existing Context Gateway personal integration test was fetched unchanged and executed in the same isolated dependency mirror. Final focused validation: **12/12 Node tests PASS**, zero failed (personal recall 3, new filters 8, gateway integration 1). The new test suite alone has 8 cases. Full Node suite/CI remain unexecuted. The four original linked modules were fetched unmodified from GitHub for the focused test harness, then only the modified source/test were committed. GitHub readback verified both commits.

## Acceptance boundaries
This patch hardens the **Node personal Gateway B25 boundary** but does not complete Rust B25, nor B23/B24/B26. It does not prove actual FAISS, Drive OAuth backend, production-scale temporal benchmark, replay resilience, power-loss recovery, full `npm test`/Cargo/Gradle/CI, authenticated owner issuance, isolated device deployment, or P03/P04/P05 exit gates. Never count a passing focused test as production DoD.

## Safe integration
Review diff against PR #46 integration head and test with the full suite on an approved no-cost runner. Resolve independently verified Rust owner capability contract before actual personal read path; the Node `resolvePersonalScope` trusts only the authenticated runtime ownerResolver contract. Never extend ProjectScope to impersonate personal/current.
