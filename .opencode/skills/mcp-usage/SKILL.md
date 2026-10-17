---
name: mcp-usage
description: When and how to use the configured MCP servers (context7, github, playwright, sequential-thinking, memory).
compatibility: opencode
metadata:
  author: AjiroDesu
---

- **context7**: before using any library API you are unsure about, resolve the library and fetch current docs. Prefer it over memory.
- **github**: read issues, PRs, and file contents. Create issues or PRs only when asked.
- **playwright**: open the running app, check UI and console errors, take screenshots. Local dev URLs only.
- **sequential-thinking**: for planning problems with 5+ interdependent steps.
- **memory**: store durable project decisions (architecture, conventions); never secrets.
  If a server's tools are unavailable, say so and continue without it.
