# Project AGENTS.md

This file contains repo-specific instructions for Codex.

## Project identity
- Project:
- Goal:
- Primary stack:
- Deployment target:

## Non-negotiable rules
- Preserve approved work unless change is required.
- Keep scope tight.
- Prefer explicit, reviewable changes.

## Architecture notes
- Main app path:
- Key folders:
- Important commands:
- Environment notes:

## Quality rules
- Required validations:
- Performance goals:
- Accessibility notes:
- SEO notes:

## Visual/UX notes
- Brand tone:
- Layout priorities:
- Asset rules:

## Project specification contract
- This repository must have durable project-level sources of truth appropriate to its type before non-trivial work proceeds.
- Map the local files that satisfy the global contract below. Reuse existing equivalent documents instead of duplicating them.
- Product/system requirements:
- Architecture:
- Design system (UI projects only):
- Security:
- Testing:
- Code style (when not fully enforced by tooling):
- Feature specs/plans under `docs/superpowers/` do not replace the durable project-level documents above.

## Durable continuity
- Treat `docs/context/*` and observable Git/repository state as durable project memory.
- On resume, verify current branch/state and read the relevant context files before repeating previous work.
- Do not infer that work was lost merely because it is missing from the current conversation context.
- Record operational facts and decisions, not private chain-of-thought.
- Never place secrets or credentials in durable context.

## Handoff convention
- Update `docs/context/STATE.md` for durable state changes.
- Update `docs/context/DECISIONS.md` for durable project decisions.
- Update `docs/context/HANDOFF.md` before pausing a session, including completed work, validations, blockers, and the exact next safe action.
- Keep `docs/context/ACCEPTANCE_CRITERIA.md` aligned with the actual completion gates.
- When resuming after interruption, reconcile these notes against Git status/history and other observable evidence before acting.
