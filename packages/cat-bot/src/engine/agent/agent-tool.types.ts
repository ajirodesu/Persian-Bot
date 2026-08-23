/**
 * AI Agent — Tool Types
 *
 * Every agent tool follows ONE unified shape:
 *
 *   export const meta: ToolMeta = { name, description, parameters };
 *   export const initialize = async (args, ctx: ToolContext) => Promise<string>;
 *
 * The `meta` object is the JSON-schema contract exposed to the LLM through an
 * in-process MCP server (see mcp-tools.lib.ts): the runner lists tools via
 * listTools and dispatches calls via callTool. `initialize` runs the tool
 * against the live bot context.
 *
 * ToolContext extends BaseCtx so tools have both the narrowed helper surface
 * (sendFile, getUserInfo, ...) AND the full live bot context (api, event,
 * commands, prefix, native) needed by command-aware tools such as help,
 * test_command and send_result.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';

/** JSON-schema tool contract exposed to the LLM (OpenAI-compatible shape). */
export interface ToolMeta {
  name: string;
  description: string;
  /**
   * When true the tool is SYSTEM-ADMIN ONLY: it is filtered out of the tool
   * list for non-admins (see mcp-tools.lib.ts) AND re-checks the caller's
   * system-admin status inside initialize before doing anything.
   */
  adminOnly?: boolean;
  parameters: {
    type: 'object';
    // Value shape mirrors the provider SDKs' function parameters (type, items,
    // description, enum) while staying open enough for nested objects/arrays.
    properties: Record<
      string,
      {
        type?: string | string[];
        items?: unknown;
        description?: string;
        enum?: unknown[];
      }
    >;
    required?: string[];
  };
}

/** A unified agent tool: schema (`meta`) plus its executable `initialize`. */
export interface AgentTool {
  meta: ToolMeta;
  /**
   * Declared as a method so parameter types are checked bivariantly: concrete
   * tools destructure their args into typed shapes (e.g. `{ query }: { query?: string }`)
   * and still satisfy the `Record<string, unknown>` dispatch contract.
   */
  initialize(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/** Context passed into every tool — helpers plus the live bot context. */
export interface ToolContext extends BaseCtx {
  /** Resolve a user's info by platform user ID (null when unknown). */
  getUserInfo: (userID: string) => Promise<UnifiedUserInfo | null>;
  /** Resolve a thread/group's info by thread ID (null when unknown). */
  getThreadInfo: (threadID: string) => Promise<UnifiedThreadInfo | null>;
  /** Serialized command catalogue for the list_commands tool. */
  listCommands: (role: string) => Promise<string>;
  /**
   * Executes a bot command and captures what it replied. Returns
   * { ok, output } — output is the reply text when one was captured.
   */
  runBotCommand: (
    command: string,
  ) => Promise<{ ok: boolean; output?: string; error?: string }>;
  /** Called before each tool executes. isFirst=true on the first tool of the turn. */
  onToolCall?: (toolName: string, isFirst: boolean) => Promise<void>;
  /**
   * Set by send_result after a successful delivery. Guards against the model
   * calling send_result more than once in a single turn, which would post
   * duplicate replies (and silently lose single-use attachment keys on the
   * second call). Reset per turn — the ToolContext is built fresh every turn.
   */
  agentReplyDelivered?: { message: string; deliveredAt: number };
}
