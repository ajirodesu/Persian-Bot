import type { AppCtx } from '@/engine/types/controller.types.js';
import type { BinaryAttachment } from './lib/command-result-store.lib.js';
import type { ReplyMessageOptions, NamedStreamAttachment } from '@/engine/adapters/models/interfaces/index.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { stopTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';

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

// ── Media attachment awareness ─────────────────────────────────────────────────

/** Minimal unified attachment entry shape read off event['attachments']. */
interface RawAttachmentEntry {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

/** True when a unified attachment entry looks like a static/animated image. */
export function isImageAttachment(att: RawAttachmentEntry): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (type === 'photo' || type === 'animated_image' || type === 'gif') {
    return true;
  }
  return IMAGE_EXT_RE.test(att.filename ?? att.name ?? att.url ?? '');
}

/**
 * Collects the image attachment URLs from an event — the message's own
 * attachments first, then the replied-to message's. Only entries with a
 * usable public url are returned; every platform normalizer (Discord,
 * Telegram via file_id → CDN, Fluxer) populates it on the event.
 */
export function extractEventImageUrls(
  event: Record<string, unknown>,
): Array<{ url: string; label: string }> {
  const out: Array<{ url: string; label: string }> = [];
  const pushFrom = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const a of list) {
      if (a !== null && typeof a === 'object') {
        const entry = a as RawAttachmentEntry;
        if (
          typeof entry.url === 'string' &&
          entry.url &&
          isImageAttachment(entry)
        ) {
          out.push({
            url: entry.url,
            label: entry.filename ?? entry.name ?? 'image',
          });
        }
      }
    }
  };
  pushFrom(event['attachments']);
  const reply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  if (reply) pushFrom(reply['attachments']);
  return out;
}

/**
 * Builds a short human-readable note describing the media attached to the
 * triggering message. Returns '' when nothing is attached.
 *
 * Deliberately includes NO URLs — Telegram CDN links embed the bot token, and
 * the model never needs them: generate_image resolves the attached image itself
 * (extractEventImageUrls). Media metadata only reaches the prompt, keeping
 * token-bearing URLs out of the LLM conversation entirely.
 */
export function describeUserMedia(event: Record<string, unknown>): string {
  const images = extractEventImageUrls(event);
  if (images.length === 0) return '';
  const lines = images
    .map((img, i) => `- image #${i + 1}: ${img.label || 'attached image'}`)
    .join('\n');
  return (
    `📎 The user attached ${images.length === 1 ? 'an image' : `${images.length} images`} to this message:\n` +
    lines +
    '\nYou can transform or edit the attached image by calling `generate_image` ' +
    '(omit `image_url` — the attached image is detected automatically; AI Image ' +
    'commands such as nanobanana are handled by generate_image, never ' +
    'test_command). For upscaling/HD enhancement use `hd` via `test_command`.'
  );
}

// ── Per-turn media accumulator ─────────────────────────────────────────────────

/**
 * Media captured by agent tools during the current turn, awaiting delivery.
 * test_command and generate_image push into it; send_result merges it
 * automatically (and the agent loop's bare-text fallback delivers it too), so
 * a requested image/video is ALWAYS delivered even when the model forgets the
 * attachment keys. Attached to ctx, so it dies with the invocation.
 */
export interface PendingAgentMedia {
  /** URL-based attachments (forwarded as attachment_url). */
  urls: Array<{ name: string; url: string }>;
  /** Buffer/stream attachments (forwarded as attachment). */
  binaries: BinaryAttachment[];
}

const PENDING_MEDIA_KEY = '_agentPendingMedia';

/** Returns (creating on first use) the per-turn media accumulator on ctx. */
export function getPendingMedia(ctx: AppCtx): PendingAgentMedia {
  const map = ctx as unknown as Record<string, unknown>;
  let pending = map[PENDING_MEDIA_KEY] as PendingAgentMedia | undefined;
  if (!pending) {
    pending = { urls: [], binaries: [] };
    map[PENDING_MEDIA_KEY] = pending;
  }
  return pending;
}

/** Removes the per-turn media accumulator — called after delivery. */
export function clearPendingMedia(ctx: AppCtx): void {
  (ctx as unknown as Record<string, unknown>)[PENDING_MEDIA_KEY] = undefined;
}

/**
 * Delivers a message plus any pending captured media in a single reply,
 * threaded to the triggering message. Returns true when something was sent.
 *
 * This is the safety net behind "the agent never answers a media request with
 * text only": if the model finishes without send_result keys (or without
 * send_result at all), the captured image/video/audio still reaches the user.
 */
export async function deliverAgentMedia(
  ctx: AppCtx,
  message: string,
): Promise<boolean> {
  const pending = getPendingMedia(ctx);
  if (
    !message.trim() &&
    pending.urls.length === 0 &&
    pending.binaries.length === 0
  ) {
    return false;
  }

  const threadID = (ctx.event['threadID'] as string) || '';
  const replyToID = (ctx.event['messageID'] as string) || '';
  const replyOptions: ReplyMessageOptions = {
    message,
    style: MessageStyle.MARKDOWN,
    ...(replyToID ? { reply_to_message_id: replyToID } : {}),
  };
  if (pending.urls.length > 0) replyOptions.attachment_url = pending.urls;
  if (pending.binaries.length > 0)
    replyOptions.attachment = pending.binaries as NamedStreamAttachment[];

  try {
    await ctx.api.replyMessage(threadID, replyOptions);
    // Kill any lingering typing/thinking indicator — the reply has landed.
    stopTypingIndicator(threadID);
    return true;
  } catch {
    return false;
  }
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
