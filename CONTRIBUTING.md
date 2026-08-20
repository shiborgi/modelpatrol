# Contributing

Thank you for contributing to ModelPatrol. ModelPatrol is a local-first LLM
proxy for coding agents, and it is developed with CodePatrol through the
golden path below.

## Golden path

Every change flows through the lifecycle, one stage at a time:

```text
spec → spec-review → plan → plan-review → build → build-review → ship
```

- `spec`/`spec-review` describe the change as an Initiative (Waves of Works,
  each Work with acceptance criteria).
- `plan`/`plan-review` cover every acceptance criterion with decisions.
- `build` edits and commits in an isolated worktree; `build-review` runs the
  verification gate and reviews the candidate independently.
- `ship` integrates the reviewed candidate onto `main`, or rolls it back.

Reviews must be unbiased: the same harness or model may produce and review,
but the review is judged only against objective evidence — acceptance
coverage, the verification gate and the diff.

## Gates

- Quality gate: `npm run verify`
- Release gate: `npm run release-check`

Both must pass before a change is considered done.

## Rules

- Never hand-edit `refs/codepatrol/state`.
- All documentation, comments and generated artifacts (including remote
  artifacts such as wiki pages, milestones, issues and issue comments) must be
  written in English.

## Stack

TypeScript, Node >= 22, zod. Build with `npm run build`; test with
`npm run test`.
