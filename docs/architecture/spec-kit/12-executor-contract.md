# 12 — Luna Executor Contract

## Immutable execution law

**SPEC KIT IS AUTHORITATIVE**

The executor is an implementation agent, not the migration architect.

The executor must obey all of the following literally:

- **DO NOT MODIFY THE SPEC KIT TO MAKE IMPLEMENTATION PASS**
- **DO NOT INTRODUCE NEW AUTHORITIES OR CONTROL PLANES**
- **DO NOT BYPASS FAILED GATES**
- Do not redesign the target architecture.
- Do not introduce new permanent databases, providers, retrieval runtimes, leader-election schemes, or multi-primary execution outside approved scope.
- Do not preserve legacy code merely for safety when its registered removal gate has passed.
- Do not claim tests, deploys, migrations, archive actions, caller counts, or runtime state without fresh evidence.
- Do not infer current runtime truth from stale documentation.
- Do not broaden project scope beyond the deterministic or explicitly allowlisted scope.
- Do not use a framework/vendor type as a new public platform contract.

## Required reading before mutation

At the start of a migration generation, read:

1. 00-constitution.md;
2. 01-current-architecture.md;
3. 02-target-architecture.md;
4. 03-authority-matrix.md;
5. 05-dependency-graph.md;
6. 06-deletion-map.md;
7. the current phase in 07-migration-phases.md;
8. relevant gates in 08-architecture-gates.md;
9. rollback requirements in 09-rollout-rollback.md;
10. current-phase acceptance in 10-acceptance-criteria.md;
11. current repository/runtime evidence.

The executor must not assume the previous conversation is authoritative execution history.

## Phase loop

For every phase:

1. resolve current phase from durable checkpoint/evidence;
2. verify entry conditions;
3. inspect current repo/runtime truth;
4. record a phase start checkpoint;
5. perform only allowed mutations;
6. run functional tests;
7. run architecture/security/data gates;
8. verify rollback artifact;
9. compare actual state to target topology, authority matrix and deletion map;
10. commit/checkpoint;
11. verify exit conditions;
12. continue automatically to the next phase.

A failed automatic gate means:

    diagnose -> fix inside approved architecture -> rerun gate

It does not mean ask the human what to do.

## Valid residual human gates

Autonomous execution stops only for the approved residual categories:

- required credential/account consent is unavailable and no authorized alternative exists;
- irreversible/destructive action lies outside the approved deletion policy;
- materially new evidence proves a constitutional assumption impossible or unsafe;
- explicit cost-producing infrastructure is required but not already authorized;
- an external provider requires direct human account consent.

If a blocker does not fit one of those categories, the executor makes the narrowest ruling consistent with the Spec Kit, records it, and continues.

## Checkpoint contract

Every durable execution checkpoint must record:

- phase_id;
- repository refs/commit SHAs;
- completed gate IDs;
- active shim IDs;
- pending gate IDs;
- migration receipts;
- rollback artifact locator/status;
- authority audit result;
- architecture drift result;
- blockers;
- next safe action.

A checkpoint that says only working or mostly done is invalid.

## Drift gate

At every checkpoint compare actual state against:

- 02-target-architecture.md;
- 03-authority-matrix.md;
- 05-dependency-graph.md;
- 06-deletion-map.md.

Functional success does not excuse architecture drift.

Examples of drift that block phase completion:

- a second writer appears for an authoritative domain;
- a new direct provider call bypasses Provider Gateway;
- a worker stores canonical run state;
- a project retrieval path can widen scope implicitly;
- a shim passes its removal gate but remains active;
- a legacy repository remains live after its archive gate passes.

## Evidence rule

For every completion assertion capture the command/tool/source that proves it.

Examples:

- tests -> command + pass/fail counts;
- caller count -> search/query result;
- deploy health -> live probe;
- repo archive -> provider repository state;
- migration -> receipt + source/target refs;
- deletion -> caller=0 + preserved ref + resulting state.

Agent self-report is never sufficient evidence.

## Copy-ready takeover prompt

    TAKEOVER — PLATFORM CONSOLIDATION

    CONTINUE THE PLATFORM CONSOLIDATION FROM THE APPROVED SPEC KIT. DO NOT REDESIGN.

    AUTHORITATIVE ARCHITECTURE:
    docs/architecture/spec-kit/

    READ BEFORE MUTATION:
    - 00-constitution.md
    - 01-current-architecture.md
    - 02-target-architecture.md
    - 03-authority-matrix.md
    - 05-dependency-graph.md
    - 06-deletion-map.md
    - current phase in 07-migration-phases.md
    - relevant gates in 08-architecture-gates.md
    - 09-rollout-rollback.md
    - current phase acceptance in 10-acceptance-criteria.md
    - 11-definition-of-done.md
    - current repository/runtime evidence

    SPEC KIT IS AUTHORITATIVE.

    DO NOT MODIFY THE SPEC KIT TO MAKE IMPLEMENTATION PASS.
    DO NOT INTRODUCE NEW AUTHORITIES OR CONTROL PLANES.
    DO NOT BYPASS FAILED GATES.
    DO NOT PRESERVE LEGACY AFTER ITS APPROVED REMOVAL GATE.
    DO NOT CLAIM TEST/DEPLOY/MIGRATION SUCCESS WITHOUT FRESH EVIDENCE.
    DO NOT TREAT STALE DOCUMENTATION AS CURRENT RUNTIME TRUTH.

    EXECUTION LOOP:
    1. recover the latest durable checkpoint;
    2. identify the current P00-P12 phase;
    3. verify entry gates with fresh evidence;
    4. execute only allowed mutations;
    5. test;
    6. run architecture/security/data gates;
    7. verify rollback artifact;
    8. audit authority/dependency/deletion drift;
    9. commit and checkpoint;
    10. verify exit criteria;
    11. continue automatically.

    WHEN A NORMAL GATE FAILS:
    diagnose -> correct inside the approved target design -> rerun.
    Do not stop for ordinary implementation ambiguity or debugging.

    STOP ONLY FOR A VALID RESIDUAL HUMAN GATE:
    - missing required credential/account consent with no authorized alternative;
    - irreversible/destructive action outside approved deletion policy;
    - new evidence invalidating a constitutional assumption;
    - unapproved cost-producing infrastructure;
    - external provider action requiring direct human consent.

    NO PAID CLOUD/AI/INFRA EXPANSION WITHOUT EXPLICIT AUTHORIZATION.

    DEFINITION OF DONE:
    11-definition-of-done.md is binding.
    New architecture works is insufficient if obsolete architecture remains.

    CONTINUE UNTIL DoD OR A VALID RESIDUAL HUMAN GATE.

## Executor non-authorities

The executor itself is not an authority for:

- project truth;
- personal memory;
- run state;
- local runtime state;
- secrets;
- retrieval corpus truth;
- architectural policy.

It operates through the modules and gates that own those domains.
