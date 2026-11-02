# Canonical learning sheets — verified validation lesson

Date: 2026-11-02. Scope: reusable engineering guidance; no private candidate data.

Native numeric input bounds can be insufficient: a range bound accepts fractions, and an incorrectly reused bound may exceed the real discipline maximum. An API write can also reach values that the UI would reject. Validate integers, per-column limits, coherent dates, origin, real/test provenance and unique IDs inside the calculation/import boundary as well as the UI. Do not allow malformed records to produce plausible official scores.

Preserve missing versus zero, annulled items versus incorrect answers, and historical exams versus a comparable target series. A formula-generated empty string is absence, not an observed zero. Use a known positive-count criterion when aggregating scores and validate metadata before writing.

For mutable canonical workbooks: retain the original ID; make a private backup; exercise an isolated copy with fictitious data; verify real connector readback; clear fixtures; then apply the validated formula patch to production without copying fixture inputs. Re-read final inputs and formula errors. Never claim native visual verification from cell metadata alone.

A downloaded/versioned source bundle, Drive receipt or Git commit is not production retrieval publication. Offline lexical FTS5 can be verified independently; keep hybrid gateway/index publication blocked without the actual runtime, source/isolation tests and publication/rollback receipts. Do not create paid infrastructure to bypass an unavailable runtime.
