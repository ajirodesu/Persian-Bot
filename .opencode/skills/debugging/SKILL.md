---
name: debugging
description: Systematic root-cause debugging. Use when a bug, crash, failing test, or unexpected behavior is reported.
compatibility: opencode
metadata:
  author: AjiroDesu
---

1. Reproduce: get the exact command, input, and error. No fix without a repro.
2. Localize: read the stack trace, then the failing code and its callers.
3. Hypothesize: list 2-3 causes, test the cheapest first (logs, a failing test).
4. Fix the root cause, not the symptom. Smallest possible diff.
5. Prove: add a regression test, run the `verify` tool, confirm the original repro passes.
6. Report cause, fix, and evidence.
