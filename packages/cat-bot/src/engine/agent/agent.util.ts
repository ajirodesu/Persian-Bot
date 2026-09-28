import type { AppCtx } from '@/engine/types/controller.types.js';

/**
 * Standard interface for dynamically loaded agent tools.
 * Mirrors the structure of command modules (`meta` + `onCommand`).
 */
export interface AgentTool {
  config: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  /**
   * The tool execution handler.
   * `args` is the parsed JSON arguments object from Needle 3.
   * `ctx` is the authenticated Persian-Bot AppCtx — the ONLY source of
   * user/session identity. Never trust model-provided identity values.
   */
  run: (args: Record<string, unknown>, ctx: AppCtx) => Promise<string> | string;
}

/**
 * Extracts the session identity coordinates from any AppCtx.
 *
 * Every agent tool needs senderID / threadID / sessionUserId / sessionId /
 * platform for ban, role, and disabled-command checks. Centralising
 * extraction here prevents the same field-path strings from being
 * copy-pasted into each tool's run() body.
 */
export function resolveAgentContext(ctx: AppCtx): {
  senderID: string;
  threadID: string;
  sessionUserId: string;
  sessionId: string;
  platform: string;
} {
  return {
    senderID: (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string,
    threadID: (ctx.event['threadID'] ?? '') as string,
    sessionUserId: ctx.native.userId ?? '',
    sessionId: ctx.native.sessionId ?? '',
    platform: ctx.native.platform,
  };
}
