/**
 * AI Agent — Tool Registry
 *
 * Every tool in this directory follows the SAME unified shape:
 *
 *   export const meta: ToolMeta = { name, description, parameters };
 *   export const initialize = async (args, ctx: ToolContext) => Promise<string>;
 *
 * getTools() collects every `{ meta, initialize }` pair into the schema list
 * exposed to the LLM (shell gated behind the user's shellEnabled setting).
 * executeTool()
 * dispatches a provider tool call to the matching initialize. run_command is
 * still intercepted upstream in the agent runner before reaching executeTool,
 * so its initialize is a fallback used only on direct dispatch.
 */

import type { AgentTool, ToolContext } from './types.js';

import * as helpTool from './help.js';
import * as testCommandTool from './test_command.js';
import * as sendResultTool from './send_results.js';
import * as userInfoTool from './user-info.js';
import * as groupInfoTool from './group-info.js';
import * as botStatsTool from './bot-stats.js';
import * as listCommandsTool from './list-commands.js';
import * as runCommandTool from './run-command.js';
import * as browserTool from './browser.js';
import * as shellTool from './shell.js';
import * as sendFileTool from './send-file.js';

export type { AgentTool, ToolContext } from './types.js';

// All tools, in exposure order. The LLM sees exactly this list (minus shell
// when disabled) — the new command-aware flow (help → test_command →
// send_result) sits alongside the classic helper tools.
const ALL_TOOLS: AgentTool[] = [
  helpTool,
  testCommandTool,
  sendResultTool,
  userInfoTool,
  groupInfoTool,
  botStatsTool,
  listCommandsTool,
  runCommandTool,
  browserTool,
  sendFileTool,
];

/**
 * Builds the tool list exposed to the LLM. The shell tool is gated behind the
 * user's web-configured shellEnabled setting (defaults to true when unset).
 */
export function getTools(shellEnabled?: boolean): AgentTool[] {
  const tools = ALL_TOOLS.filter((t) => t.meta.name !== 'shell');
  const enabled = shellEnabled ?? true;
  if (enabled) tools.push(shellTool);
  return tools;
}

/** Dispatches a provider tool call to the matching initialize. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = ALL_TOOLS.find((t) => t.meta.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  return tool.initialize(args, ctx);
}
