---
name: reuse-first-router
description: Use before designing or implementing non-trivial functionality when an existing library, tool, CLI, service, template, skill, protocol, open-source project, or repository utility may already solve most of the requirement.
---

# Reuse-First Router

Avoid spending tokens, time, and maintenance effort reinventing solved problems.

## Prime directive
Before custom implementation, perform the cheapest useful search for an existing solution. Reuse or adapt when a mature option satisfies the material requirements with lower total complexity than building from scratch.

Do not browse broadly by default. **A local-only or private-only search is never sufficient evidence of no reuse.** For non-trivial new functionality, first inventory accessible repositories across all visibility levels and owners; then inspect only relevant candidates. Stop as soon as a clearly adequate candidate is found.

## Local vendor cache
The Gabriel Codex OS installer maintains a shallow local cache under `~/.agents/vendor/` for high-value reuse references. Prefer targeted search there before remote discovery when relevant.

Current vendor references:
- `awesome-harness-engineering` — harness architecture, memory, MCP, permissions, observability, evals, orchestration.
- `claude-skills` — large cross-agent skill catalog with Codex-compatible material.
- `agentmemory` — persistent-memory implementation/reference for coding agents.
- `andrej-karpathy-skills` — concise coding-agent behavior rules and failure-avoidance guidance.
- `ponytail` — YAGNI/reuse/minimal-code patterns for coding agents.
- `tencentdb-agent-memory` — layered memory assets, skills, wiki/code graph, and per-agent context loadouts.
- `ego-lite` — token-efficient browser automation patterns and an optional agent browser integration.
- `design-agent-skills` — `podo/design-agent-skills`, a layered design catalogue with permanent routers and implementation pointers that should be resolved on-demand.
- `motion-primitives` — animated UI primitives/components for modern frontend interfaces.
- `watermelon-platform` — React component registry and UI inspiration/reference source.
- `fontsource` — open-source font catalog and self-hosting packages for web typography, including Google Fonts and additional open-source families.
- `OpenManus` — open-source general AI agent framework for Manus-style agent workflows.
- `skill-manus` — zero-dependency Manus API CLI + skill wrapper for agentic integration.

These repositories are reference/candidate sources. Do not load them wholesale into context and do not activate third-party runtime code automatically.

Haikei is a special case: `haikei.app` is useful as a web-first SVG/background generator reference, but there is no verified official upstream GitHub repository in this toolkit. Treat it as a remote/web option and do not assume unrelated `haikei` repositories are official.

## Public API discovery policy
For public API discovery, use `public-apis/public-apis` as an index before building a custom integration, scraping a website, or reverse-engineering a private endpoint.

Treat the catalogue as discovery metadata, not as an authority or trust endorsement. After a candidate is found, verify it against the official provider documentation before adoption. Check at minimum current endpoint availability, authentication requirements, HTTPS support, rate limits, terms/licensing, data-use constraints, CORS where browser access matters, maintenance/deprecation status, and whether the provider exposes a more direct official SDK or API.

Prefer the official provider documentation and first-party repository over the catalogue entry when they disagree. Do not bulk-load the catalogue, do not call third-party endpoints automatically just because they are listed, and do not introduce scraping when a suitable documented public API already covers the requirement.

Manus source policy:
- For the official Manus product, service, API, or first-party integrations, prefer first-party sources: `https://github.com/manus-ai` and `manus.im`.
- `OpenManus` is a community open-source framework for Manus-style architecture/reference; do not describe it as the official Manus implementation.
- `skill-manus` is a community Manus API wrapper/skill and should be treated as an integration candidate, not a first-party SDK unless independently verified.

## Typography source policy
For web typography, inspect the project first. Reuse its existing type system when it is adequate; do not replace fonts just because Fontsource is available.

When new free/open fonts are materially useful:
- prefer `fontsource` as the first implementation/catalog route for self-hosted web fonts and framework/package integration;
- verify the exact font family's license before adoption, because licenses are family-specific;
- prefer self-hosting or package-based loading when it fits the stack and improves privacy, reliability, caching, or deployment control;
- avoid pulling the whole font catalog into an application or prompt; inspect metadata and install only the selected family, weights, styles, and subsets;
- for Google Fonts families, the canonical `google/fonts` repository remains a useful upstream source of font files and per-family license metadata.

Do not interpret "free font" as permission to ignore redistribution, modification, Reserved Font Name, attribution, or embedding terms.

## Frontend composition policy
Reuse must not collapse visual design into catalog assembly. Before choosing a component, effect, template, or asset library for frontend work, establish a one-sentence project-specific visual thesis from the project's real domain, audience, content, brand, and existing visual material.

- Treat component/effect libraries as an implementation source, not visual direction. Their demo composition, tokens, typography, motion, spacing, and copy are reference material, not defaults to preserve.
- Prefer domain-specific assets, diagrams, objects, data, imagery, and interaction metaphors. Generic decoration is not a substitute for project identity.
- Default to 1–2 signature interactions and make each one serve the thesis or product behavior. More components or effects are not evidence of better design.
- Apply the transplant test before accepting the visual result: if changing only the logo, name, and copy makes the same composition plausible for an unrelated SaaS, agency, local business, or product, the result is still generic and must be redesigned.

## Curated frontend source policy
When `$frontend-director` identifies a concrete frontend need, prefer these direct sources before broad discovery:

- design/product research -> Refero official skill/repository `referodesign/refero_skill`; use it research-first for real product patterns, design-system references, screens, and flows, then return findings to the Director.
- shadcn/Tailwind component reuse -> Cult UI `nolly-studio/cult-ui`; treat it as a component source, not visual direction, and adapt the selected primitive to the project's tokens and composition. Cult Pro is not part of automatic routing and must not be assumed available.
- animated 3D gradient / shader need -> ShaderGradient `ruucm/shadergradient`; use only when the visual thesis justifies WebGL/shader cost, and verify stack compatibility, bundle/rendering performance, mobile behavior, and `prefers-reduced-motion`.

These three routes are remote/on-demand by default. Do not bulk-clone or install their runtime dependencies merely because they are known sources. Existing project code and already-installed dependencies remain Tier 0 and win when adequate.

## Design skill catalogue policy
For design, frontend, UX, motion, accessibility, content-design, and design-review work, use `podo/design-agent-skills` as the first catalogue layer after checking the active project. Start with its `design-catalogue` or the smallest relevant domain catalogue, then resolve only the selected implementation pointer on-demand.

When a non-trivial frontend task is already owned by `$frontend-director`, this router is subordinate discovery/reuse infrastructure. Return reuse candidates, catalogue pointers, and adoption guidance to the director; do not take ownership of the task, create a competing orchestration loop, or require the user to coordinate the selected frontend specialists manually.

The 42 skills below are Gabriel Codex OS's preferred design cohort. When one materially fits the request, prefer it before exploring the broader catalogue:
- frontend/UI: `frontend-design`, `impeccable`, `taste-skill`, `make-interfaces-better`, `color-expert`, `design-tokens-skill`, `design-system-governance`, `brandkit`, `format-storybook`, `mobile-app-design`;
- image/graphics/video: `canvas-design`, `algorithmic-art`, `p5js-hermes`, `shader-dev`, `animate-skill`, `css-animation-skill`, `wiggle-claude-skill`, `remotion-best-practices`;
- product/interaction: `work-with-design-systems`, `extract-design-md`, `taste-design-stitch`, `design-html`, `information-architecture-and-navigation`, `interfaces-that-feel`, `search-ux`, `neo-user-journey`, `design-auditor`, `fixing-accessibility`;
- behavior/content: `design-brief`, `design-consultation`, `ux-writing-skill`, `content-strategy`, `copywriting-skill`, `product-position`, `user-research-cookiy`, `software-ux-research`;
- quality/evaluation: `plan-design-review`, `design-review-garrytan`, `design-debt-audit`, `design-impact-reporting`, `cloudflare-web-perf`, `dark-pattern-audit`.

Current catalogue coverage was verified before adding this route. Three preferred names are direct-source exceptions rather than exact entries in the current `podo/design-agent-skills` catalogue:
- `brandkit` -> `nexu-io/open-design`;
- `canvas-design` -> `anthropics/skills`;
- `remotion-best-practices` -> `remotion-dev/skills`.

For those exceptions, inspect/install only the named upstream skill when it is actually selected. Do not promote the whole upstream repository to runtime merely to expose one skill.

Do not bulk-install all 42 preferred skills or the full design catalogue. Do not load their complete `SKILL.md` files into every prompt. The vendor clone is an index/reference cache; implementation skills remain on-demand. If none of the preferred 42 fits, consult the broader `design-agent-skills` catalogue before broad web/GitHub discovery.

This routing does not override project identity. Preserve the project's existing design system, approved visual thesis, domain-specific assets, and transplant-test requirements; catalogue skills are implementation/review capabilities, not automatic visual direction.

## Existing composed baselines
Preserve the approved higher-level routes already used by the active router:
- website/web-application SEO and GEO work -> `web-seo-baseline`, composing `nowork-studio/notfair-plugin` with the approved Alireza SEO skill set;
- gamification work -> `gamification-baseline`, composing `trophyso/ui` for UI/interaction patterns with `marquespq/questro` for mechanics/state-model patterns.

These are composed baselines, not permission to import either upstream wholesale.

## Search ladder
Use this order unless the task gives a stronger source of truth:

### Tier 0 — Already here
Check only what is cheap and local:
- existing project code and utilities
- current dependencies
- repo-local scripts and CLIs
- repo-local `AGENTS.md` and skills
- durable decisions documenting previously chosen tools

If an adequate solution exists here, use it and stop.

### Tier 0.5 — Cross-repository inventory (mandatory when local Tier 0 has no adequate solution)
- Enumerate **all repositories accessible through connected GitHub accounts and organizations**, including **public, private, and internal repositories**. Paginate the inventory instead of trusting one default-size page.
- Include repositories across owners/organizations, relevant forks and archived repositories; distinguish `not found` from `not accessible` and document any visibility or pagination gap.
- Search names/descriptions first, then targeted code, docs, project decisions, branches, PRs, and issues for reusable capabilities. Do not limit candidates to names matching the request, or to the default branch if a credible pointer indicates work elsewhere.
- Favor least-privilege inspection: avoid copying private project data into public reports and avoid dumping entire source trees.
- If a suitable owned candidate exists, reuse it or record the concrete reason it cannot be reused. If none exists, proceed to public ecosystem discovery.
- An inventory is metadata discovery, **not** a requirement to read every file in every repository. Report the checked scope when saying that no existing solution was found.

### Tier 1 — Known toolbox
Check the smallest relevant known reference, preferably in `~/.agents/vendor/`, not all of them:
- LLM apps / agents / RAG / multi-agent -> `awesome-llm-apps`
- GPT Image 2 / image generation -> `awesome-gpt-image-2`
- context engineering / hierarchical loading -> OpenViking patterns
- durable execution / recovery -> Apache Maka patterns
- harness / orchestration / agent runtime -> `awesome-harness-engineering`
- reusable agent skills -> `claude-skills`
- coding-agent memory -> `agentmemory`
- team memory assets / code knowledge / per-agent loadouts -> `tencentdb-agent-memory`
- coding-behavior pitfalls -> `andrej-karpathy-skills`
- YAGNI / smallest-code solution -> `ponytail`
- browser automation / web workflows -> `ego-lite` when the environment and constraints fit
- public API discovery / avoid unnecessary scraping -> `public-apis/public-apis`, then verify the selected provider in official docs
- design / frontend / UX / motion / accessibility / design review -> `design-agent-skills` via `design-catalogue`, preferring the 42-skill cohort and resolving the chosen skill on-demand
- animated frontend motion/UI patterns -> `motion-primitives`
- component registry / shadcn-style UI exploration -> `watermelon-platform`
- free/open web fonts, self-hosting, font package selection -> `fontsource`
- official Google Fonts files/license metadata -> `https://github.com/google/fonts`
- official Manus product/API / first-party integrations -> `https://github.com/manus-ai` + `manus.im`
- Manus-style open agent framework -> `OpenManus`
- Manus API integration / CLI wrapper -> `skill-manus`
- SVG background generation (web-first, not local vendor) -> `haikei.app`

Inspect indexes, README sections, names, or targeted search results first. Do not ingest the whole repository.

### Tier 2 — Mature ecosystem
Only if Tier 0–1 do not solve the problem, search the relevant ecosystem for established packages, CLIs, SDKs, protocols, or services.

Prefer candidates with:
- active maintenance
- clear documentation
- compatible license
- reasonable security posture
- strong fit with the existing stack
- low integration and operational overhead

### Tier 3 — Broad discovery
Search **external public/open-source GitHub repositories** and the wider web when a meaningful capability gap remains after local, cross-repository, and curated discovery. Search by the capability needed, not vague technology buzzwords. Public upstream projects are not excluded because the connected account does not own them.

Stop after finding a small shortlist of credible candidates. Do not spend tokens exhaustively ranking dozens of near-equivalent tools unless the choice is high-impact.

### Tier 4 — Custom build
Build custom only when:
- no existing option covers the material requirement;
- available options violate license, security, privacy, deployment, performance, or cost constraints;
- integration complexity exceeds the custom implementation;
- the needed behavior is genuinely project-specific;
- or the custom solution is materially smaller and easier to maintain.

When custom-building despite a plausible reusable candidate, record the concrete reason.

## Browser automation discipline
For non-trivial browser workflows, prefer a solution that reduces observation/action round-trips. If a browser tool supports composing several deterministic page actions into one script or bounded execution unit, prefer that over a long sequence of tiny tool calls when it remains observable and safe.

Evaluate browser reuse candidates for:
- platform support
- authentication/session handling
- isolation between user and agent browsing
- snapshot/DOM quality
- token/tool-call overhead
- ability to compose multi-step actions
- privacy and local-data handling
- recoverability when a step fails

`ego-lite` is a useful reference/candidate for this pattern, but its browser runtime is currently macOS-focused. Do not assume it can be activated on unsupported platforms; reuse the execution pattern or select another browser tool when necessary.

## Candidate triage
For each serious reuse candidate, answer only what matters:
- What percentage of the requirement does it cover?
- What adaptation is still needed?
- License compatible?
- Maintained enough?
- Security/privacy acceptable?
- Fits current stack/deployment?
- New operational burden?
- Does it reduce code, tokens, maintenance, or failure surface?

Reject quickly when a hard constraint fails. Do not perform deep analysis of obviously unsuitable candidates.

## Token discipline
- Search indexes before full docs.
- Read README/overview before source.
- Read source only for the integration path or uncertainty that affects adoption.
- Search the local vendor cache before repeating remote fetches.
- Do not inspect entire repositories merely to learn what they do.
- Do not compare more than a few credible options unless the decision has high switching cost.
- Cache durable decisions in `docs/context/DECISIONS.md` when future sessions would otherwise repeat the same comparison.
- Reuse prior evaluations if the tool and requirements have not materially changed.

## Composition over adoption
A "Swiss-army knife" does not have to be adopted wholesale. Prefer the cheapest safe reuse level:
1. existing feature as-is
2. configuration
3. adapter/wrapper
4. selective module or pattern
5. fork only when justified
6. custom implementation as last resort

Avoid adding a large framework to solve a tiny isolated problem.

## Interaction with other skills
- When a non-trivial frontend task is already owned by `$frontend-director`, this router is subordinate discovery/reuse infrastructure. Return reuse candidates, catalogue pointers, and adoption guidance to the director; do not take ownership of the task, create a competing orchestration loop, or require the user to coordinate the selected frontend specialists manually.
- Use `$context-budget-manager` to keep discovery narrow.
- Use `$llm-app-pattern-library` for LLM application patterns.
- Use `$visual-quality-director` for visual tasks.
- Use `$durable-execution-memory` to persist important adoption decisions and avoid repeating research across sessions.

## Completion rule
Before implementing a non-trivial custom subsystem, be able to state one of:
- `reuse_selected`: an existing solution is being used or adapted;
- `reuse_not_needed`: the repo already solves it or the task is trivial;
- `custom_justified`: reusable candidates were checked and failed named material constraints.

Never use `custom_justified` merely because writing code feels faster than looking for an existing solution.

A negative result must state the owned-repository inventory scope (accounts/organizations, visibility, pagination/access limitations) and the external public repository search attempted. Do not claim "no reuse" after checking only private repositories.