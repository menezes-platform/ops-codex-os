---
name: shipping-functional-slices
description: Use when planning or implementing a new app, feature, automation, agent, integration, or roadmap where substantial work could accumulate before any useful end-to-end behavior exists.
---

# Shipping Functional Slices

**Rule:** The first delivery task must produce the smallest **safe, runnable end-to-end outcome**. Every later task improves or expands something already usable. Treat an approved existing capability as the starting slice; never rebuild it merely to satisfy this pattern.

## Plan from user value, not components

1. State the smallest user-visible outcome: **"[Actor] provides [real input] through [entrypoint] and receives [observable result]."**
2. Identify the minimum existing components, dependencies, credentials, and security controls needed for that flow. Apply the project's durable specs, reuse-first policy, and established acceptance gates before inventing infrastructure.
3. Make **Task 1 — Functional Slice** implement and verify that single end-to-end path. Include the run command/URL, one representative input, expected output, focused tests, and evidence to capture.
4. Put independently valuable refinements in **Task 2+**: reliability, UX, features, instrumentation, performance, and scale. Bring prerequisites into Task 1 only when the first outcome cannot safely work without them.
5. Re-plan around the *earliest still-missing executable slice* for an existing project. Preserve completed work and established task IDs; do not renumber an approved plan just to satisfy a naming convention.

## Definition of Done for Task 1

Task 1 is DONE only when all of these hold:

- A real entrypoint starts/runs; the operator can repeat it using documented steps.
- A **real input** traverses the required components and creates the promised **observable result**. Stub-only demos are not end-to-end proof of a real external integration.
- The narrowest relevant automated tests and an actual functional smoke check pass, with commands, results, revision, and limitations recorded as **evidence**.
- Minimum correctness, authentication/authorization, privacy, data integrity, and operational **security** gates for the exercised path are met. Never defer mandatory safety controls to later polish.
- The acceptance scope is explicit: a local-only prototype may be DONE as *local-only*, never described as a production release.

If an external dependency is inaccessible, finish and verify any independent local slice, label external verification **BLOCKED**, and keep the integrated DoD open. A code-only PR or **source-only** artifact is not proof of a running feature. **No deployment** or irreversible production action is authorized by this skill.

## Plan shape

| Slot | Required contents |
|---|---|
| Outcome | One actor, entrypoint, real input, observable result |
| Task 1 | Thin executable path, prerequisites, test, smoke evidence, DoD |
| Task 2+ | Ordered, independently optional improvements with their own acceptance criteria |
| Deferred | Explicit nonessential enhancements, costs, and infrastructure |
| Boundaries | Existing work preserved, security gates, blockers, release scope |

## Pressure checks

- "Let's build orchestration, dashboards, and a data platform first." → Prove one complete useful operation before adding optional control planes.
- "The mocks pass, so the API integration is done." → A mock verifies local logic; real integration remains unverified.
- "Security can be polished in Task 4." → If required to exercise the first path safely, security is part of Task 1.
- "The user asked for the entire architecture." → Document the target architecture, but implement the smallest production-appropriate slice first unless the approved requirements explicitly demand an indivisible prerequisite.

Apply alongside Superpowers planning, test-driven development, and verification skills when available; this skill determines *delivery order*, not permission to skip their gates.
