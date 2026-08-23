/**
 * Agent Progress — one evolving status message per turn ("continuity").
 *
 * Instead of staying silent while tools run, the agent posts a single status
 * message on the FIRST tool call of a turn and then EDITS that same message
 * before every subsequent step, so the user watches the whole turn unfold in
 * one place:
 *
 *   ⏳ Checking my available commands…
 *      ↓ (edited before each next step)
 *   ✅ Checked my available commands
 *   ⏳ Running /meme…
 *      ↓ (final delivery)
 *   the answer itself is edited into this message (finishWithText), or the
 *   placeholder is unsent when the real reply went out through its own
 *   channel (send_result / command dispatch / media delivery).
 *
 * Works for INTERNAL tools and EXTERNAL MCP tools alike — the runner fires
 * onToolCall before EVERY cfg.tools.callTool, so namespaced external names
 * (<server>_<tool>) flow through the same humanizer.
 *
 * Every platform call is best-effort: any failure silently disables the
 * reporter for the rest of the turn, so cosmetic feedback can never break,
 * delay, or duplicate the actual reply.
 */
import type { BaseCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EditMessageOptions } from '@/engine/adapters/models/interfaces/api.interfaces.js';

/** Friendly phrases for the internal tools users see most often. */
const TOOL_PHRASES: Record<string, string> = {
  run_command: 'running the command',
  send_result: 'delivering the result',
  test_command: 'testing a command',
  list_commands: 'checking my available commands',
  help: 'looking up help',
  browser: 'browsing the web',
  bot_stats: 'pulling bot statistics',
  get_user: 'looking up the user info',
  get_group: 'looking up the group info',
};

/** Human-readable present-tense phrase for one tool step. */
function describeStep(toolName: string, args?: Record<string, unknown>): string {
  const key = toolName.toLowerCase();
  if (key === 'run_command') {
    const cmd =
      typeof args?.['command'] === 'string'
        ? args['command'].trim().replace(/^\//, '')
        : '';
    return cmd ? `running /${cmd}` : 'running the command';
  }
  const phrase = TOOL_PHRASES[key];
  if (phrase) return phrase;
  // External MCP tools arrive namespaced (<server>_<tool>) — humanize both.
  const words = key.replace(/_/g, ' ').trim();
  return words ? `working on it via ${words}` : 'working on your request';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Normalizes the assorted platform reply shapes into a message ID. */
function extractMessageID(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['messageID', 'message_id', 'id']) {
      const inner = record[key];
      if (typeof inner === 'string' && inner.trim()) return inner;
      if (typeof inner === 'number') return String(inner);
    }
  }
  return undefined;
}

export interface AgentProgress {
  /** Fired by the runner before every tool executes (internal AND external). */
  onToolCall: (
    toolName: string,
    isFirst: boolean,
    args?: Record<string, unknown>,
  ) => Promise<void>;
  /**
   * Edits the status message into the final answer. Returns true when the
   * answer was delivered through the edit (caller must skip its own send);
   * false when there is no editable placeholder (caller sends normally).
   */
  finishWithText: (text: string, markdown: boolean) => Promise<boolean>;
  /**
   * Edits the status message with arbitrary delivery options — including
   * media/buttons — so a command's whole output lands in ONE message.
   * Returns true when delivered through the edit; false when unavailable
   * (caller falls back to its own single-message delivery).
   */
  editWithOptions: (options: EditMessageOptions) => Promise<boolean>;
  /** Unsends the placeholder — used once the real reply arrived elsewhere. */
  dispose: () => Promise<void>;
}

export function createAgentProgress(ctx: BaseCtx): AgentProgress {
  const threadID = (ctx.event['threadID'] as string) ?? '';
  // The status bubble becomes the final answer via finishWithText, so anchor it
  // to the user's triggering message — the reply stays threaded in groups.
  const replyToID = (ctx.event['messageID'] as string) || '';

  let statusID: string | undefined;
  let disabled = false;
  let current = '';
  const done: string[] = [];

  const render = (): string => {
    const lines = done.slice(-6).map((d) => `✅ ${d}`);
    if (current) lines.push(`⏳ ${current}`);
    return lines.join('\n');
  };

  async function editStatus(): Promise<void> {
    if (!statusID) return;
    try {
      await ctx.api.editMessage(statusID, {
        message: render(),
        threadID,
      });
    } catch {
      // Editing not supported / message gone — stop trying for this turn.
      disabled = true;
    }
  }

  return {
    async onToolCall(toolName, isFirst, args) {
      if (disabled) return;
      try {
        const phrase = describeStep(toolName, args);
        if (!statusID) {
          current = capitalize(phrase);
          const sent = await ctx.api.replyMessage(threadID, {
            message: render(),
            ...(replyToID ? { reply_to_message_id: replyToID } : {}),
          });
          statusID = extractMessageID(sent);
          if (!statusID) disabled = true;
          return;
        }
        if (current) done.push(current);
        current = capitalize(phrase);
        void isFirst;
        await editStatus();
      } catch {
        disabled = true;
      }
    },

    async finishWithText(text, markdown) {
      return this.editWithOptions({
        message: text,
        style: markdown ? MessageStyle.MARKDOWN : MessageStyle.TEXT,
      });
    },

    async editWithOptions(options) {
      if (!statusID || disabled) return false;
      const id = statusID;
      try {
        await ctx.api.editMessage(id, { ...options, threadID });
        statusID = undefined;
        return true;
      } catch {
        // Edit rejected (platform limitation, media constraint, gone message).
        // The caller decides the fallback; keep the id so dispose() can still
        // clean the placeholder up.
        return false;
      }
    },

    async dispose() {
      const id = statusID;
      statusID = undefined;
      if (!id) return;
      try {
        await ctx.api.unsendMessage(id);
      } catch {
        // Best-effort only — some platforms cannot unsend bot messages.
      }
    },
  };
}
