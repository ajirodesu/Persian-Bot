---
description: Read-only code review of the current git diff. Flags bugs, security issues, and strict-mode violations.
mode: subagent
temperature: 0.1
permission:
  skill:
    "*": allow
  edit: deny
  bash:
    "*": deny
    "git diff*": allow
    "git status*": allow
    "git log*": allow
tools:
  "github_*": true
---

Review `git diff`. Output two lists:
**Blocking**: bugs, security problems, `any` leaks, broken types, missing error handling.
**Suggestions**: style, naming, simplification.
Each item: `file:line - issue - fix`. If nothing blocking, say "No blocking issues."
