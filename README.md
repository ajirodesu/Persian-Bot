# OpenCode Agentic Workflow Setup

Author: AjiroDesu

Copy `opencode.json`, `AGENTS.md`, and `.opencode/` into your project root
(or into `~/.config/opencode/` for global use).

1. `cd .opencode && npm install`
2. Export `CONTEXT7_API_KEY` (optional) and `GITHUB_TOKEN` (see `.env.example`).
3. Run `opencode`, then `/ship <task>`.

## Agents

orchestrator -> researcher -> planner -> builder -> tester -> reviewer

## MCP servers (disabled globally, enabled per agent)

| Server              | Agents                       |
| ------------------- | ---------------------------- |
| context7            | planner, builder, researcher |
| github              | reviewer, researcher         |
| playwright          | tester                       |
| sequential-thinking | planner                      |
| memory              | orchestrator, planner        |

## Skills (.opencode/skills)

typescript-strict, git-workflow, rest-api-design, debugging, security-review, dark-ui, mcp-usage.
Add your own: `.opencode/skills/<name>/SKILL.md` with `name` matching the folder.

## Commands

/ship /plan /fix /review /test
