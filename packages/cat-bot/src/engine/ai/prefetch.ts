/**
 * Deterministic context prefetch.
 *
 * A tool definition is only a request to a model — weak models ignore tools.
 * For unmistakable requests the lookup runs *before* the model speaks and the
 * result is placed into the prompt as high-priority live data. Rules are high
 * precision: nothing fires on ordinary chatter.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { executeTool, type ToolContext } from './tools.js';

export interface PrefetchRule {
  id: string;
  tool: string;
  /** Return arguments to run with, or null to skip. */
  match: (text: string, recent: string[]) => Record<string, unknown> | null;
}

/** Explicit server/thread id mention (long numeric / platform id shape). */
const SERVER_ID = /(^|[^\d\w])(-?\d{6,20}|[A-Za-z0-9_-]{8,64})(?![\d\w])/;

const WHERE_ARE_YOU = [
  /\bwhich\b[^?]*\b(server|channel|group|chat)s?\b[^?]*\b(are|r)\s+(you|u)\b/i,
  /\bwhat\b[^?]*\b(server|channel|group)s?\b[^?]*\byou\b[^?]*\bin\b/i,
  /\byou('?re| are)?\s+(in|part of)\s+(which|what)\b/i,
  /\b(where|kon)\b[^?]*\b(joined|join|ach?o|achen)\b/i,
];

const FOLLOW_UP = /\b(access|info|information|detail|data|member|admin|check|verify|about)\b/i;

const CAPABILITIES = [
  /\bwhat\s+(can|do)\s+you\s+(do|offer)\b/i,
  /\b(your|tomar)\s+command/i,
  /\bcommand\s+(list|gulo)\b/i,
  /\bwhat\s+commands\b/i,
  /\bhelp\b\s*(me|with commands)?$/i,
];

const SERVER_LISTING = [
  /\blist\b[^?]*\b(server|channel)s?\b/i,
  /\bshow\b[^?]*\b(server|channel)s?\b/i,
];

export const RULES: PrefetchRule[] = [
  {
    id: 'server-id',
    tool: 'get_server_info',
    match(text, recent) {
      const here = text.match(SERVER_ID);
      const candidate = here?.[2]?.trim();
      // Only treat it as an id lookup when the message is actually asking
      // about a server/channel — not when a number just appears in chatter.
      if (candidate && FOLLOW_UP.test(text)) return { server_id: candidate };

      if (!FOLLOW_UP.test(text)) return null;
      for (const prev of recent.slice(-2).reverse()) {
        const m = prev.match(SERVER_ID);
        if (m?.[2]) return { server_id: m[2].trim() };
      }
      return null;
    },
  },
  {
    id: 'where-are-you',
    tool: 'list_servers',
    match(text) {
      return WHERE_ARE_YOU.some((re) => re.test(text)) ||
        SERVER_LISTING.some((re) => re.test(text))
        ? {}
        : null;
    },
  },
  {
    id: 'capabilities',
    tool: 'list_commands',
    match(text) {
      return CAPABILITIES.some((re) => re.test(text)) ? { limit: 12 } : null;
    },
  },
];

export interface PrefetchResult {
  id: string;
  tool: string;
  ok: boolean;
  content: string;
}

/** Run every matching rule once, in order. */
export async function prefetch(
  text: string,
  ctx: ToolContext,
  recent: string[] = [],
): Promise<PrefetchResult[]> {
  if (!text?.trim()) return [];

  const out: PrefetchResult[] = [];
  for (const rule of RULES) {
    let args: Record<string, unknown> | null;
    try {
      args = rule.match(text, recent);
    } catch {
      args = null;
    }
    if (!args) continue;

    const result = await executeTool(rule.tool, args, ctx);
    out.push({ id: rule.id, tool: rule.tool, ok: result.ok, content: result.content });
  }
  return out;
}

/**
 * Render prefetched results as a prompt section. The closing instruction is
 * load-bearing: without it a model that already decided it cannot help will
 * say so anyway, with the answer sitting directly above.
 */
export function renderPrefetch(results: PrefetchResult[]): string {
  if (!results.length) return '';

  const blocks = results.map(
    (r) => `### ${r.tool}${r.ok ? '' : ' (failed)'}\n${r.content}`,
  );

  return [
    '## Already looked up for you',
    '',
    'These ran just now, against the live system, because the message clearly called for them.',
    '',
    ...blocks,
    '',
    'This is real data about this bot. Use it to answer directly.',
    'Do not call the same tool again, do not answer from general knowledge instead,',
    'and do not say you are unable to find this out — it is above.',
    'If a lookup failed, say plainly what failed and why.',
  ].join('\n');
}

export const __test = { RULES, SERVER_ID, WHERE_ARE_YOU, CAPABILITIES, FOLLOW_UP };
