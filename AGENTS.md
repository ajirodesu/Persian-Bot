# Project Rules (AGENTS.md)

Author credit: AjiroDesu

## Stack

- TypeScript in **strict mode** (`"strict": true`). No `any` without a justifying comment.
- Node.js, npm. Monorepo-aware: run scripts from the package you changed.
- English-only output (code comments, commits, docs).

## Workflow

1. Understand: read the relevant files before editing. Never guess paths.
2. Plan: for anything touching 3+ files, write a short plan first.
3. Implement: minimal, focused diffs. Match existing style.
4. Verify: use the `verify` tool (typecheck + lint + tests) before reporting done.
5. Report: files changed, what was verified, anything not verified.

## Delivery

- Deliver complete, working code directly to the correct file path.
- Individual files stay plain files, never zipped.
- Do not leave TODOs or placeholder stubs.

## UI

- Dark-mode-only interfaces.

## Safety

- Never read or print `.env*` or secrets. Never commit or push unless asked.
- Ask before destructive commands or dependency upgrades.
