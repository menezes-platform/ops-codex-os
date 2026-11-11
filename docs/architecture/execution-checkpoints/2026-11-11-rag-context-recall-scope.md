# RAG contextual recall — scope/follow-up guard (2026-11-11)

**State:** SOURCE FIX / FOCUSED WINDOWS VERIFIED / DRAFT ONLY / NOT DEPLOYED / RAG DOD STILL OPEN.

## Confirmed defect
The controlled Context Gateway's `decideRecall()` chose the first available project for any non-personal domain when a historical retrieval was required, even if the user was discussing an unrelated topic or multiple project scopes were available. This could return context from the wrong project. A context-dependent follow-up without historic trigger words did not require recall, even when classified as a follow-up by the trusted host.

## Change
- Only a trusted host-provided `domain: 'project'` may select a project lane. Multiple available projects require an exact `userIntent.projectScope` matching the allowed scopes; unknown or ambiguous targets fail closed.
- `domain: 'personal'` selects only the available personal lane. Other domains no longer fall through to an arbitrary project.
- Trusted `userIntent.contextDependent === true` now requires retrieval, even without explicit history phrases.
- Ordinary irrelevant prompts continue without memory access. This does not change permissions, corpus materialization, native ChatGPT internals or production index publication.

## Validation evidence
- Reproduction in isolated Node 22.16.0 sandbox: 4 of 5 focused tests failed before fix (wrong-project / multi-project / explicit target / contextual follow-up); all 5 passed after fix.
- On the actual Windows host DESKTOP-L6CITUI, GitHub branch files were independently fetched and tested in a temporary, cleaned folder: `node --test` of original `recall-trigger-policy.test.js` plus new `recall-scope-followup-regression.test.js` => **6 PASS, 0 FAIL, 0 SKIP**, exit 0.
- This is focused Windows/source verification, not an E2E RAG serving, production or current-index test. Original RAG worktrees at `D:/Repos/rag-final-integration-20261017` and resident counterpart were observed clean, on their expected integration branches, and were not edited.

## Corrected diagnostic — no needless sync API rewrite
An initial proposed additional sync readback hook was evaluated, then removed from this branch after reading the canonical `createDrivePersonalStore.putEvent()`: it already performs authenticated-store-event and receipt readback with exact byte comparison, and replays check immutable bytes. The temporary changes to `personal-drive-sync.js` and its original tests were reverted to the parent branch byte-for-byte, and the speculative regression file was deleted. Do not infer that a comment or wrapper missing an extra read call means the implementation does not verify persistence; follow the call chain to the store before changing contracts. A verified backend Drive token remains unavailable for production ingest.

## Remaining gates (no false completion)
- This corrects controlled-host source behavior only. Consumer ChatGPT's native memory and tool-invocation policy cannot be forced by a GitHub PR.
- PR #46 native hybrid lane and Resident Node counterpart retain P03/P04/P05/B23-B26 and auth / incremental-ingest / personal migration / encrypted backup / Android gates.
- Need an authenticated owner capability and backend Drive OAuth through the approved broker, actual incremental ingestion and cursor/owner reconciliation, indexed generation current/previous and rollback receipts, project/private isolation, current source freshness, and controlled-host serving tests before enabling production.
- Never merge directly to main, deploy, change Engram authority, or access user secrets as part of this source patch.

## Next safe action
Review stacked PR, validate against the complete integration checkout/CI when the known cost gate permits, and implement the backend-owned authenticated ingest/cutover proof without weakening identity checks. Reverify producer-owned owner capability before B23–B26.
