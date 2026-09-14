---
name: persistent-conversation-controller
description: Use when the user sends /persist or an explicitly authorized AI conversation must supervise a long-running workflow across chat context limits, session expiry, idle workers, tool loss, or repeated controller rollover until verified completion.
---

# Persistent Conversation Controller

## Contract

Persist the **workflow controller**, never one model context. Git and the project's established handoff remain authoritative for project facts. `CONTROL.md` is authoritative for controller generation, lease, notification, and takeover state.

A rollover is a **durable state transaction**. Browser tabs, chat titles, and visible UI are transport evidence or presentation only; they are never consensus or authority by themselves.

Every new persisted workflow should record a short human `DISPLAY_NAME` for user-facing chat organization (for example `Conthabil`, `Geometria`, or `MenezesDev`). Prefer the project/product name the user would naturally recognize; do not use branch names, task IDs, dates, or internal controller jargon as the display name.

`persistd` is the preferred controller. ChatGPT, Codex, Claude, Gemini, or another model is a worker. Codex is a worker, never a required controller dependency; when it is unavailable, use the authenticated ChatGPT worker path.

## Logical Decision Authority

Explicit `/persist` invocation authorizes the controller to execute without asking when an action is all of:
- reversible;
- low risk;
- inside the already-authorized task scope;
- logically determined by current evidence as the best safe option.

Do not stop for routine implementation choices, retries, worker selection, rollover timing, test commands, safe diagnostics, or equivalent reversible paths.

Stop only for authentication/MFA or genuinely required manual control, destructive or irreversible work lacking prior authority, material scope expansion, a materially ambiguous decision that logic/evidence cannot resolve, explicit cancellation, or the same blocker surviving three materially different safe attempts.

## Required Components

- `durable-execution-memory` and `project-handoff-manager` for project continuity when applicable.
- local `persistd` runtime for generation/lease arbitration.
- authenticated `ego-browser` task space as the primary browser transport.
- Remote Desktop Commander as a worker capability/recovery transport when local project access is required; it is not controller consensus evidence.
- `windows-desktop-operator` and the Dev-Orquestra Windows Interactive Control plane for native Windows UI work.
- Browser Bridge / Playwright for non-controller browser work when an authorized browser session is available.

Before any local, browser, or interactive mutation, **read and obey `references/remote-control-contract.md`**. This is a hard capability gate, not optional guidance. The worker must use the highest applicable healthy structured control layer and may not silently downgrade to ad-hoc shell UI automation or coordinates.

## State Loop

| State | Action |
|---|---|
| `ACTIVE` / `WORKING` | Observe and refresh lease; do not interfere while useful work continues |
| `WAITING_TOOL` | Recover tooling through the safest available worker path |
| `IDLE_INCOMPLETE` | Continue with unmet acceptance and the exact next reversible action |
| `CONTEXT_RISK` | Start preventive code-first rollover |
| `PREPARING_TAKEOVER` | N remains authoritative while successor is created |
| `ROLLOVER_INCOMPLETE` | Retry with materially different safe diagnostics; N remains authoritative |
| `AUTH_REQUIRED` | Preserve state and notify the user; never bypass authentication |
| `BLOCKED` | Try up to three materially different safe approaches |
| `DONE` | Preserve verified DoD and perform mandatory terminal notification |

An ended model response, saved baton, opened tab, submitted prompt, visible claim text, or worker saying "done" is never sufficient by itself.

## Generation and Lease Rule

The active controller generation is the highest **durably claimed** generation.

1. `persistd` obtains the run lock and refreshes the lease for `G<N>`.
2. It writes `STATUS: PREPARING_TAKEOVER`, `NEXT_GENERATION: N+1`, and a fresh `CLAIM_NONCE` while keeping `GENERATION: N`.
3. The browser transport reuses `persist:<RUN_ID>` and creates an authenticated successor chat through semantic DOM automation.
4. When local project access is needed, the transport attaches Remote Desktop Commander programmatically and verifies its composer attachment state.
5. The self-contained baton is submitted.
6. Successor `G<N+1>` reads this controller skill and `CONTROL.md` read-only, does not mutate the project, and replies with the wake line plus the exact nonce-bound request `CLAIM_REQUEST <RUN_ID> G<N+1> <CLAIM_NONCE>`.
7. `persistd` verifies that exact request in the successor chat, validates predecessor generation, status, `NEXT_GENERATION`, and nonce, and performs the durable promotion locally through the installed `claimGeneration()` implementation. Visible browser text alone never retires N.
8. After the durable promotion succeeds, `persistd` sends `CLAIM_CONFIRMED <RUN_ID> G<N+1> <CLAIM_NONCE>` to the same chat. Only after that confirmation may the successor reconstruct project state and continue without redoing verified work. Failed confirmation delivery never rolls authority back; it remains pending for retry. `CLAIM_CONFIRMED_AT` records delivery; `CLAIM_RESUMED_AT` is written only after the successor assistant turn is observed starting or already running, and is the monotonic proof that execution actually resumed.
9. Only after CLAIM_RESUMED_AT proves G<N+1> actually resumed, archive the exact predecessor G<N> chat. Never archive the predecessor before durable promotion plus resumed-successor proof; failed archival is lifecycle debt and must not roll controller authority back.

Two generations must never mutate concurrently. A higher unexpected generation or foreign live lease is a conflict to preserve and diagnose, never overwrite.

## Browser Transport

Primary transport is the already-authenticated persistent `ego-browser` Chromium task space. Reuse login state; do not re-authenticate per generation.

On Windows, keep a persisted browser profile on the same browser family that created it. The installed persistd transport prefers Microsoft Edge for the existing ego profile and must resolve the standard `Program Files (x86)` Edge path even when the parent environment omits `PROGRAMFILES(X86)`; never silently fall back to Chrome with that same profile.

Use semantic DOM/role/text locators and stable composer selectors. Do not make screenshots, coordinates, window focus, or pixel recognition part of the normal rollover path. Visual automation is fallback-only and never sufficient takeover evidence.

For every active run, keep at most one live browser tab: the durably promoted current chat. After successful promotion, prune predecessor, home, blank, and scratch tabs from that task space. After the successor is durably confirmed and `CLAIM_RESUMED_AT` is recorded, archive the predecessor conversation so only the current generation remains visible in the normal chat sidebar. If a successor attempt fails before durable promotion, close that exact chat or target immediately. Browser discovery is metadata-only: it may recover the task-space id, but it must never add chat ids to `CHAT_HISTORY_JSON`, change `CHAT_ID`, or authorize a rename. Only the exact successor `chatId` that passed nonce-bound durable promotion may be appended to history or renamed. Task-space cleanup at DONE remains a second barrier. Before starting or retrying a rollover, if the current chat is still generating an assistant turn, defer with `WORKER_BUSY` without incrementing rollover attempts or creating a successor.

A real expired login, CAPTCHA, MFA, or account challenge becomes `AUTH_REQUIRED`. Preserve the current generation and ask only for the minimum manual authentication required.

## Terminal Notification

`Gn` means the generation that reaches verified DoD, not a precomputed generation number. When `STATUS: DONE` is observed:

1. record `FINAL_GENERATION` and final project metadata;
2. deliver exactly one terminal notification;
3. prefer a user-visible completion response in the Gn ChatGPT conversation so normal ChatGPT app notification behavior can surface it;
4. use a local Windows toast as fallback;
5. mark `NOTIFICATION_STATUS: SENT` and `NOTIFIED_AT` only after delivery succeeds;
6. do not perform historical/bulk rename at DONE; mark legacy pending title work `SKIPPED_SAFE`;
7. immediately close the isolated `persist:<RUN_ID>` task space with `keep: false` so tabs opened by persistd do not remain open.

The only allowed automatic rename is the exact newly promoted successor chat while the run is active, because its `chatId` is already nonce-bound to the durable claim. Historical/bulk rename is prohibited. Browser cleanup is post-DONE lifecycle work only and must not wait for cosmetic title work. It must never alter `GENERATION`, `CLAIM_NONCE`, lease validity, verified DoD, or takeover authority. Preserve `CHAT_HISTORY_JSON`, `CHAT_TITLE_STATUS`, and `BROWSER_CLEANUP_STATUS` across successor claims. Legacy DONE runs without explicit pending lifecycle fields are not reopened retroactively.

Repeated daemon ticks must not duplicate a sent terminal notification. `AUTH_REQUIRED` and fatal blocked states may also notify; ordinary G1→G2→... rollovers stay silent.

## Stop Rule

Continue until verified DoD or one of the explicit stop conditions above. The controller, not an individual worker context, owns G1→G2→...→Gn continuity.
