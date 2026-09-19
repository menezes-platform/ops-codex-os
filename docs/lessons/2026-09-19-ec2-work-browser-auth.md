# EC2 Work browser/auth lesson — 2026-09-19

## Context
While dispatching a Gabriel Ops Dashboard UX iteration through the ChatGPT Work session on EC2 `EC2AMAZ-7IT0M73`, multiple browser profiles existed and runtime/browser claims were ambiguous.

## Observed failure modes
- A Chromium clone can expose an HTTP DevTools target while refusing or stalling a second CDP/WebSocket controller.
- Current Chromium protects remote debugging of default user-data directories; adding a debug port to the default profile is not a reliable way to reuse a signed-in browser session.
- Restarting an AKI Chromium *clone* under an owned automation controller is safe when isolated to that clone and preserves the clone's profile state, but it cannot recover a ChatGPT login that is already absent from that profile.
- A browser title containing “ChatGPT: Chat, Work, Create & Code with AI” does not prove an authenticated ChatGPT session. Accessibility state must be inspected for account/login controls.
- The persistd Edge profile retained account recognition but stopped at OpenAI MFA. MFA is a genuine human gate; do not attempt to bypass or harvest authentication factors.

## Reuse-first recovery order
1. Confirm machine, canonical repo, Git state, and lane before touching browsers.
2. Enumerate existing browser/profile targets and distinguish product runtime tabs from ChatGPT agent sessions.
3. Prefer the existing automation-native controller for cloned profiles instead of raw CDP attachment.
4. If a clone is locked by its original browser process, terminate only that clone's process tree, then reopen the same clone directory under the supported automation client.
5. Verify authentication from DOM/accessibility content, not title or memory.
6. If every reusable session is logged out and the only recognized account is at MFA, stop at the human gate and leave the requested execution prompt staged.
7. Never modify the product lane merely to work around an authentication/control-plane problem.

## Dashboard-specific outcome
- Canonical checkout remained `C:\persistd-work\Gabriel-Ops-all-sources`.
- Existing unrelated branch `fix/private-source-http-transport-20260919` and its logs were left untouched.
- A dashboard Work prompt was staged outside the repo at `C:\ProgramData\Persistd\dashboard-work-next-prompt.txt`.
- No duplicate Dashboard lane or `ttk-live-dungeon` mutation was created during recovery.
