---
name: git-workflow
description: Commit, branch, and PR conventions. Use when the user asks to commit, write a commit message, or prepare a pull request.
compatibility: opencode
metadata:
  author: AjiroDesu
---

# Git Workflow

## Commits

Conventional Commits: `type(scope): summary` (feat, fix, refactor, docs, test, chore).
Summary under 72 chars, imperative. Body explains why.

## Procedure

1. `git status` and `git diff` to review.
2. Stage only related files. One logical change per commit.
3. Never push, force-push, or amend published commits unless explicitly asked.

## PR description

Summary, changes list, how it was verified, risks.
