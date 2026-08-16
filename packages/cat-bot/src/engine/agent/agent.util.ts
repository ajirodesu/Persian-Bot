/**
 * AI Agent — Context Resolution
 *
 * resolveAgentContext() extracts the conversation coordinates every command-aware
 * agent tool needs (help, test_command, send_result) from a live bot context.
 * All values come from the event payload and the native session identity, so no
 * platform-specific code is required.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';

export interface AgentContext {
  /** Platform ID of the user who triggered the agent turn. */
  senderID: string;
  /** Platform ID of the thread/chat the turn is running in. */
  threadID: string;
  /** Top-level bot user directory (credential namespace). */
  sessionUserId: string;
  /** Session directory (specific bot account). */
  sessionId: string;
  /** Platform transport name (discord / telegram / webchat). */
  platform: string;
}

/** Pulls the standard conversation coordinates out of a live bot context. */
export function resolveAgentContext(ctx: BaseCtx): AgentContext {
  return {
    senderID: (ctx.event['senderID'] as string) ?? '',
    threadID: (ctx.event['threadID'] as string) ?? '',
    sessionUserId: ctx.native.userId ?? '',
    sessionId: ctx.native.sessionId ?? '',
    platform: ctx.native.platform ?? '',
  };
}
