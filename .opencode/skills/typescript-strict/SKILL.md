---
name: typescript-strict
description: Write and fix TypeScript under strict mode. Use when adding types, removing any, fixing tsc errors, or configuring tsconfig.
compatibility: opencode
metadata:
  author: AjiroDesu
---

# TypeScript Strict

## Rules

- `tsconfig`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.
- Replace `any` with `unknown` and narrow with type guards or zod.
- Prefer `interface` for object shapes, `type` for unions. Use `readonly` where possible.
- Exhaustive switches: `default: { const _n: never = x; throw new Error(String(_n)) }`.
- Never use non-null `!` or `as` casts to silence errors; fix the type.
- Exported functions get explicit return types.

## Fixing tsc errors

1. Run `npx tsc --noEmit`, fix the first error in dependency order (types before callers).
2. Re-run until clean. Do not add `// @ts-ignore`.
