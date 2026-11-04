# Evidence and native spreadsheet write lessons

Verified engineering lessons, recorded 2026-11-04. These are reusable checks, not claims about any current deployment.

- Write formula examples and user text as literal string cells. Read effective values after upload: syntactically valid data can silently become executable spreadsheet formulas. Add a regression for any observed conversion.
- Test answer-position leakage in generated multiple-choice banks. Distinct strings and correct arithmetic do not rule out median/extreme-value heuristics or ID-derived answer patterns. Use plausible error-model distractors and a permutation independent of public identifiers. Report parametrized family counts separately from cognitive coverage and human approval.
- Qualify observations against an independent, versioned content reference. Do not validate a submitted key by rebuilding the reference from the same submitted record. Derive novelty from ordered qualified history, count physical duplicates before filtering TEST rows, and require finalized independent manifests for achievement claims.
- Commit each projected row and its idempotency key in one native operation. Inspect all manual input cells before reusing a row, preserve formulas, preflight every target's capacity before cross-sheet writes, and acknowledge an already-persisted primary receipt even when a derived projection needs retry.
- Reconcile an immutable receipt before consulting mutable source content. Retrying after a source revision, lost acknowledgement or local navigation must preserve the original submission ID. Only an explicit, definitive rejection permits discarding the local pending payload; never delete the accepted server record.
- Distinguish local domain tests, simulated adapter APIs, native staging readbacks, authenticated application behavior, production publication, and distributed takeover. Evidence at one layer does not imply the next. An HTTP 401 proves rejection of that probe, not positive authorization or isolation between real users.
- Compare only fields actually captured in a baseline. A new read mask can reveal a pre-existing note; use an immutable backup to resolve the difference before claiming a mutation or overwriting it.

Keep private project identifiers, source snapshots, credentials and account details in their owning private project, never in this public policy repository.
