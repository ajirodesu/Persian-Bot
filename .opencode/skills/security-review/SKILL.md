---
name: security-review
description: Security checklist for code review. Use when reviewing diffs, auth, input handling, dependencies, or secrets.
compatibility: opencode
metadata:
  author: AjiroDesu
---

Check each item and report file:line for problems:

- Secrets or tokens in code, logs, or commits; `.env` committed.
- Unvalidated input reaching SQL, shell, file paths, `eval`, or HTML (injection, traversal, XSS).
- Missing authn/authz on routes; trusting client-supplied IDs.
- Weak crypto, hand-rolled auth, permissive CORS.
- Unbounded requests (rate limits, body size), SSRF in fetch of user URLs.
- New dependencies: maintained, necessary, pinned.
  Classify each finding as blocking or advisory.
