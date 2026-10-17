// Author: AjiroDesu
import { tool } from "@opencode-ai/plugin"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

interface Step {
  readonly name: string
  readonly cmd: string
  readonly args: readonly string[]
}

function hasScript(name: string): boolean {
  if (!existsSync("package.json")) return false
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>
  }
  return Boolean(pkg.scripts?.[name])
}

export default tool({
  description:
    "Run typecheck, lint, and tests for the current package. Returns pass/fail per step with trimmed output.",
  args: {
    skip: tool.schema
      .string()
      .optional()
      .describe("Comma-separated steps to skip: typecheck,lint,test"),
  },
  async execute(args) {
    const skip = new Set((args.skip ?? "").split(",").map((s) => s.trim()))
    const steps: Step[] = [
      { name: "typecheck", cmd: "npx", args: ["tsc", "--noEmit"] },
      ...(hasScript("lint") ? [{ name: "lint", cmd: "npm", args: ["run", "lint"] }] : []),
      ...(hasScript("test") ? [{ name: "test", cmd: "npm", args: ["test", "--silent"] }] : []),
    ]

    const report: string[] = []
    for (const step of steps) {
      if (skip.has(step.name)) continue
      const r = spawnSync(step.cmd, step.args, { encoding: "utf8", shell: false })
      const ok = r.status === 0
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-30).join("\n")
      report.push(`[${ok ? "PASS" : "FAIL"}] ${step.name}${ok ? "" : `\n${out}`}`)
    }
    return report.join("\n\n")
  },
})
