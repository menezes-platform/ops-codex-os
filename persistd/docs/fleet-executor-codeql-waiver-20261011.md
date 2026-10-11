# Fleet Executor — owner CodeQL gate waiver

On 2026-10-10 America/Sao_Paulo, Gabriel explicitly waived CodeQL as a release requirement for this Fleet Executor delivery after being informed that GitHub billing prevents it from starting.

CodeQL remains NOT EXECUTED, not passed. This waiver removes only CodeQL from the release blocking criteria for this delivery. It does not disable or modify workflows, billing, branch protection or other security controls, and does not waive CI generally.

Existing integrated local evidence remains: executable source ffda8add9f9e98f0ef6ee9ae176088782672d9fd; Windows PersistFlow 277/277, root 23/23, security 8/8, zero failures/skips; Linux root/security passed and PersistFlow 276 passed with one Windows-only skip.

Effective durable storage path, single Authority writer, consistent backup/isolated restore, immutable rollback and safe publication remain mandatory. Controlled production activation and smoke/recovery remain unfinished. This waiver alone is not DoD or permission to bypass platform protections.
