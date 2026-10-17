// Author: AjiroDesu
import type { Plugin } from "@opencode-ai/plugin"

const SECRET_PATH = /(^|\/)\.env(\.|$)|id_rsa|\.pem$|secrets?\./i
const DANGEROUS_CMD = /rm\s+-rf\s+\/|git\s+push\s+.*--force|curl[^|]*\|\s*(ba)?sh/i

export const GuardPlugin: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const args = output.args as Record<string, unknown>

      if (input.tool === "read" || input.tool === "edit" || input.tool === "write") {
        const p = String(args.filePath ?? "")
        if (SECRET_PATH.test(p)) {
          throw new Error(`Blocked: ${p} looks like a secrets file.`)
        }
      }

      if (input.tool === "bash") {
        const cmd = String(args.command ?? "")
        if (DANGEROUS_CMD.test(cmd) || /\.env/.test(cmd)) {
          throw new Error(`Blocked unsafe command: ${cmd}`)
        }
      }
    },
  }
}
