---
name: gemini-bridge
description: Delegate scoped Codex tasks to the authenticated local Antigravity CLI using Gemini models; keep results concise and isolate mutable workers.
---

# Gemini Bridge (Antigravity)

Use the locally authenticated `agy` CLI already installed on the workstation. This bridge does **not** consume an API key, invent additional quota, or provide a free API entitlement.

Prerequisites: Node 22+, `agy` on PATH, existing authenticated Antigravity session, and user authorization to send the selected project context to that provider.

Run:

```powershell
node "$env:USERPROFILE\.agents\skills\gemini-bridge\bin\gemini-bridge.mjs" health
node "$env:USERPROFILE\.agents\skills\gemini-bridge\bin\gemini-bridge.mjs" models
node "$env:USERPROFILE\.agents\skills\gemini-bridge\bin\gemini-bridge.mjs" delegate --request-file task.json
```

Example `task.json` (UTF-8):

```json
{
  "concurrency": 2,
  "model": "gemini-4-argon-medium",
  "context": "Repository and objective; never include credentials.",
  "workers": [
    {"label": "implementation-design", "task": "Design a scoped implementation and list required changes."},
    {"label": "test-design", "task": "Propose tests and edge cases independently."}
  ]
}
```

Worker routing:
- For independent substantial work, plan a concrete split and delegate research, architecture, test design, validation, or isolated implementation to Gemini rather than using workers only for review.
- Default to **2** independent workers and increase only for disjoint scopes with sufficient quota. One request accepts **1–8** workers. Report actual results, not just spawn acknowledgements.
- `mode: "plan"` is default and does not grant file-edit privileges.
- Mutating work requires `mode: "accept-edits"` and each worker's **own existing linked Git worktree** rooted at an `agent/*` branch. Do not give two workers the same worktree. The bridge validates this before starting.
- Keep Codex as integration owner and final verifier; workers must return evidence, diffs and tests as applicable. Codex inspects local results and integrates explicitly.
- Do not pass secrets, credentials, private personal data, browser cookies or unapproved files. Do not use `--dangerously-skip-permissions`.
- Never claim Gemini results are unlimited or billable/free purely because Google AI Pro is active; check provider limits independently.
- If `health` fails, explain and use the approved local agent route. Never bypass provider authentication.

The CLI prints concise JSON summaries: `ok`, `workers[].label`, `workers[].response`, `workers[].conversationId`, token totals and durations. Persist only nonsensitive findings and references in the project's durable handoff.

Maintained in `menezes-platform/ops-codex-os`. Tests: `node --test tests/gemini-bridge.test.js`.
