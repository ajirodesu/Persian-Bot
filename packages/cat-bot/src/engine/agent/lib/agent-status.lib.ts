/**
 * Agent Status Lib — live status text describing the AI agent's current
 * action, consumed by thinking-indicator.lib.ts to keep the "bot is
 * thinking" signal in sync with reality (reasoning, looking up a command,
 * running a command, sending the reply) instead of a generic phrase that
 * says the same thing regardless of what the agent is actually doing.
 *
 * WHY A MUTABLE REF ATTACHED TO ctx, NOT A RETURN VALUE:
 * agent.ts runs a recursive tool-call loop inside a single `fn` passed to
 * withThinkingIndicator (thinking-indicator.lib.ts) — there is no return
 * channel for intermediate progress. A small mutable object attached to ctx
 * (mirroring the existing `_agentCommandBudget` pattern used for the
 * per-message command limit) lets agent.ts push updates from inside the loop
 * while the indicator's refresh interval reads the latest value on each
 * tick, fully decoupled from agent.ts's control flow.
 */
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface AgentStatus {
  text: string;
}

const STATUS_KEY = '_agentStatus';

/** Shown while the model is reasoning between tool calls, before any action is known. */
export const DEFAULT_AGENT_STATUS_TEXT = '🧠 Thinking…';

/** Attaches a fresh status ref to ctx. Call once at the start of runAgent. */
export function initAgentStatus(ctx: AppCtx): AgentStatus {
  const status: AgentStatus = { text: DEFAULT_AGENT_STATUS_TEXT };
  (ctx as unknown as Record<string, unknown>)[STATUS_KEY] = status;
  return status;
}

/**
 * Updates the live status text read by the thinking-indicator refresh loop.
 * Safe to call even if initAgentStatus was never run — creates the ref lazily.
 */
export function setAgentStatus(ctx: AppCtx, text: string): void {
  const map = ctx as unknown as Record<string, unknown>;
  const status = map[STATUS_KEY] as AgentStatus | undefined;
  if (status) {
    status.text = text;
  } else {
    map[STATUS_KEY] = { text };
  }
}

/** Reads the current status text, or null if no agent run has initialized it yet. */
export function getAgentStatus(ctx: AppCtx): string | null {
  const status = (ctx as unknown as Record<string, unknown>)[STATUS_KEY] as
    | AgentStatus
    | undefined;
  return status?.text ?? null;
}

/**
 * Produces a short, human-readable status phrase for a given tool invocation,
 * so the indicator reflects exactly what the agent is doing rather than a
 * generic "thinking" placeholder for the entire duration of the turn.
 */
export function describeToolStatus(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'help': {
      const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
      return query
        ? `📖 Looking up \`${query}\`…`
        : '📖 Checking available commands…';
    }
    case 'test_command': {
      const commands = Array.isArray(args['commands'])
        ? (args['commands'] as Array<{ command?: unknown }>)
            .map((c) => (typeof c?.command === 'string' ? c.command : null))
            .filter((c): c is string => Boolean(c))
        : [];
      return commands.length > 0
        ? `⚙️ Running \`${commands.join('`, `')}\`…`
        : '⚙️ Running command…';
    }
    case 'send_result':
      return '📤 Sending reply…';
    default:
      return `🔧 Using ${toolName}…`;
  }
}
