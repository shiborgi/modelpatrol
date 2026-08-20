# AGENTS

ModelPatrol is developed with CodePatrol. Evolve it through the framework
rather than editing directly.

## Workflow

For every change, run the golden path using CodePatrol skills:

```
spec -> spec-review -> plan -> plan-review -> build -> build-review -> ship
```

- `spec`/`spec-review` describe the change (Initiative).
- `plan`/`plan-review` cover every acceptance criterion.
- `build` edits and commits in the isolated worktree; `build-review` runs the
  verification gate (`codepatrol.json`) and reviews the candidate independently.
- `ship` accepts or rolls back.

## Gates

- Quality gate: `npm run verify`.
- Release gate: `npm run release-check`.

## Rules

- Never hand-edit `refs/codepatrol/state`.
- Reviews must be unbiased: the same harness or model may produce and review,
  but the review is judged only against objective evidence (acceptance
  criteria, the verification gate, the diff), never the producer's claims.
- All documentation, comments, and generated artifacts (including remote
  artifacts such as wiki pages, milestones, issues, and issue comments) must
  be written in English.

## Stack

TypeScript, Node >= 22, zod. Build: `npm run build`. Test: `npm run test`.
