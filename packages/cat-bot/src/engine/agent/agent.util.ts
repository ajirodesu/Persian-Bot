import type { AppCtx } from '@/engine/types/controller.types.js';

/**
 * Standard interface for dynamically loaded agent tools.
 * Mirrors the structure of command modules.
 */
export interface AgentTool {
  config: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  /**
   * The tool execution handler.
   * `args` is the parsed JSON arguments object from the AI.
   * `ctx` is the unified app context.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, ctx: AppCtx) => Promise<string> | string;
}

/**
 * Extracts the common session identity triple from any AppCtx.
 *
 * Every agent tool needs senderID / threadID / sessionUserId for ban, role,
 * and disabled-command checks. Centralising extraction here prevents the same
 * field-path strings from being copy-pasted into each tool's run() body.
 */
export function resolveAgentContext(ctx: AppCtx) {
  return {
    senderID: (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string,
    threadID: (ctx.event['threadID'] ?? '') as string,
    sessionUserId: ctx.native.userId ?? '',
    sessionId: ctx.native.sessionId ?? '',
    platform: ctx.native.platform,
  };
}

/**
 * Variables for {@link renderSystemPrompt} — keyed by the full `{{NAME}}` token.
 */
export type PromptVariables = Record<string, string>;

// Matches any {{...}} token, e.g. {{BOT_NAME}} or {{hello-world}}.
const PLACEHOLDER_PATTERN = /\{\{[^}]*\}\}/g;

/**
 * Renders a system-prompt template by substituting every `{{NAME}}`
 * placeholder with its real value.
 *
 * WHY A SINGLE PASS OVER THE WHOLE TEMPLATE (not per-variable .replace()):
 *   - `String.replace('{{BOT_NAME}}', …)` only replaces the FIRST occurrence —
 *     the prompt uses {{BOT_NAME}} 6× and {{USER_NAME}} 2×, so every later
 *     occurrence stayed literal. The LLM then sees `{{BOT_NAME}}` in its own
 *     system prompt and echoes it back verbatim into user-facing replies.
 *   - A regex substitution scans the whole template once, replacing ALL
 *     occurrences.
 *   - Replacement values (nicknames, usernames, command lists) are inserted
 *     without being rescanned, so a value that itself contains `{{...}}` is
 *     never substituted a second time.
 *
 * Unknown placeholders (not present in `variables`) and any `{{...}}` tokens
 * introduced by inserted values are stripped entirely, guaranteeing a literal
 * placeholder token can never reach the LLM — and therefore can never leak
 * into the agent's output.
 */
export function renderSystemPrompt(
  template: string,
  variables: PromptVariables,
): string {
  const rendered = template.replace(PLACEHOLDER_PATTERN, (match) => {
    const value = variables[match];
    if (value !== undefined) return value;
    return '';
  });
  // Safety net for tokens introduced by the inserted values themselves.
  return rendered.replace(PLACEHOLDER_PATTERN, '');
}

// Keys scanned, in priority order, when unwrapping a JSON envelope down to the
// actual human-readable reply. `message` is our own send_result contract key;
// `final`/`response`/`answer`/`text`/`content` cover the common model output
// shapes (including gpt-oss-120b's Harmony "commentary/final" format, where
// `final` holds the answer and `commentary` the reasoning). `commentary` is
// deliberately LAST — it is reasoning text, only used when no answer key exists.
const HUMAN_TEXT_KEYS = [
  'message',
  'final',
  'response',
  'answer',
  'text',
  'content',
  'commentary',
] as const;

/**
 * Reduces a model-produced value down to the actual reply text the user should
 * see — never raw JSON.
 *
 * Handles:
 *  - plain strings → returned as-is (trimmed)
 *  - JSON-encoded strings → parsed and unwrapped recursively, so double-encoded
 *    envelopes like '"{\\"final\\":\\"hi\\"}"' collapse to `hi`
 *  - objects → the first non-empty value under any {@link HUMAN_TEXT_KEYS} key
 *    (covers send_result args `{ message }` and the Harmony envelope
 *    `{ commentary, final }` from the Groq "json" tool-call quirk)
 *  - content-part arrays (OpenAI-style `[{ type: 'text', text }]`) → joined
 *  - numbers/booleans/null → null
 *
 * Returns null when nothing resembling user-facing text is found, so callers
 * can fail visibly ("no message text") instead of leaking the raw JSON value.
 */
export function extractHumanText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (
      trimmed.startsWith('{') ||
      trimmed.startsWith('[') ||
      // A JSON-encoded string (double-encoded envelope) starts with a quote.
      trimmed.startsWith('"')
    ) {
      try {
        // JSON.parse is strict about trailing content — a markdown answer that
        // merely STARTS with a brace (code example etc.) throws here and falls
        // through to the plain-text return below.
        const parsed = JSON.parse(trimmed) as unknown;
        return extractHumanText(parsed);
      } catch {
        // Genuine plain text that happens to start with a brace — use as-is.
      }
    }
    return trimmed;
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const part = extractHumanText(item);
      if (part) parts.push(part);
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of HUMAN_TEXT_KEYS) {
      const inner = extractHumanText(obj[key]);
      if (inner) return inner;
    }
    return null;
  }

  return null;
}
