/**
 * Editor agent — drafts and rewrites posts.
 *
 * Drafts/edits content only. NEVER publishes automatically: output is always
 * returned for human approval through the existing workflow.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { askAgentJSON } from './runner.js';

/** Conservative cross-platform text limit (Telegram's is 4096). */
export const MAX_POST_LENGTH = 4096;

export interface Draft {
  text: string;
  summary: string;
}

export function coerceDraft(raw: unknown): Draft {
  if (!raw || typeof raw !== 'object') {
    return { text: '', summary: 'agent returned nothing usable' };
  }
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  const summary =
    typeof o.summary === 'string' && o.summary.trim()
      ? o.summary.trim().slice(0, 300)
      : 'no summary given';

  return { text: text.slice(0, MAX_POST_LENGTH), summary };
}

const STYLE = [
  'You write posts for a chat channel.',
  '',
  '- Simple Markdown only: *bold*, _italic_, `code`, [text](url). No HTML, no headings, no tables.',
  `- Hard limit ${MAX_POST_LENGTH} characters. Aim well under it.`,
  '- Short paragraphs. Blank line between them. Emoji only where it earns its place.',
  '- Write the post itself. No preamble, no "here is your post", no commentary outside the JSON.',
  '- Match the language of the instruction.',
  '',
  '## Output',
  '{"text": "the post, ready to publish", "summary": "one line on what you wrote or changed"}',
].join('\n');

function contextBlock(channelTitle?: string | null, recentPosts?: string[]): string {
  const parts: string[] = [];
  if (channelTitle) parts.push(`Channel: ${channelTitle}`);
  if (recentPosts?.length) {
    parts.push('');
    parts.push('Recent posts, for tone and to avoid repeating yourself:');
    recentPosts.slice(0, 5).forEach((p, i) => parts.push(`${i + 1}. ${p.slice(0, 300)}`));
  }
  return parts.join('\n');
}

export async function draftPost(input: {
  instruction: string;
  channelTitle?: string | null;
  recentPosts?: string[];
  userId?: string;
}): Promise<{ draft: Draft; error?: string; model?: string }> {
  try {
    const res = await askAgentJSON(
      'editor',
      {
        system: STYLE,
        user: [
          contextBlock(input.channelTitle, input.recentPosts),
          '',
          '## Write a post',
          '"""',
          input.instruction.slice(0, 2000),
          '"""',
        ]
          .filter(Boolean)
          .join('\n'),
        ...(input.userId ? { userId: input.userId } : {}),
      },
      coerceDraft,
    );

    return { draft: res.data, model: `${res.provider}/${res.model}` };
  } catch (err) {
    return { draft: { text: '', summary: '' }, error: (err as Error)?.message ?? String(err) };
  }
}

export async function rewritePost(input: {
  original: string;
  instruction: string;
  channelTitle?: string | null;
  userId?: string;
}): Promise<{ draft: Draft; error?: string; model?: string }> {
  try {
    const res = await askAgentJSON(
      'editor',
      {
        system: [
          STYLE,
          '',
          'You are editing an existing post. Change only what the instruction asks for and',
          'keep everything else — wording, structure, links — exactly as it was.',
          'Return the complete post, not a diff or a fragment.',
        ].join('\n'),
        user: [
          contextBlock(input.channelTitle),
          '',
          '## Current post',
          '"""',
          input.original.slice(0, 3000),
          '"""',
          '',
          '## Requested change',
          '"""',
          input.instruction.slice(0, 1000),
          '"""',
        ]
          .filter(Boolean)
          .join('\n'),
        ...(input.userId ? { userId: input.userId } : {}),
      },
      coerceDraft,
    );

    return { draft: res.data, model: `${res.provider}/${res.model}` };
  } catch (err) {
    return { draft: { text: '', summary: '' }, error: (err as Error)?.message ?? String(err) };
  }
}

export const __test = { coerceDraft, STYLE };
